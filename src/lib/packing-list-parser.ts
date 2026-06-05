/**
 * Universalus packing / loading list struktūrinis parseris (visi gamintojai).
 * Saba — specifinis formatas; Furninova — Lista zaladunkowa; kiti — bendra lentelė (kaip n8n AI sumavimas, bet deterministiškai).
 */
import * as XLSX from "xlsx";
import {
  findManufacturerInboundRule,
  type ManufacturerInboundRule,
} from "@/lib/manufacturer-inbound-rules";
import {
  extractFurninovaLoadingListRef,
  isBoliaContext,
  isSabaContext,
} from "@/lib/manufacturer-mail-extract";
import type { GraphAttachment } from "@/lib/mail-ingest-parser";
import {
  looksLikeSabaPackingList,
  parseSabaPackingListFromBuffer,
  parseSabaPackingListFromCsv,
  parseSabaPackingListRows,
  type SabaPackingListParse,
} from "@/lib/saba-packing-list-parser";

export type PackingListFormat = "saba" | "furninova" | "generic" | "bolia";

export type PackingListLine = {
  orderRef: string;
  /** Zona, produktų grupė, loading list segmentas ir pan. */
  label: string | null;
  boxes: number;
  volumeM3: number;
  grossKg: number;
};

export type PackingListParse = {
  format: PackingListFormat;
  lines: PackingListLine[];
  totals: { boxes: number; volumeM3: number; grossKg: number };
  warnings: string[];
  sourceFileName?: string;
  /** Papildoma pickup nuoroda (pvz. Furninova Lista zaladunkowa nr.) */
  pickupReferenceHint?: string | null;
};

export type PackingListExtractContext = {
  subject: string;
  bodyText: string;
  fromAddress?: string;
  manufacturerHint?: string | null;
  attachmentTexts?: string[];
};

const BOX_HDR =
  /box|d[eė][žz]|karton|colli|qty|quantity|szt|pcs|pak|pakai|carton|stuks/i;
const WEIGHT_HDR = /gross|bruto|weight|waga|masa\b|kg\b|brutto/i;
const VOL_HDR = /volume|obj[eę]to[sś][ćc]|cubic|m\s*3|m³|cbm|turis/i;
const NET_HDR = /netto|net\s*weight|net\s*masa/i;

function toNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(",", ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function cell(row: unknown[], idx: number): string {
  const v = row[idx];
  if (v == null) return "";
  return String(v).trim();
}

function roundTotals(t: { boxes: number; volumeM3: number; grossKg: number }) {
  return {
    boxes: t.boxes,
    volumeM3: Math.round(t.volumeM3 * 1000) / 1000,
    grossKg: Math.round(t.grossKg * 10) / 10,
  };
}

function sumLines(lines: PackingListLine[]) {
  return roundTotals(
    lines.reduce(
      (acc, l) => ({
        boxes: acc.boxes + l.boxes,
        volumeM3: acc.volumeM3 + l.volumeM3,
        grossKg: acc.grossKg + l.grossKg,
      }),
      { boxes: 0, volumeM3: 0, grossKg: 0 },
    ),
  );
}

function fromSabaParse(s: SabaPackingListParse, sourceFileName?: string): PackingListParse {
  return {
    format: "saba",
    lines: s.lines.map((l) => ({
      orderRef: l.orderRef,
      label: l.zone,
      boxes: l.boxes,
      volumeM3: l.volumeM3,
      grossKg: l.grossKg,
    })),
    totals: s.totals,
    warnings: s.warnings,
    sourceFileName: sourceFileName ?? s.sourceFileName,
  };
}

type ColumnMap = {
  headerIdx: number;
  labelCol: number;
  boxesCol: number;
  weightCol: number;
  volCol: number;
};

function detectColumnMap(rows: unknown[][]): ColumnMap | null {
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const row = rows[i];
    if (!row?.length) continue;
    let boxesCol = -1;
    let weightCol = -1;
    let volCol = -1;
    let labelCol = 0;
    for (let j = 0; j < row.length; j++) {
      const h = cell(row, j).toLowerCase();
      if (!h) continue;
      if (BOX_HDR.test(h)) boxesCol = j;
      if (WEIGHT_HDR.test(h) && !NET_HDR.test(h)) weightCol = j;
      if (VOL_HDR.test(h)) volCol = j;
    }
    if (weightCol >= 0 && (boxesCol >= 0 || volCol >= 0)) {
      for (let j = 0; j < row.length; j++) {
        const h = cell(row, j).toLowerCase();
        if (/order|užsak|zamów|ref|nr\b|numer/i.test(h)) {
          labelCol = j;
          break;
        }
      }
      return { headerIdx: i, labelCol, boxesCol, weightCol, volCol };
    }
  }
  return null;
}

