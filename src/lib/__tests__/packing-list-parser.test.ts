import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  packingListOrderRefsJoined,
  parsePackingListJson,
  serializePackingListParse,
  tryExtractPackingListFromAttachments,
} from "@/lib/packing-list-parser";
import { parseSabaPackingListFromCsv } from "@/lib/saba-packing-list-parser";

const fixtureCsv = readFileSync(
  join(process.cwd(), "fixtures/packing-lists/saba-expo-1817-2032.csv"),
  "utf8",
);

test("parsePackingListJson reads universal format with legacy zone field", () => {
  const saba = parseSabaPackingListFromCsv(fixtureCsv);
  assert.ok(saba);
  const json = serializePackingListParse({
    format: "saba",
    lines: saba.lines.map((l) => ({
      orderRef: l.orderRef,
      label: l.zone,
      boxes: l.boxes,
      volumeM3: l.volumeM3,
      grossKg: l.grossKg,
    })),
    totals: saba.totals,
    warnings: saba.warnings,
  });
  const parsed = parsePackingListJson(json);
  assert.equal(parsed?.format, "saba");
  assert.equal(parsed?.lines[0]?.label, saba.lines[0]?.zone);
});

test("tryExtractPackingListFromAttachments parses Saba CSV attachment", () => {
  const buffer = Buffer.from(fixtureCsv, "utf8");
  const pl = tryExtractPackingListFromAttachments(
    [
      {
        id: "1",
        name: "PL.csv",
        contentBytes: buffer.toString("base64"),
      },
    ],
    {
      subject: "FW: READY GOODS",
      bodyText: "Saba Italia ready for collection",
      fromAddress: "orders@sabaitalia.com",
      manufacturerHint: "Saba Italia",
    },
  );
  assert.ok(pl);
  assert.equal(pl.format, "saba");
  assert.equal(packingListOrderRefsJoined(pl.lines), "1817, 2032, 2693, 2735");
  assert.ok(pl.totals.grossKg > 3000);
});
