import { graphIsConfigured } from "@/lib/graph-client";
import { syncInboxFromGraph } from "@/lib/graph-mail-sync";
import { syncInboxFromImap } from "@/lib/imap-sync";
import { authorizeCronOrSyncRequest } from "@/lib/inbound-mail-rules";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET/POST /api/cron/sync-mail — Vercel Cron (Bearer CRON_SECRET arba SYNC_SECRET).
 * Ta pati logika kaip POST /api/internal/sync-mail.
 */
async function run(req: Request) {
  if (!authorizeCronOrSyncRequest(req)) {
    return NextResponse.json({ error: "Neteisingas arba trūksta Bearer token" }, { status: 401 });
  }

  try {
    const result = graphIsConfigured()
      ? await syncInboxFromGraph()
      : await syncInboxFromImap();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Nežinoma klaida";
    return NextResponse.json(
      {
        ok: false,
        error: message,
        hint: graphIsConfigured()
          ? "Patikrinkite Entra programos teises (Mail.Read, Mail.Send) ir administratoriaus sutikimą."
          : "Microsoft 365: naudokite Graph — užpildykite AZURE_* ir GRAPH_MAILBOX_USER.",
      },
      { status: 502 },
    );
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
