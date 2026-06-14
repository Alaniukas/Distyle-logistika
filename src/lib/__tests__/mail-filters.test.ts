import test from "node:test";
import assert from "node:assert/strict";

import { isLikelyReplySubject } from "@/lib/inbound-mail-rules";
import { classifyMailPickupIntent } from "@/lib/mail-pickup-intent";

test("isLikelyReplySubject catches stacked prefixes like [Bolia] Reg.: FW: RE:", () => {
  const subject = "[Bolia] Reg.: FW: RE: When we can expect to get? Bolia:009102956";
  assert.equal(isLikelyReplySubject(subject), true);
});

test("isLikelyReplySubject does not flag normal subject", () => {
  const subject = "26W_18_2_EXKAUN.pdf, 26W_17_2_EXPO.pdf";
  assert.equal(isLikelyReplySubject(subject), false);
});

test("classifyMailPickupIntent allows strong pickup signals without AI key", async () => {
  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const prevStrict = process.env.MAIL_PICKUP_AI_STRICT;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  process.env.MAIL_PICKUP_AI_STRICT = "true";

  const result = await classifyMailPickupIntent({
    subject: "Loading list and pickup reference for collection",
    bodyText: "Ready for collection. Pick-up address: Merwedeweg 10.",
    attachmentNames: ["26W_18_2_EXKAUN.pdf", "packing_list.pdf"],
  });

  assert.equal(result.importOrder, true);

  if (prevKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  else process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;
  if (prevStrict === undefined) delete process.env.MAIL_PICKUP_AI_STRICT;
  else process.env.MAIL_PICKUP_AI_STRICT = prevStrict;
});

test("classifyMailPickupIntent rejects thank-you reply without pickup data", async () => {
  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const prevStrict = process.env.MAIL_PICKUP_AI_STRICT;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  process.env.MAIL_PICKUP_AI_STRICT = "true";

  const result = await classifyMailPickupIntent({
    subject: "RE: [Bolia] Order status",
    bodyText: "Thank you!",
    attachmentNames: [],
  });

  assert.equal(result.importOrder, false);

  if (prevKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  else process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;
  if (prevStrict === undefined) delete process.env.MAIL_PICKUP_AI_STRICT;
  else process.env.MAIL_PICKUP_AI_STRICT = prevStrict;
});

test("classifyMailPickupIntent rejects weak signal mail in strict no-key mode", async () => {
  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const prevStrict = process.env.MAIL_PICKUP_AI_STRICT;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  process.env.MAIL_PICKUP_AI_STRICT = "true";

  const result = await classifyMailPickupIntent({
    subject: "Weekly status update",
    bodyText: "Please confirm if timeline changed.",
    attachmentNames: [],
  });

  assert.equal(result.importOrder, false);

  if (prevKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  else process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;
  if (prevStrict === undefined) delete process.env.MAIL_PICKUP_AI_STRICT;
  else process.env.MAIL_PICKUP_AI_STRICT = prevStrict;
});
