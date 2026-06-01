import test from "node:test";
import assert from "node:assert/strict";

import { bodyTextForIngest } from "@/lib/mail-ingest-parser";

test("bodyTextForIngest keeps forwarded Furninova content for FW subject", () => {
  const full = `Sveikas, peradresuoju.

From: Dorota Swyd <dorota_owl@mail.ru>
Sent: Friday, 29 May, 2026 11:36
Subject: Re: About current orders

Please find attached both loading lists:
- loading list nr: 26W/24/2/EXPO for pick up from 9.06.2026`;

  const ingest = bodyTextForIngest("FW: About current orders", full, ["26W_24_2_EXPO.pdf"]);
  assert.match(ingest, /26W\/24\/2\/EXPO/);
  assert.match(ingest, /loading list/i);
});
