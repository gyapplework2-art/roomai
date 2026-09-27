import { test } from "node:test";
import assert from "node:assert/strict";

import {
  rankCatalogCandidates,
  type RankedCatalogCandidate,
} from "@/lib/catalog/candidate-ranking";
import { selectDiverseCatalogCandidates } from "@/lib/catalog/candidate-diversity";
import {
  catalogCandidateSchema,
  type CatalogCandidate,
} from "@/lib/catalog/schema";

function candidate(
  productId: string,
  variantId: string,
  overrides: Partial<CatalogCandidate> = {},
): CatalogCandidate {
  return catalogCandidateSchema.parse({
    productId,
    variantId,
    countryCode: "US",
    categoryCode: "living_room",
    categoryName: "Living Room",
    furnitureTypeCode: "sofa",
    furnitureTypeName: "Sofa",
    productTitle: `Sofa ${productId}`,
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

function ranked(
  candidates: CatalogCandidate[],
): RankedCatalogCandidate[] {
  return rankCatalogCandidates(candidates);
}

test("prefers distinct products before additional variants", () => {
  const candidates = ranked([
    candidate("product-a", "a-1"),
    candidate("product-a", "a-2"),
    candidate("product-b", "b-1"),
    candidate("product-c", "c-1"),
  ]);

  const selected = selectDiverseCatalogCandidates(candidates, 3);

  assert.deepEqual(
    selected.map((item) => item.candidate.productId),
    ["product-a", "product-b", "product-c"],
  );
});

test("fills remaining capacity with additional variants after product diversity", () => {
  const candidates = ranked([
    candidate("product-a", "a-1"),
    candidate("product-a", "a-2"),
    candidate("product-b", "b-1"),
  ]);

  const selected = selectDiverseCatalogCandidates(candidates, 3);

  assert.deepEqual(
    selected.map((item) => item.candidate.variantId),
    ["a-1", "b-1", "a-2"],
  );
});

test("preserves ranked order within each diversity pass", () => {
  const candidates = ranked([
    candidate("product-b", "b-1", {
      normalizedStyle: null,
    }),
    candidate("product-a", "a-1"),
    candidate("product-c", "c-1", {
      normalizedStyle: null,
      normalizedMaterial: null,
    }),
  ]);

  const selected = selectDiverseCatalogCandidates(candidates, 3);

  assert.deepEqual(
    selected.map((item) => item.candidate.variantId),
    ["a-1", "b-1", "c-1"],
  );
});

test("does not return duplicate variants", () => {
  const first = ranked([
    candidate("product-a", "a-1"),
  ])[0];

  const selected = selectDiverseCatalogCandidates(
    [first, first, ...ranked([candidate("product-b", "b-1")])],
    3,
  );

  assert.deepEqual(
    selected.map((item) => item.candidate.variantId),
    ["a-1", "b-1"],
  );
});

test("respects the requested limit", () => {
  const candidates = ranked([
    candidate("product-a", "a-1"),
    candidate("product-b", "b-1"),
    candidate("product-c", "c-1"),
  ]);

  const selected = selectDiverseCatalogCandidates(candidates, 2);

  assert.equal(selected.length, 2);
});

test("returns all available unique variants when fewer than the limit exist", () => {
  const candidates = ranked([
    candidate("product-a", "a-1"),
    candidate("product-a", "a-2"),
    candidate("product-b", "b-1"),
  ]);

  const selected = selectDiverseCatalogCandidates(candidates, 10);

  assert.equal(selected.length, 3);
  assert.deepEqual(
    new Set(selected.map((item) => item.candidate.variantId)),
    new Set(["a-1", "a-2", "b-1"]),
  );
});

test("returns an empty result for a non-positive or non-integer limit", () => {
  const candidates = ranked([
    candidate("product-a", "a-1"),
  ]);

  assert.deepEqual(selectDiverseCatalogCandidates(candidates, 0), []);
  assert.deepEqual(selectDiverseCatalogCandidates(candidates, -1), []);
  assert.deepEqual(selectDiverseCatalogCandidates(candidates, 1.5), []);
});

test("does not mutate the ranked candidate array", () => {
  const candidates = ranked([
    candidate("product-a", "a-1"),
    candidate("product-a", "a-2"),
    candidate("product-b", "b-1"),
  ]);
  const before = candidates.map((item) => item.candidate.variantId);

  selectDiverseCatalogCandidates(candidates, 2);

  assert.deepEqual(
    candidates.map((item) => item.candidate.variantId),
    before,
  );
});
