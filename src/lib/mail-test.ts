import { ImapFlow } from "imapflow";
import { graphIsConfigured, testGraphConnection } from "@/lib/graph-client";
import { createSmtpTransport } from "@/lib/send-carrier-email";
import { mailTlsOptions } from "@/lib/mail-tls";

export type MailTestResult = {
  mode: "graph" | "legacy";
  graph?: { ok: boolean; message: string; mailbox?: string };
  imap: { ok: boolean; message: string; mailbox?: string };
  smtp: { ok: boolean; message: string };
};

/**
 * Jei nustatytas Microsoft Graph — tikrina tik Graph (IMAP/SMTP nebenaudojami).
 * Kitu atveju — IMAP + SMTP verify (senasis kelias).
 */
export async function testMailConnections(): Promise<MailTestResult> {
  if (graphIsConfigured()) {
    const graph = await testGraphConnection();
    return {
      mode: "graph",
      graph,
      imap: { ok: false, message: "Nenaudojama — įjungtas Microsoft Graph" },
      smtp: { ok: false, message: "Nenaudojama — įjungtas Microsoft Graph" },
    };
  }

  const imapResult: MailTestResult["imap"] = { ok: false, message: "" };
  const smtpResult: MailTestResult["smtp"] = { ok: false, message: "" };

  const host = process.env.IMAP_HOST;
  const user = process.env.IMAP_USER;
  const pass = process.env.IMAP_PASSWORD;
  const port = Number(process.env.IMAP_PORT ?? 993);

  if (!host || !user || pass === undefined || pass === "") {
    imapResult.message = "Trūksta IMAP_HOST, IMAP_USER arba IMAP_PASSWORD";
  } else {
    const tls = mailTlsOptions();
    const client = new ImapFlow({
      host,
      port,
      secure: port !== 143,
      auth: { user, pass },
      logger: false,
      ...(tls ? { tls } : {}),
    });
    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        const mb = client.mailbox;
        imapResult.mailbox =
          mb && typeof mb === "object" && "path" in mb ? String(mb.path) : "INBOX";
      } finally {
        lock.release();
      }
      await client.logout();
      imapResult.ok = true;
      imapResult.message = "Prisijungta prie IMAP, INBOX pasiekiamas";
    } catch (e) {
      imapResult.message = e instanceof Error ? e.message : String(e);
    }
  }

  try {
    const transport = createSmtpTransport();
    await transport.verify();
    smtpResult.ok = true;
    smtpResult.message = "SMTP autentifikacija sėkminga (laiškas nesiųstas)";
  } catch (e) {
    smtpResult.message = e instanceof Error ? e.message : String(e);
  }

  return { mode: "legacy", imap: imapResult, smtp: smtpResult };
}
