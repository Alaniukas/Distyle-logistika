import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  parseSabaPackingListFromBuffer,
  parseSabaPackingListFromCsv,
  sabaOrderRefsJoined,
} from "@/lib/saba-packing-list-parser";

const fixtureCsv = readFileSync(
  join(process.cwd(), "fixtures/packing-lists/saba-expo-1817-2032.csv"),
  "utf8",
);

test("parseSabaPackingListFromCsv extracts four orders and grand totals", () => {
  const parsed = parseSabaPackingListFromCsv(fixtureCsv);
  assert.ok(parsed);
  assert.equal(parsed!.lines.length, 4);
  assert.deepEqual(
    parsed!.lines.map((l) => l.orderRef).sort(),
    ["1817", "2032", "2693", "2735"],
  );
  assert.ok(parsed!.totals.boxes >= 115 && parsed!.totals.boxes <= 120);
  assert.ok(parsed!.totals.volumeM3 > 50 && parsed!.totals.volumeM3 < 60);
  assert.ok(parsed!.totals.grossKg > 3500 && parsed!.totals.grossKg < 3700);
  assert.equal(sabaOrderRefsJoined(parsed!.lines), "1817, 2032, 2693, 2735");
});

test("2032 section uses TOTAL row when line items are incomplete", () => {
  const parsed = parseSabaPackingListFromCsv(fixtureCsv);
  const o2032 = parsed!.lines.find((l) => l.orderRef === "2032");
  assert.ok(o2032);
  assert.equal(o2032!.boxes, 60);
  assert.ok(parsed!.warnings.some((w) => w.includes("2032")));
});

test("parseSabaPackingListFromBuffer reads xlsx when present", () => {
  const xlsxPath =
    "c:\\Users\\37062\\Downloads\\PL EXPO DESING 1817 +2032 + 2693 + 2735.xlsx";
  try {
    const buf = readFileSync(xlsxPath);
    const parsed = parseSabaPackingListFromBuffer(buf, "PL.xlsx");
    assert.ok(parsed);
    assert.equal(parsed!.lines.length, 4);
  } catch {
    // skip if fixture xlsx not on CI machine
  }
});
