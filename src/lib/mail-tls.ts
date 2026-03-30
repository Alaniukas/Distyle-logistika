/**
 * Antivirusas / įmonės SSL inspekcija kartais įterpia tarpinį sertifikatą —
 * Node.js meta „self-signed certificate in certificate chain“.
 * Į .env įrašyk MAIL_TLS_INSECURE=true tik vystymui; produkcijoje geriau įdiegti įmonės root CA.
 */
export function mailTlsOptions():
  | { rejectUnauthorized: false }
  | undefined {
  if (process.env.MAIL_TLS_INSECURE === "true") {
    return { rejectUnauthorized: false };
  }
  return undefined;
}
