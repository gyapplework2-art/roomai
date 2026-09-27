import { test } from "node:test";
import assert from "node:assert/strict";

import {
  rankCatalogCandidate,
  rankCatalogCandidates,
} from "@/lib/catalog/candidate-ranking";
import {
  catalogCandidateSchema,
  type CatalogCandidate,
} from "@/lib/catalog/schema";

function candidate(
  variantId: string,
  overrides: Partial<CatalogCandidate> = {},
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
    normalizedColor: "tan",
    normalizedMaterial: "leather",
    normalizedStyle: "modern",
    configuration: "3-seat",
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
    vendorName: "Test Vendor",
    productUrl: "https://example.com/product",
    primaryImageUrl: null,
    ...overrides,
  });
}

test("complete candidate receives the maximum quality score", () => {
  const ranked = rankCatalogCandidate(candidate("complete"));

  assert.equal(ranked.score, 100);
  assert.deepEqual(ranked.scoreBreakdown, {
    dimensions: 40,
    visualMetadata: 30,
    productMetadata: 20,
    price: 10,
  });
});

test("complete dimensions are strongly preferred over missing dimensions", () => {
  const complete = candidate("complete");
  const incomplete = candidate("incomplete", {
    widthCm: null,
    depthCm: null,
    heightCm: null,
  });

  const ranked = rankCatalogCandidates([incomplete, complete]);

  assert.equal(ranked[0].candidate.variantId, "complete");
  assert.equal(ranked[0].scoreBreakdown.dimensions, 40);
  assert.equal(ranked[1].scoreBreakdown.dimensions, 0);
});

test("visual metadata completeness improves candidate quality", () => {
  const complete = candidate("complete");
  const incomplete = candidate("incomplete", {
    normalizedStyle: null,
    normalizedMaterial: null,
    normalizedColor: null,
  });

  const ranked = rankCatalogCandidates([incomplete, complete]);

  assert.equal(ranked[0].candidate.variantId, "complete");
  assert.equal(ranked[0].scoreBreakdown.visualMetadata, 30);
  assert.equal(ranked[1].scoreBreakdown.visualMetadata, 0);
});

test("known price is rewarded but cheaper price is not inherently preferred", () => {
  const expensive = candidate("expensive", {
    roomaiSellingPrice: 5000,
  });
  const cheap = candidate("cheap", {
    roomaiSellingPrice: 500,
  });
  const unknown = candidate("unknown", {
    roomaiSellingPrice: null,
  });

  const expensiveScore = rankCatalogCandidate(expensive);
  const cheapScore = rankCatalogCandidate(cheap);
  const unknownScore = rankCatalogCandidate(unknown);

  assert.equal(expensiveScore.score, cheapScore.score);
  assert.equal(expensiveScore.scoreBreakdown.price, 10);
  assert.equal(cheapScore.scoreBreakdown.price, 10);
  assert.equal(unknownScore.scoreBreakdown.price, 0);
});

test("candidate ranking does not prefer particular aesthetic values", () => {
  const first = candidate("first", {
    normalizedStyle: "modern",
    normalizedMaterial: "leather",
    normalizedColor: "tan",
  });
  const second = candidate("second", {
    normalizedStyle: "traditional",
    normalizedMaterial: "velvet",
    normalizedColor: "purple",
  });

  assert.equal(
    rankCatalogCandidate(first).score,
    rankCatalogCandidate(second).score,
  );
});

test("candidate ranking is deterministic by variant id when scores tie", () => {
  const ranked = rankCatalogCandidates([
    candidate("variant-c"),
    candidate("variant-a"),
    candidate("variant-b"),
  ]);

  assert.deepEqual(
    ranked.map((item) => item.candidate.variantId),
    ["variant-a", "variant-b", "variant-c"],
  );
});

test("ranking does not mutate the supplied candidate array", () => {
  const candidates = [
    candidate("variant-b"),
    candidate("variant-a"),
  ];

  rankCatalogCandidates(candidates);

  assert.deepEqual(
    candidates.map((item) => item.variantId),
    ["variant-b", "variant-a"],
  );
});
