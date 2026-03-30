import { testMailConnections } from "@/lib/mail-test";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/internal/mail-test
 * Header: Authorization: Bearer <SYNC_SECRET>
 *
 * Tikrina IMAP prisijungimą ir SMTP verify() — be laiško siuntimo.
 */
export async function POST(req: Request) {
  const secret = process.env.SYNC_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error: "Nenustatytas SYNC_SECRET .env faile",
        imap: null,
        smtp: null,
      },
      { status: 200 },
    );
  }

  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (token !== secret) {
    return NextResponse.json(
      {
        ok: false,
        error: "Neteisingas arba trūksta Bearer token",
        hint: 'Naudok: Authorization: Bearer <SYNC_SECRET> (turi sutapti su .env, be tarpų skirtumo)',
      },
      { status: 401 },
    );
  }

  try {
    const result = await testMailConnections();
    const allOk =
      result.mode === "graph"
        ? Boolean(result.graph?.ok)
        : result.imap.ok && result.smtp.ok;
    return NextResponse.json({ ok: allOk, ...result }, { status: 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        ok: false,
        fatalError: message,
        imap: null,
        smtp: null,
      },
      { status: 200 },
    );
  }
}
