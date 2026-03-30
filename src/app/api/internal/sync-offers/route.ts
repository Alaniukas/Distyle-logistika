import { graphIsConfigured } from "@/lib/graph-client";
import { syncCarrierOffersFromGraph } from "@/lib/graph-offer-sync";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/internal/sync-offers — importuoti vežėjų atsakymus iš pašto (Graph).
 */
export async function POST(req: Request) {
  const secret = process.env.SYNC_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "Nenustatytas SYNC_SECRET" }, { status: 500 });
  }
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (token !== secret) {
    return NextResponse.json({ error: "Neteisingas Bearer" }, { status: 401 });
  }
  if (!graphIsConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Reikia Microsoft Graph (AZURE_* ir GRAPH_MAILBOX_USER)" },
      { status: 400 },
    );
  }
  try {
    const result = await syncCarrierOffersFromGraph();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Klaida";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
