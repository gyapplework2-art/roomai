import assert from "node:assert/strict";
import test from "node:test";

import {
  rankCatalogAlternative,
  rankCatalogAlternatives,
} from "@/lib/catalog/alternative-ranking";
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
    productTitle: `Sofa ${variantId}`,
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

test("a close substitute ranks above a poor substitute", () => {
  const current = candidate("current");

  const close = candidate("close", {
    widthCm: 225,
    depthCm: 98,
    heightCm: 84,
    roomaiSellingPrice: 1850,
  });

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

  const ranked = rankCatalogAlternatives(current, [poor, close]);

  assert.equal(ranked[0].candidate.variantId, "close");
  assert.ok(ranked[0].score > ranked[1].score);
});

test("unavailable products receive an availability penalty", () => {
  const current = candidate("current");

  const available = candidate("available");
  const unavailable = candidate("unavailable", {
    normalizedAvailability: "out_of_stock",
  });

  const availableScore = rankCatalogAlternative(current, available);
  const unavailableScore = rankCatalogAlternative(current, unavailable);

  assert.equal(availableScore.availabilityPenalty, 0);
  assert.equal(unavailableScore.availabilityPenalty, 25);
  assert.ok(availableScore.score > unavailableScore.score);
});

test("missing metadata receives neutral partial credit", () => {
  const current = candidate("current");

  const incomplete = candidate("incomplete", {
    normalizedColor: null,
    normalizedMaterial: null,
    normalizedStyle: null,
    configuration: null,
    seatingCapacity: null,
    widthCm: null,
    depthCm: null,
    heightCm: null,
    currency: null,
    roomaiSellingPrice: null,
  });

  const ranked = rankCatalogAlternative(current, incomplete);

  assert.ok(ranked.score > 0);
  assert.equal(ranked.scoreBreakdown.color, 5);
  assert.equal(ranked.scoreBreakdown.material, 5);
  assert.equal(ranked.scoreBreakdown.style, 7.5);
  assert.equal(ranked.scoreBreakdown.configuration, 7.5);
  assert.equal(ranked.scoreBreakdown.seatingCapacity, 5);
  assert.equal(ranked.scoreBreakdown.dimensions, 15);
  assert.equal(ranked.scoreBreakdown.price, 5);
});

test("equal scores use variant id as a deterministic tie breaker", () => {
  const current = candidate("current");

  const ranked = rankCatalogAlternatives(current, [
    candidate("variant-b"),
    candidate("variant-a"),
  ]);

  assert.deepEqual(
    ranked.map((item) => item.candidate.variantId),
    ["variant-a", "variant-b"],
  );
});
