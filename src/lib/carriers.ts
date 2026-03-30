/**
 * Šalies → vežėjų BCC ir „To“ (orders@digroup.lt) pagal n8n „Vėžėjai“ workflow.
 */
export type CountryRoute = "italy" | "poland" | "benelux" | "test";

/** Rodymui užsakymo kortelėje (LT), kai AI neveikia, bet tema žinoma. */
export function countryLabelFromRoute(route: CountryRoute | null): string | null {
  if (!route || route === "test") return null;
  switch (route) {
    case "italy":
      return "Italija";
    case "poland":
      return "Lenkija";
    case "benelux":
      return "Nyderlandai";
    default:
      return null;
  }
}

/** Temoje dažnai būna užuominų (pvz. „Test Furninova“ → IT, „Bolia“ → PL). */
export function inferRouteFromSubject(subject: string | null | undefined): CountryRoute | null {
  if (!subject?.trim()) return null;
  const s = subject.toLowerCase();
  if (s.includes("furninova")) return "poland";
  if (s.includes("bolia")) return "benelux";
  if (s.includes("saba")) return "italy";
  return null;
}

export function resolveCountryRoute(country: string): CountryRoute {
  const c = country.toLowerCase().trim();
  if (c === "test" || c === "testing") return "benelux";
  if (c.includes("saba") || c.includes("ital")) return "italy";
  if (
    /lenk|pola|polsk|furninova|\bpl\b|^pl$|poland/i.test(c)
  ) {
    return "poland";
  }
  if (/nyde|neth|nether|bolia|\bnl\b|^nl$/i.test(c)) return "benelux";
  // Kita (pvz. DE, ES) — bendras sąrašas kaip Benelux šaka n8n logikoje
  return "benelux";
}

/** Maršrutas siuntimui: aiški šalis iš užsakymo > temos žodžiai (pvz. „Bolia“ temoje, bet pakrovimas NL). */
export function effectiveCountryRoute(
  country: string,
  emailSubject: string | null | undefined,
): CountryRoute {
  const c = country.toLowerCase().trim();
  const ambiguous = c === "test" || c === "testing" || c.length < 2;
  const fromCountry = resolveCountryRoute(country);
  if (!ambiguous) {
    return fromCountry;
  }
  return inferRouteFromSubject(emailSubject) ?? fromCountry;
}

const ITALY_BCC = [
  "asta.gudiskiene@axistransport.lt",
  "darius.karaliunas@kuehne-nagel.com",
  "italy@easting.lt",
  "urte.meskauskaite@gevara.lt",
  "italy@gevara.lt",
  "jurgita.korolioviene@dhl.com",
  "lukas@cargobooking.lt",
];

const POLAND_BCC = [
  "asta.gudiskiene@axistransport.lt",
  "Edita.Kubiliute@hellmann.com",
  "urte.meskauskaite@gevara.lt",
  "jurgita.korolioviene@dhl.com",
  "mantas.andriukaitis@rhenus.com",
  "poland@easting.lt",
  "poland@gevara.lt",
];

const BENELUX_BCC = [
  "ami@ntglithuania.lt",
  "asta.gudiskiene@axistransport.lt",
  "gstrazdas@bsc.lt",
  "elvyra.ronkaitiene@easting.lt",
  "urte.meskauskaite@gevara.lt",
  "sales@gevara.lt",
  "iba@ntglithuania.lt",
  "jurgita.korolioviene@dhl.com",
];

export function bccForRoute(route: CountryRoute): string[] {
  switch (route) {
    case "italy":
      return [...ITALY_BCC];
    case "poland":
      return [...POLAND_BCC];
    case "benelux":
      return [...BENELUX_BCC];
    case "test":
      return [...BENELUX_BCC];
    default:
      return [...BENELUX_BCC];
  }
}

const DEFAULT_CARRIER_TO = "orders@digroup.lt";

/** „To“: bendra dėžutė kaip n8n (galima perrašyti CARRIER_ORDERS_TO_EMAIL). */
export function toEmailForRoute(_route: CountryRoute): string {
  return process.env.CARRIER_ORDERS_TO_EMAIL?.trim() || DEFAULT_CARRIER_TO;
}

/** Visi žinomi vežėjų adresai (atsakymų atpažinimui iš pašto). */
export function allKnownCarrierEmails(): Set<string> {
  const s = new Set<string>();
  for (const r of ["italy", "poland", "benelux"] as const) {
    for (const e of bccForRoute(r)) {
      s.add(e.toLowerCase());
    }
  }
  const inbox = toEmailForRoute("benelux").toLowerCase();
  if (inbox) s.add(inbox);
  return s;
}
