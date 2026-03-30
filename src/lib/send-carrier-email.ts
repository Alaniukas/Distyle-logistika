import nodemailer from "nodemailer";
import {
  bccForRoute,
  effectiveCountryRoute,
  toEmailForRoute,
  type CountryRoute,
} from "@/lib/carriers";
import type { OrderForTemplate } from "@/lib/carrier-email-template";
import { getGraphClient, graphIsConfigured, graphMailboxUser } from "@/lib/graph-client";
import { mailTlsOptions } from "@/lib/mail-tls";

export function createSmtpTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !user || pass === undefined) {
    throw new Error("Trūksta SMTP_HOST, SMTP_USER arba SMTP_PASSWORD");
  }
  const tls = mailTlsOptions();
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass },
    ...(tls ? { tls } : {}),
  });
}

export type SendResult = {
  html: string;
  route: CountryRoute;
  to: string;
  bcc: string[];
  subject: string;
};

/**
 * Siunčia paruoštą HTML vežėjams (Graph arba SMTP pagal .env).
 */
export async function sendCarrierEmailHtml(
  order: OrderForTemplate,
  html: string,
  subject: string,
  emailSubject?: string | null,
): Promise<SendResult> {
  const route = effectiveCountryRoute(order.country, emailSubject);
  const to = toEmailForRoute(route);
  const bcc = bccForRoute(route);

  if (graphIsConfigured()) {
    const from = graphMailboxUser();
    const client = await getGraphClient();
    await client.api(`/users/${encodeURIComponent(from)}/sendMail`).post({
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: to } }],
        ...(bcc.length > 0
          ? { bccRecipients: bcc.map((address) => ({ emailAddress: { address } })) }
          : {}),
      },
      saveToSentItems: true,
    });
    return { html, route, to, bcc, subject };
  }

  const from = process.env.SMTP_USER!;
  const transport = createSmtpTransport();
  await transport.sendMail({
    from,
    to,
    bcc: bcc.length ? bcc.join(", ") : undefined,
    subject,
    html,
  });

  return { html, route, to, bcc, subject };
}

/** Vienam vežėjui (patvirtinimas užsakymui). */
export async function sendSingleCarrierEmailHtml(
  toEmail: string,
  html: string,
  subject: string,
): Promise<void> {
  if (graphIsConfigured()) {
    const from = graphMailboxUser();
    const client = await getGraphClient();
    await client.api(`/users/${encodeURIComponent(from)}/sendMail`).post({
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: toEmail } }],
      },
      saveToSentItems: true,
    });
    return;
  }
  const from = process.env.SMTP_USER!;
  const transport = createSmtpTransport();
  await transport.sendMail({
    from,
    to: toEmail,
    subject,
    html,
  });
}
