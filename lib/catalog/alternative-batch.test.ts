import assert from "node:assert/strict";
import test from "node:test";

import { rankAlternativesFromCandidatePool } from "@/lib/catalog/alternative-batch";
import type { CatalogCandidate } from "@/lib/catalog/schema";

function candidate(
  variantId: string,
  overrides: Partial<CatalogCandidate> = {},
): CatalogCandidate {
  return {
    productId: `product-${variantId}`,
    variantId,
    countryCode: "US",
    categoryCode: "seating",
    categoryName: "Seating",
    furnitureTypeCode: "sofa",
    furnitureTypeName: "Sofa",
    productTitle: `Product ${variantId}`,
    roomaiDescription: null,
    normalizedColor: "tan",
    normalizedMaterial: "leather",
    normalizedStyle: "modern",
    configuration: "standard",
    seatingCapacity: 3,
    widthCm: 220,
    depthCm: 95,
    heightCm: 85,
    weightKg: null,
    currency: "USD",
    roomaiSellingPrice: 1800,
    normalizedAvailability: "in_stock",
    deliveryText: null,
    estimatedDeliveryDaysMin: null,
    estimatedDeliveryDaysMax: null,
    vendorDataCheckedAt: null,
    roomaiPriceCalculatedAt: null,
    vendorName: "Internal test vendor",
    productUrl: "https://example.com/product",
    primaryImageUrl: null,
    ...overrides,
  };
}

test("uses only candidates with the same country and furniture type", () => {
  const current = candidate("current");

  const ranked = rankAlternativesFromCandidatePool(
    current,
    [
      current,
      candidate("sofa-us"),
      candidate("rug-us", {
        furnitureTypeCode: "rug",
        furnitureTypeName: "Rug",
      }),
      candidate("sofa-ca", {
        countryCode: "CA",
      }),
    ],
    10,
  );

  assert.deepEqual(
    ranked.map((item) => item.candidate.variantId),
    ["sofa-us"],
  );
});

test("excludes the current variant", () => {
  const current = candidate("current");

  const ranked = rankAlternativesFromCandidatePool(
    current,
    [
      current,
      candidate("alternative"),
    ],
    10,
  );

  assert.deepEqual(
    ranked.map((item) => item.candidate.variantId),
    ["alternative"],
  );
});

test("ranks suitable candidates before applying the result limit", () => {
  const current = candidate("current");

  const poor = candidate("poor", {
    normalizedColor: "blue",
    normalizedMaterial: "fabric",
    normalizedStyle: "traditional",
    configuration: "sectional",
    seatingCapacity: 6,
    widthCm: 340,
    depthCm: 160,
    heightCm: 110,
    roomaiSellingPrice: 3500,
  });

  const close = candidate("close", {
    widthCm: 225,
    depthCm: 98,
    heightCm: 84,
    roomaiSellingPrice: 1850,
  });

  const ranked = rankAlternativesFromCandidatePool(
    current,
    [poor, close],
    1,
  );

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].candidate.variantId, "close");
});