function isTotalRow(label: string): boolean {
  return /^total|razem|suma|sum|totale|gesamt$/i.test(label.trim());
}

/** Bendras Excel/CSV su stulpeliais BOXES / WEIGHT / VOLUME (Furninova, Bolia, kt.). */
export function parseGenericTabularRows(
  rows: unknown[][],
  opts?: { format?: PackingListFormat; defaultOrderRef?: string },
): PackingListParse | null {
  const map = detectColumnMap(rows);
  if (!map) return null;

  const lines: PackingListLine[] = [];
  const warnings: string[] = [];
  let sectionRef = opts?.defaultOrderRef ?? "Bendras";
  let sectionLabel: string | null = null;
  let sectionBoxes = 0;
  let sectionM3 = 0;
  let sectionKg = 0;

  const flushSection = () => {
    if (sectionBoxes <= 0 && sectionM3 <= 0 && sectionKg <= 0) return;
    lines.push({
      orderRef: sectionRef,
      label: sectionLabel,
      boxes: sectionBoxes,
      volumeM3: sectionM3,
      grossKg: sectionKg,
    });
    sectionBoxes = 0;
    sectionM3 = 0;
    sectionKg = 0;
  };

  for (let i = map.headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row?.length) continue;

    const labelRaw = cell(row, map.labelCol);
    const descCol = map.labelCol === 0 ? cell(row, 2) : labelRaw;
    const label = labelRaw || descCol;

    if (isTotalRow(label) || isTotalRow(descCol)) {
      const tBoxes = map.boxesCol >= 0 ? toNum(row[map.boxesCol]) : 0;
      const tKg = toNum(row[map.weightCol]);
      const tM3 = map.volCol >= 0 ? toNum(row[map.volCol]) : 0;
      if (tKg > 0 || tM3 > 0 || tBoxes > 0) {
        if (sectionKg > 0 && Math.abs(sectionKg - tKg) > 0.5) {
          warnings.push(
            `${sectionRef}: TOTAL (${tKg} kg) ≠ eilučių suma (${sectionKg} kg) — naudojamas TOTAL`,
          );
        }
        sectionBoxes = tBoxes > 0 ? tBoxes : sectionBoxes;
        sectionM3 = tM3 > 0 ? tM3 : sectionM3;
        sectionKg = tKg > 0 ? tKg : sectionKg;
        flushSection();
      }
      continue;
    }

    const orderHeader = label.match(/^(\d{4})-(\d{4})(?:\s+(.+))?$/i);
    if (orderHeader?.[1] && descCol && !/^total/i.test(descCol)) {
      flushSection();
      sectionRef = orderHeader[1];
      sectionLabel = orderHeader[3]?.trim() || null;
      continue;
    }

    const furnRef = label.match(/(\d{2}W[/_]\d+(?:[/_]\d+)+\/(?:EXPO|EXKAUN))/i);
    if (furnRef?.[1]) {
      flushSection();
      sectionRef = furnRef[1].replace(/_/g, "/").toUpperCase();
      sectionLabel = null;
      continue;
    }

    const boxes = map.boxesCol >= 0 ? toNum(row[map.boxesCol]) : 0;
    const kg = toNum(row[map.weightCol]);
    const m3 = map.volCol >= 0 ? toNum(row[map.volCol]) : 0;
    if (boxes <= 0 && kg <= 0 && m3 <= 0) continue;
    if (!descCol && !label) continue;

    sectionBoxes += boxes;
    sectionM3 += m3;
    sectionKg += kg;
  }

  flushSection();
  if (lines.length === 0) return null;

  const totals = sumLines(lines);
  return {
    format: opts?.format ?? "generic",
    lines,
    totals,
    warnings,
  };
}

