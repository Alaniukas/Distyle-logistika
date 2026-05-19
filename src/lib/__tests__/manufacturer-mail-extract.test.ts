import test from "node:test";
import assert from "node:assert/strict";

import {
  extractBoliaPalletDimensions,
  extractFurninovaLoadingListRef,
  extractSabaPickupAddress,
} from "@/lib/manufacturer-mail-extract";

test("extractSabaPickupAddress pulls street and CAP from typical loading mail", () => {
  const body = `SABA ITALIA SRL

VIA DELL'INDUSTRIA, 17

35018 SAN MARTINO DI LUPARI (PD)

Warehouse hours: 08:30-12:00/14:00-18:00

Loading Details
The sofas are packed`;

  const addr = extractSabaPickupAddress(body);
  assert.ok(addr);
  assert.match(addr!, /VIA DELL'INDUSTRIA/i);
  assert.match(addr!, /35018 SAN MARTINO/i);
});

test("extractFurninovaLoadingListRef from Dorota reply subject", () => {
  const ref = extractFurninovaLoadingListRef(
    "Re: About new orders - loading list nr: 26W/22/2/EXPO",
    "Please find attached updated loading list",
  );
  assert.equal(ref, "26W/22/2/EXPO");
});

test("extractBoliaPalletDimensions captures pallet count and sizes", () => {
  const body = `2 pallets    WxLxH

145 x 95 x 120 cm

125 x 85 x 60 cm

Pick-up address:
Oranje Transport / Bolia`;

  const dims = extractBoliaPalletDimensions(body);
  assert.ok(dims);
  assert.match(dims!, /2 paletės/i);
  assert.match(dims!, /145 x 95 x 120/i);
  assert.match(dims!, /125 x 85 x 60/i);
});
