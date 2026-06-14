import { PrismaClient } from "@prisma/client";
import {
  isGarbageManufacturerValue,
  isPlaceholderCountry,
} from "../src/lib/parsed-order-sanitize";

const prisma = new PrismaClient();

function hasStructuredOrderData(order: {
  packingListBreakdownJson: string | null;
  weightKg: number | null;
  volumeM3: number | null;
  pickupAddress: string;
  pickupReference: string;
  cargoValue: number | null;
}): boolean {
  return Boolean(
    order.packingListBreakdownJson?.trim() ||
      (order.weightKg != null && order.volumeM3 != null) ||
      (order.pickupAddress &&
        order.pickupAddress !== "Adresas laiške" &&
        order.pickupAddress.length >= 12) ||
      order.pickupReference?.trim() ||
      order.cargoValue != null,
  );
}

function isJunkOrder(order: {
  manufacturer: string;
  country: string;
  status: string;
  sentAt: Date | null;
  packingListBreakdownJson: string | null;
  weightKg: number | null;
  volumeM3: number | null;
  pickupAddress: string;
  pickupReference: string;
  cargoValue: number | null;
}): boolean {
  if (order.status === "sent_to_carriers" && order.sentAt) {
    return false;
  }
  if (hasStructuredOrderData(order)) {
    return false;
  }
  if (isGarbageManufacturerValue(order.manufacturer)) {
    return true;
  }
  if (isPlaceholderCountry(order.country)) {
    return true;
  }
  return false;
}

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      internalId: true,
      manufacturer: true,
      country: true,
      status: true,
      source: true,
      weightKg: true,
      volumeM3: true,
      pickupAddress: true,
      pickupReference: true,
      packingListBreakdownJson: true,
      cargoValue: true,
      sentAt: true,
      createdAt: true,
    },
  });

  const junk = orders.filter(isJunkOrder);
  const keep = orders.filter((o) => !isJunkOrder(o));

  console.log(`Viso užsakymų: ${orders.length}`);
  console.log(`Paliekama: ${keep.length}`);
  console.log(`Šalinama (šiukšlės): ${junk.length}`);
  console.log("--- Šalinami ---");
  for (const o of junk) {
    console.log(
      `${o.internalId}\t${o.manufacturer.slice(0, 50)}\t${o.country}\t${o.status}\t${o.createdAt.toISOString().slice(0, 10)}`,
    );
  }

  if (dryRun) {
    console.log("\n(dry-run — niekas neištrinta)");
    return;
  }

  if (junk.length === 0) {
    console.log("\nNėra ką trinti.");
    return;
  }

  const ids = junk.map((o) => o.id);
  const deleted = await prisma.order.deleteMany({ where: { id: { in: ids } } });
  console.log(`\nIštrinta užsakymų: ${deleted.count} (ingestedMail/offers — cascade)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