function parseFurninovaRows(rows: unknown[][]): PackingListParse | null {
  const headText = rows
    .slice(0, 8)
    .map((r) => (r ?? []).map((c) => String(c ?? "")).join(" "))
    .join("\n");
  if (!/lista\s+zaladunkowa|zaladunkowa|furninova/i.test(headText)) {
    return null;
  }

  const listaRef =
    headText.match(/lista\s+zaladunkowa\s+nr\s*[:\-]?\s*([A-Z0-9/_\-]+)/i)?.[1]?.trim() ??
    null;

  const generic = parseGenericTabularRows(rows, {
    format: "furninova",
    defaultOrderRef: listaRef?.split("/")[0] ?? "Furninova",
  });

  if (generic) {
    return {
      ...generic,
      format: "furninova",
      pickupReferenceHint: listaRef,
    };
  }

  const saba = parseSabaPackingListRows(rows);
  if (saba) {
    const p = fromSabaParse(saba);
    return {
      ...p,
      format: "furninova",
      pickupReferenceHint: listaRef ?? extractFurninovaLoadingListRef("", headText),
    };
  }

  return null;
}

function sheetRowsFromBuffer(buffer: Buffer): unknown[][][] {
  try {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const out: unknown[][][] = [];
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      out.push(
        XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as unknown[][],
      );
    }
    return out;
  } catch {
    return [];
  }
}

function parseScore(p: PackingListParse | null): number {
  if (!p) return 0;
  let s = p.totals.grossKg > 0 ? 10 : 0;
  s += p.totals.volumeM3 > 0 ? 5 : 0;
  s += p.lines.length;
  if (p.format === "saba") s += 20;
  if (p.format === "furninova") s += 15;
  return s;
}

function inferManufacturerKey(ctx: PackingListExtractContext): string | null {
  const block = `${ctx.subject}\n${ctx.bodyText}`;
  if (isSabaContext(ctx.manufacturerHint ?? null, ctx.subject, block)) return "saba";
  if (isBoliaContext(ctx.manufacturerHint ?? null, ctx.subject, block)) return "bolia";
  if (/furninova|dorota|lista\s+zaladunkowa|\d{2}W[/_]\d+/i.test(block)) return "furninova";
  return null;
}

function tryParseRows(
  rows: unknown[][],
  ctx: PackingListExtractContext,
  sourceFileName?: string,
): PackingListParse | null {
  const key = findManufacturerInboundRule(ctx.fromAddress ?? "", ctx.subject)?.key ?? inferManufacturerKey(ctx);

  const attempts: (() => PackingListParse | null)[] = [];

  if (key === "saba" || key === "eriks" || !key) {
    attempts.push(() => {
      const s = parseSabaPackingListRows(rows);
      return s ? fromSabaParse(s, sourceFileName) : null;
    });
  }
  if (key === "furninova" || !key) {
    attempts.push(() => parseFurninovaRows(rows));
  }
  attempts.push(() =>
    parseGenericTabularRows(rows, {
      format: key === "bolia" ? "bolia" : "generic",
    }),
  );

  let best: PackingListParse | null = null;
  for (const fn of attempts) {
    const p = fn();
    if (!p || parseScore(p) <= parseScore(best)) continue;
    best = sourceFileName ? { ...p, sourceFileName } : p;
  }
  return best;
}

/**
 * Iš priedų (xlsx/xls/csv) — bando visus gamintojų formatus.
 */
