import { test } from "node:test";
import assert from "node:assert/strict";

import { deduplicateCatalogCandidates, resolveFurnitureTypeCode } from "@/lib/catalog/integration";
import { furnitureObjectSchema } from "@/lib/designs/schema";

const candidate = (variantId: string) => ({
  productId: `product-${variantId}`,
  variantId,
  countryCode: "US",
  categoryCode: "living_room",
  categoryName: "Living Room",
  furnitureTypeCode: "area_rug",
  furnitureTypeName: "Area Rug",
  productTitle: "Test Rug",
  roomaiDescription: null,
  normalizedColor: null,
  normalizedMaterial: null,
  normalizedStyle: null,
  configuration: null,
  seatingCapacity: null,
  widthCm: 100,
  depthCm: 100,
  heightCm: 1,
  weightKg: null,
  currency: "USD",
  roomaiSellingPrice: 100,
  normalizedAvailability: "in_stock",
  deliveryText: null,
  estimatedDeliveryDaysMin: null,
  estimatedDeliveryDaysMax: null,
  vendorDataCheckedAt: null,
  roomaiPriceCalculatedAt: null,
});

test("resolves only supported furniture type aliases", () => {
  assert.equal(resolveFurnitureTypeCode("rug"), "area_rug");
  assert.equal(resolveFurnitureTypeCode(" Area   Rug "), "area_rug");
  assert.equal(resolveFurnitureTypeCode("area_rug"), "area_rug");
  assert.equal(resolveFurnitureTypeCode("sofa"), null);
});

test("deduplicates catalog candidates by variantId", () => {
  const first = candidate("variant-1");
  const duplicate = { ...first, productTitle: "Duplicate" };
  const second = candidate("variant-2");

  assert.deepEqual(deduplicateCatalogCandidates([first, duplicate, second]), [first, second]);
});

test("furniture schema does not expose catalog identity fields", () => {
  const result = furnitureObjectSchema.safeParse({
    objectId: "object-1",
    category: "rug",
    name: "Rug",
    description: "A rug",
    material: "wool",
    color: "ivory",
    dimensions: { widthCm: 100, depthCm: 100, heightCm: 1 },
    position: { xCm: 0, yCm: 0, zCm: 0 },
    rotationDegrees: 0,
    required: true,
    estimatedPrice: 100,
    reasoning: "Fits the room.",
    productId: "product-1",
    variantId: "variant-1",
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal("productId" in result.data, false);
    assert.equal("variantId" in result.data, false);
  }
});
