import test from "node:test";
import assert from "node:assert/strict";

import { resolveGraphMessageText } from "@/lib/mail-ingest-parser";

test("resolveGraphMessageText prefers uniqueBody over full body", () => {
  const r = resolveGraphMessageText({
    uniqueBody: {
      contentType: "text",
      content: "Please find attached both loading lists:\n26W/24/2/EXPO",
    },
    body: {
      contentType: "text",
      content: `From: old@example.com\nOld thread with many order numbers.`,
    },
  });
  assert.equal(r.bodySource, "uniqueBody");
  assert.match(r.ingestBody, /loading lists/i);
  assert.doesNotMatch(r.ingestBody, /From: old@example.com/);
  assert.match(r.fullBody, /From: old@example.com/);
});

test("resolveGraphMessageText falls back to body when uniqueBody empty", () => {
  const r = resolveGraphMessageText({
    uniqueBody: { contentType: "text", content: "  " },
    body: { contentType: "text", content: "Ready for collection at warehouse." },
  });
  assert.equal(r.bodySource, "body");
  assert.match(r.ingestBody, /Ready for collection/i);
});
