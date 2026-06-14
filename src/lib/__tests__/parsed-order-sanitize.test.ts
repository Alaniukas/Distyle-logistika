import assert from "node:assert/strict";
import test from "node:test";
import {
  isConversationalOnlyBody,
  isGarbageManufacturerValue,
  isPlaceholderCountry,
  resolveOrderCountry,
  resolveOrderManufacturer,
} from "@/lib/parsed-order-sanitize";

test("isGarbageManufacturerValue rejects conversational lines", () => {
  assert.equal(isGarbageManufacturerValue("Thank you!"), true);
  assert.equal(isGarbageManufacturerValue("2026-06-10 08:13"), true);
  assert.equal(isGarbageManufacturerValue("Your order is ready for the pick-up."), true);
  assert.equal(isGarbageManufacturerValue("Furninova"), false);
  assert.equal(isGarbageManufacturerValue("Saba Italia"), false);
});

test("resolveOrderManufacturer uses inbound rule over garbage AI text", () => {
  const m = resolveOrderManufacturer(
    "Thank you!",
    "RE: [Bolia] Ready for collection",
    "pick-up address Merwedeweg 10",
    { key: "bolia", email: "bolia", name: "Bolia", countryHint: "Nyderlandai" },
  );
  assert.equal(m, "Bolia");
});

test("resolveOrderCountry never returns test placeholder", () => {
  const c = resolveOrderCountry("test", "Bolia shipment", "Merwedeweg 10 Zwijndrecht Netherlands");
  assert.equal(c, "Nyderlandai");
  assert.equal(isPlaceholderCountry(c), false);
});

test("isConversationalOnlyBody flags short thank-you replies", () => {
  assert.equal(isConversationalOnlyBody("Thank you!"), true);
  assert.equal(
    isConversationalOnlyBody("Ready for collection. Pick-up address: Via Roma 1, Italy."),
    false,
  );
});
