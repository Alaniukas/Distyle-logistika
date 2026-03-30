import { graphIsConfigured } from "@/lib/graph-client";
import { syncCarrierOffersFromGraph } from "@/lib/graph-offer-sync";
import { authorizeCronOrSyncRequest } from "@/lib/inbound-mail-rules";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function run(req: Request) {
  if (!authorizeCronOrSyncRequest(req)) {
    return NextResponse.json({ error: "Neteisingas arba trūksta Bearer token" }, { status: 401 });
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

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
