import * as XLSX from "xlsx";

export type SabaPackingListLine = {
  orderRef: string;
  zone: string | null;
  boxes: number;
  volumeM3: number;
  grossKg: number;
};

export type SabaPackingListParse = {
  lines: SabaPackingListLine[];
  totals: { boxes: number; volumeM3: number; grossKg: number };
  warnings: string[];
  sourceFileName?: string;
};

const ORDER_HEADER_RE = /^(\d{4})-(\d{4})(?:\s+(.+))?$/i;

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

function parseOrderHeader(colA: string): { orderRef: string; zone: string | null } | null {
  const m = colA.match(ORDER_HEADER_RE);
  if (!m?.[1]) return null;
  const zone = m[3]?.trim() || null;
  return { orderRef: m[1]!, zone };
}

/** Ar tekstas / CSV atrodo kaip Saba packing list formatas. */
export function looksLikeSabaPackingList(text: string): boolean {
  return /saba\s+order/i.test(text) && /cubic\s+meters/i.test(text) && /gross\s+weight/i.test(text);
}

/**
 * Parsina Saba PL iš 2D masyvo (Excel eilutės arba CSV).
 * Stulpeliai: A=užsakymas, C=aprašymas, E=dėžės, G=m³, I=bruto kg.
 */
export function parseSabaPackingListRows(rows: unknown[][]): SabaPackingListParse | null {
  if (rows.length < 2) return null;

  const headerRow = rows.find((r) => looksLikeSabaPackingList(r.map((c) => String(c ?? "")).join(",")));
  if (!headerRow) return null;

  const lines: SabaPackingListLine[] = [];
  const warnings: string[] = [];

  let current: SabaPackingListLine | null = null;
  let sectionBoxes = 0;
  let sectionM3 = 0;
  let sectionKg = 0;

  const flushSection = (totalRow?: { boxes: number; m3: number; kg: number }) => {
    if (!current) return;
    const line = { ...current };
    if (totalRow && (totalRow.boxes > 0 || totalRow.m3 > 0 || totalRow.kg > 0)) {
      const tolKg = 0.5;
      const tolM3 = 0.02;
      if (Math.abs(sectionBoxes - totalRow.boxes) > 0) {
        warnings.push(
          `${line.orderRef}: TOTAL dėžės (${totalRow.boxes}) ≠ eilučių suma (${sectionBoxes}) — naudojamas TOTAL`,
        );
      }
      if (Math.abs(sectionM3 - totalRow.m3) > tolM3) {
        warnings.push(
          `${line.orderRef}: TOTAL tūris (${totalRow.m3.toFixed(2)} m³) ≠ eilučių suma (${sectionM3.toFixed(2)} m³) — naudojamas TOTAL`,
        );
      }
      if (Math.abs(sectionKg - totalRow.kg) > tolKg) {
        warnings.push(
          `${line.orderRef}: TOTAL svoris (${totalRow.kg} kg) ≠ eilučių suma (${sectionKg} kg) — naudojamas TOTAL`,
        );
      }
      line.boxes = totalRow.boxes;
      line.volumeM3 = totalRow.m3;
      line.grossKg = totalRow.kg;
    }
    lines.push(line);
    current = null;
    sectionBoxes = 0;
    sectionM3 = 0;
    sectionKg = 0;
  };

  for (const row of rows) {
    const colA = cell(row, 0);
    const colC = cell(row, 2);

    if (/^saba\s+order$/i.test(colA) || (colA === "" && /^saba\s+order$/i.test(colC))) {
      continue;
    }

    const header = colA ? parseOrderHeader(colA) : null;
    if (header) {
      flushSection();
      current = {
        orderRef: header.orderRef,
        zone: header.zone,
        boxes: 0,
        volumeM3: 0,
        grossKg: 0,
      };
      continue;
    }

    if (!current) continue;

    if (/^total$/i.test(colC)) {
      flushSection({
        boxes: toNum(row[4]),
        m3: toNum(row[6]),
        kg: toNum(row[8]),
      });
      continue;
    }

    if (!colC || /^total$/i.test(colC)) continue;

    const boxes = toNum(row[4]);
    const m3 = toNum(row[6]);
    const kg = toNum(row[8]);
    if (boxes <= 0 && m3 <= 0 && kg <= 0) continue;

    sectionBoxes += boxes;
    sectionM3 += m3;
    sectionKg += kg;
    current.boxes += boxes;
    current.volumeM3 += m3;
    current.grossKg += kg;
  }

  flushSection();

  if (lines.length === 0) return null;

  const totals = lines.reduce(
    (acc, l) => ({
      boxes: acc.boxes + l.boxes,
      volumeM3: acc.volumeM3 + l.volumeM3,
      grossKg: acc.grossKg + l.grossKg,
    }),
    { boxes: 0, volumeM3: 0, grossKg: 0 },
  );

  totals.volumeM3 = Math.round(totals.volumeM3 * 1000) / 1000;
  totals.grossKg = Math.round(totals.grossKg * 10) / 10;

  return { lines, totals, warnings };
}

export function parseSabaPackingListFromCsv(csv: string): SabaPackingListParse | null {
  if (!looksLikeSabaPackingList(csv)) return null;
  const rows = csv
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const out: string[] = [];
      let cur = "";
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]!;
        if (ch === '"') {
          inQ = !inQ;
          continue;
        }
        if (ch === "," && !inQ) {
          out.push(cur);
          cur = "";
          continue;
        }
        cur += ch;
      }
      out.push(cur);
      return out;
    });
  return parseSabaPackingListRows(rows);
}

export function parseSabaPackingListFromBuffer(
  buffer: Buffer,
  sourceFileName?: string,
): SabaPackingListParse | null {
  try {
    const wb = XLSX.read(buffer, { type: "buffer" });
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
      const parsed = parseSabaPackingListRows(rows as unknown[][]);
      if (parsed) {
        return { ...parsed, sourceFileName };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Visi užsakymo numeriai iš PL, surikiuoti. */
export function sabaOrderRefsJoined(lines: SabaPackingListLine[]): string {
  return [...new Set(lines.map((l) => l.orderRef))]
    .sort((a, b) => Number(a) - Number(b))
    .join(", ");
}

export function serializeSabaPackingListParse(
  parsed: SabaPackingListParse,
): string {
  return JSON.stringify(parsed);
}

export function parseSabaPackingListJson(
  json: string | null | undefined,
): SabaPackingListParse | null {
  if (!json?.trim()) return null;
  try {
    const j = JSON.parse(json) as SabaPackingListParse;
    if (!Array.isArray(j.lines) || !j.totals) return null;
    return j;
  } catch {
    return null;
  }
}
