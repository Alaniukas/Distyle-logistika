import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";

let clientPromise: Promise<Client> | null = null;

/**
 * Kai nustatyti AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, GRAPH_MAILBOX_USER —
 * naudojamas Microsoft Graph (client credentials), suderinama su Security defaults.
 */
export function graphIsConfigured(): boolean {
  return Boolean(
    process.env.AZURE_TENANT_ID?.trim() &&
      process.env.AZURE_CLIENT_ID?.trim() &&
      process.env.AZURE_CLIENT_SECRET &&
      process.env.GRAPH_MAILBOX_USER?.trim(),
  );
}

export function graphMailboxUser(): string {
  const u = process.env.GRAPH_MAILBOX_USER?.trim();
  if (!u) throw new Error("Trūksta GRAPH_MAILBOX_USER (pvz. orders@digroup.lt)");
  return u;
}

export async function getGraphClient(): Promise<Client> {
  if (!graphIsConfigured()) {
    throw new Error(
      "Microsoft Graph: trūksta AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET arba GRAPH_MAILBOX_USER",
    );
  }
  if (!clientPromise) {
    const tenantId = process.env.AZURE_TENANT_ID!.trim();
    const clientId = process.env.AZURE_CLIENT_ID!.trim();
    const clientSecret = process.env.AZURE_CLIENT_SECRET!;
    const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: ["https://graph.microsoft.com/.default"],
    });
    clientPromise = Promise.resolve(
      Client.initWithMiddleware({
        authProvider,
      }),
    );
  }
  return clientPromise;
}

export async function testGraphConnection(): Promise<{
  ok: boolean;
  message: string;
  mailbox?: string;
}> {
  try {
    const client = await getGraphClient();
    const mailbox = graphMailboxUser();
    await client.api(`/users/${encodeURIComponent(mailbox)}/messages`).top(1).get();
    return {
      ok: true,
      message: "Prisijungta prie Microsoft Graph, pašto dėžutė pasiekiama",
      mailbox,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