export function tryExtractPackingListFromAttachments(
  attachments: GraphAttachment[],
  ctx: PackingListExtractContext,
): PackingListParse | null {
  let best: PackingListParse | null = null;

  for (const a of attachments) {
    if (!a.contentBytes) continue;
    const e = (a.name?.split(".").pop() ?? "").toLowerCase();
    const buffer = Buffer.from(a.contentBytes, "base64");

    if (e === "xlsx" || e === "xls") {
      for (const rows of sheetRowsFromBuffer(buffer)) {
        const p = tryParseRows(rows, ctx, a.name);
        if (parseScore(p) > parseScore(best)) best = p;
      }
      const saba = parseSabaPackingListFromBuffer(buffer, a.name);
      if (saba) {
        const p = fromSabaParse(saba, a.name);
        if (parseScore(p) > parseScore(best)) best = p;
      }
    }

    if (e === "csv") {
      const csv = buffer.toString("utf8");
      if (looksLikeSabaPackingList(csv)) {
        const s = parseSabaPackingListFromCsv(csv);
        if (s) {
          const p = fromSabaParse(s, a.name);
          if (parseScore(p) > parseScore(best)) best = p;
        }
      }
      const rows = csv.split(/\r?\n/).filter((l) => l.trim());
      if (rows.length > 1) {
        const parsed = tryParseRows(
          rows.map((line) => line.split(",").map((c) => c.trim())),
          ctx,
          a.name,
        );
        if (parseScore(parsed) > parseScore(best)) best = parsed;
      }
    }
  }

  if (!best && ctx.attachmentTexts?.length) {
    for (const chunk of ctx.attachmentTexts) {
      if (!looksLikeSabaPackingList(chunk) && !/waga|weight|gross|m3|m³|box/i.test(chunk)) {
        continue;
      }
      const lines = chunk.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 3) continue;
      const rows = lines.map((l) => l.split(/[,;\t]/).map((c) => c.trim()));
      const p = tryParseRows(rows, ctx);
      if (parseScore(p) > parseScore(best)) best = p;
    }
  }

  return best;
}

export function packingListOrderRefsJoined(lines: PackingListLine[]): string {
  const refs = [
    ...new Set(
      lines
        .map((l) => l.orderRef)
        .filter((r) => r && r !== "Bendras" && r !== "Furninova"),
    ),
  ];
  const numeric = refs.filter((r) => /^\d{4}$/.test(r));
  if (numeric.length > 0) {
    return numeric.sort((a, b) => Number(a) - Number(b)).join(", ");
  }
  return refs.join(", ");
}

export function serializePackingListParse(parsed: PackingListParse): string {
  return JSON.stringify(parsed);
}

export function parsePackingListJson(json: string | null | undefined): PackingListParse | null {
  if (!json?.trim()) return null;
  try {
    const j = JSON.parse(json) as PackingListParse & {
      lines?: Array<PackingListLine & { zone?: string | null }>;
    };
    if (!Array.isArray(j.lines) || !j.totals) return null;
    type LegacyLine = PackingListLine & { zone?: string | null };
    const lines: PackingListLine[] = (j.lines as LegacyLine[]).map((l) => ({
      orderRef: l.orderRef,
      label: l.label ?? l.zone ?? null,
      boxes: l.boxes,
      volumeM3: l.volumeM3,
      grossKg: l.grossKg,
    }));
    return {
      format: j.format ?? "generic",
      lines,
      totals: j.totals,
      warnings: j.warnings ?? [],
      sourceFileName: j.sourceFileName,
      pickupReferenceHint: j.pickupReferenceHint ?? null,
    };
  } catch {
    return null;
  }
}

export function resolveInboundManufacturer(
  fromAddress: string,
  subject: string,
): ManufacturerInboundRule | null {
  return findManufacturerInboundRule(fromAddress, subject);
}

/** @deprecated Naudokite tryExtractPackingListFromAttachments */
export const tryExtractSabaPackingListFromAttachments = tryExtractPackingListFromAttachments;
