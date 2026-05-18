import test from "node:test";
import assert from "node:assert/strict";

import { extractInternalIdFromText } from "@/lib/order-matcher";

test("extractInternalIdFromText finds TU# in subject", () => {
  assert.equal(
    extractInternalIdFromText("Re: Pervežimas ID: TU#20260039"),
    "TU#20260039",
  );
});

test("extractInternalIdFromText allows space after TU", () => {
  assert.equal(extractInternalIdFromText("Atsakymas dėl TU #20260039"), "TU#20260039");
});

test("extractInternalIdFromText returns null when missing", () => {
  assert.equal(extractInternalIdFromText("Kaina 500 EUR"), null);
});
