import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedSender } from "@/lib/sender-whitelist";

test("isAllowedSender rejects subject-only bolia match for random sender", async () => {
  const prevAllow = process.env.MAIL_ALLOW_ALL_WHEN_WHITELIST_EMPTY;
  const prevSenders = process.env.ALLOWED_SENDERS;
  process.env.MAIL_ALLOW_ALL_WHEN_WHITELIST_EMPTY = "false";
  process.env.ALLOWED_SENDERS = "colleague@distyle.lt";

  const ok = await isAllowedSender("random@example.com", "RE: [Bolia] Order ready");
  assert.equal(ok, false);

  if (prevAllow === undefined) delete process.env.MAIL_ALLOW_ALL_WHEN_WHITELIST_EMPTY;
  else process.env.MAIL_ALLOW_ALL_WHEN_WHITELIST_EMPTY = prevAllow;
  if (prevSenders === undefined) delete process.env.ALLOWED_SENDERS;
  else process.env.ALLOWED_SENDERS = prevSenders;
});

test("isAllowedSender allows explicit ALLOWED_SENDERS entry", async () => {
  const prevAllow = process.env.MAIL_ALLOW_ALL_WHEN_WHITELIST_EMPTY;
  const prevSenders = process.env.ALLOWED_SENDERS;
  process.env.MAIL_ALLOW_ALL_WHEN_WHITELIST_EMPTY = "false";
  process.env.ALLOWED_SENDERS = "colleague@distyle.lt,orders@digroup.lt";

  assert.equal(await isAllowedSender("colleague@distyle.lt"), true);
  assert.equal(await isAllowedSender("orders@digroup.lt"), true);
  assert.equal(await isAllowedSender("stranger@other.com"), false);

  if (prevAllow === undefined) delete process.env.MAIL_ALLOW_ALL_WHEN_WHITELIST_EMPTY;
  else process.env.MAIL_ALLOW_ALL_WHEN_WHITELIST_EMPTY = prevAllow;
  if (prevSenders === undefined) delete process.env.ALLOWED_SENDERS;
  else process.env.ALLOWED_SENDERS = prevSenders;
});

test("isAllowedSender allows known manufacturer From fragment", async () => {
  const prevAllow = process.env.MAIL_ALLOW_ALL_WHEN_WHITELIST_EMPTY;
  const prevSenders = process.env.ALLOWED_SENDERS;
  process.env.MAIL_ALLOW_ALL_WHEN_WHITELIST_EMPTY = "false";
  process.env.ALLOWED_SENDERS = "";

  assert.equal(await isAllowedSender("orders@sabaitalia.com"), true);
  assert.equal(await isAllowedSender("dorota_owl@mail.ru"), true);

  if (prevAllow === undefined) delete process.env.MAIL_ALLOW_ALL_WHEN_WHITELIST_EMPTY;
  else process.env.MAIL_ALLOW_ALL_WHEN_WHITELIST_EMPTY = prevAllow;
  if (prevSenders === undefined) delete process.env.ALLOWED_SENDERS;
  else process.env.ALLOWED_SENDERS = prevSenders;
});
