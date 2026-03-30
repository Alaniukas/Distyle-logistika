import { graphIsConfigured } from "@/lib/graph-client";
import { syncInboxFromGraph } from "@/lib/graph-mail-sync";
import { syncInboxFromImap } from "@/lib/imap-sync";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/internal/sync-mail
 * Header: Authorization: Bearer <SYNC_SECRET>
 *
 * Jei nustatytas Microsoft Graph — skaito per Graph API; kitaip IMAP (UNSEEN).
 * Filtrai: ALLOWED_SENDERS, MAIL_SUBJECT_FILTER (nebūtina), tik pirmi laiškai (ne RE / ne gija).
 * Cron: GET /api/cron/sync-mail (Bearer CRON_SECRET arba SYNC_SECRET).
 */
export async function POST(req: Request) {
  const secret = process.env.SYNC_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "Nenustatytas SYNC_SECRET .env faile" },
      { status: 500 },
    );
  }

  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (token !== secret) {
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
          : "Microsoft 365 su Security defaults: naudokite Graph — užpildykite AZURE_* ir GRAPH_MAILBOX_USER .env faile.",
      },
      { status: 502 },
    );
  }
}
