import { test } from "node:test";
import assert from "node:assert/strict";

import { compareCatalogCandidates } from "@/lib/catalog/query-ordering";
import {
  catalogCandidateSchema,
  catalogQuerySchema,
  type CatalogCandidate,
} from "@/lib/catalog/schema";

function candidate(
  variantId: string,
  roomaiSellingPrice: number | null,
): CatalogCandidate {
  return catalogCandidateSchema.parse({
    productId: `product-${variantId}`,
    variantId,
    countryCode: "US",
    categoryCode: "living_room",
    categoryName: "Living Room",
    furnitureTypeCode: "sofa",
    furnitureTypeName: "Sofa",
    productTitle: `Sofa ${variantId}`,
    roomaiDescription: null,
    normalizedColor: null,
    normalizedMaterial: null,
    normalizedStyle: null,
    configuration: null,
    seatingCapacity: null,
    widthCm: 200,
    depthCm: 90,
    heightCm: 80,
    weightKg: null,
    currency: "USD",
    roomaiSellingPrice,
    normalizedAvailability: "in_stock",
    deliveryText: null,
    estimatedDeliveryDaysMin: null,
    estimatedDeliveryDaysMax: null,
    vendorDataCheckedAt: null,
    roomaiPriceCalculatedAt: null,
    vendorName: "Test Vendor",
    productUrl: "https://example.com/product",
    primaryImageUrl: null,
  });
}

test("catalog query defaults to a bounded result limit", () => {
  const parsed = catalogQuerySchema.parse({
    countryCode: "US",
    furnitureTypeCode: "sofa",
  });

  assert.equal(parsed.limit, 20);
});

test("catalog query rejects result limits above the retrieval bound", () => {
  const parsed = catalogQuerySchema.safeParse({
    countryCode: "US",
    furnitureTypeCode: "sofa",
    limit: 51,
  });

  assert.equal(parsed.success, false);
});

test("catalog query accepts hard eligibility filters", () => {
  const parsed = catalogQuerySchema.parse({
    countryCode: "US",
    furnitureTypeCode: "sofa",
    normalizedAvailability: "in_stock",
    currency: "USD",
    maxPrice: 2500,
    maxWidthCm: 250,
    maxDepthCm: 110,
    maxHeightCm: 100,
    limit: 10,
  });

  assert.equal(parsed.normalizedAvailability, "in_stock");
  assert.equal(parsed.currency, "USD");
  assert.equal(parsed.maxPrice, 2500);
  assert.equal(parsed.maxWidthCm, 250);
  assert.equal(parsed.maxDepthCm, 110);
  assert.equal(parsed.maxHeightCm, 100);
  assert.equal(parsed.limit, 10);
});

test("catalog candidate ordering is deterministic by price then variant id", () => {
  const candidates = [
    candidate("variant-c", 1200),
    candidate("variant-b", 900),
    candidate("variant-a", 900),
    candidate("variant-null", null),
  ];

  const ordered = [...candidates].sort(compareCatalogCandidates);

  assert.deepEqual(
    ordered.map((item) => item.variantId),
    ["variant-a", "variant-b", "variant-c", "variant-null"],
  );
});
