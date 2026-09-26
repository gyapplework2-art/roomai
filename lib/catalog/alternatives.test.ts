import assert from "node:assert/strict";
import test from "node:test";

import { selectCatalogAlternatives } from "@/lib/catalog/alternative-selection";
import type { CatalogCandidate } from "@/lib/catalog/schema";

function candidate(variantId: string): CatalogCandidate {
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
    normalizedColor: null,
    normalizedMaterial: null,
    normalizedStyle: null,
    configuration: null,
    seatingCapacity: null,
    widthCm: null,
    depthCm: null,
    heightCm: null,
    weightKg: null,
    currency: "USD",
    roomaiSellingPrice: null,
    normalizedAvailability: "in_stock",
    deliveryText: null,
    estimatedDeliveryDaysMin: null,
    estimatedDeliveryDaysMax: null,
    vendorDataCheckedAt: null,
    roomaiPriceCalculatedAt: null,
    vendorName: "Internal test vendor",
    productUrl: "https://example.com/product",
    primaryImageUrl: null,
  };
}

test("excludes the currently selected catalog variant", () => {
  const candidates = [
    candidate("current"),
    candidate("alternative-1"),
    candidate("alternative-2"),
  ];

  const alternatives = selectCatalogAlternatives(
    candidates,
    "current",
    12,
  );

  assert.deepEqual(
    alternatives.map((item) => item.variantId),
    ["alternative-1", "alternative-2"],
  );
});

test("respects the requested alternative limit", () => {
  const candidates = [
    candidate("alternative-1"),
    candidate("alternative-2"),
    candidate("alternative-3"),
  ];

  const alternatives = selectCatalogAlternatives(
    candidates,
    "current",
    2,
  );

  assert.deepEqual(
    alternatives.map((item) => item.variantId),
    ["alternative-1", "alternative-2"],
  );
});

test("returns an empty list when no alternatives remain", () => {
  const alternatives = selectCatalogAlternatives(
    [candidate("current")],
    "current",
    12,
  );

  assert.deepEqual(alternatives, []);
});
