import assert from "node:assert/strict";
import test from "node:test";

import {
  AESTHETIC_SCORE_WEIGHTS,
  evaluateAestheticCompatibility,
} from "@/lib/catalog/aesthetic-compatibility";
import type { CatalogCandidate } from "@/lib/catalog/schema";

function candidate(overrides: Partial<CatalogCandidate> = {}): CatalogCandidate {
  return {
    productId: "product",
    variantId: "variant",
    countryCode: "US",
    categoryCode: "seating",
    categoryName: "Seating",
    furnitureTypeCode: "sofa",
    furnitureTypeName: "Sofa",
    productTitle: "Timber Sofa",
    roomaiDescription: null,
    normalizedColor: "tan",
    normalizedMaterial: "leather",
    normalizedStyle: "modern",
    configuration: "three-seat",
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
    vendorName: "Internal Vendor",
    productUrl: "https://example.com/product",
    primaryImageUrl: null,
    ...overrides,
  };
}

test("matching visual attributes produce a high compatible aesthetic score", () => {
  const result = evaluateAestheticCompatibility(candidate(), candidate());

  assert.equal(result.status, "compatible");
  assert.equal(result.score, 100);
  assert.ok(result.reasons.includes("style_match"));
  assert.ok(result.reasons.includes("material_match"));
  assert.ok(result.reasons.includes("color_match"));
  assert.ok(result.reasons.includes("configuration_match"));
});

test("same style and material with a different color remains aesthetically compatible", () => {
  const result = evaluateAestheticCompatibility(
    candidate({ normalizedColor: "tan" }),
    candidate({ normalizedColor: "green" }),
  );

  assert.equal(result.status, "compatible");
  assert.equal(result.score, 100 - AESTHETIC_SCORE_WEIGHTS.color);
  assert.ok(result.reasons.includes("color_changed"));
});

test("reasonable visual variation is mixed rather than rejected", () => {
  const result = evaluateAestheticCompatibility(
    candidate(),
    candidate({ normalizedMaterial: "fabric", normalizedColor: "green" }),
  );

  assert.equal(result.status, "mixed");
  assert.ok(result.score > 0);
});

test("major aesthetic differences score lower", () => {
  const close = evaluateAestheticCompatibility(candidate(), candidate({ normalizedColor: "green" }));
  const different = evaluateAestheticCompatibility(candidate(), candidate({
    normalizedStyle: "traditional",
    normalizedMaterial: "fabric",
    normalizedColor: "purple",
    configuration: "sectional",
    widthCm: 300,
    depthCm: 80,
  }));

  assert.ok(close.score > different.score);
  assert.equal(different.status, "mixed");
});

test("missing aesthetic metadata produces unknown compatibility", () => {
  const current = candidate({
    normalizedStyle: null,
    normalizedMaterial: null,
    normalizedColor: null,
    configuration: null,
    widthCm: null,
    depthCm: null,
  });
  const alternative = candidate({
    normalizedStyle: null,
    normalizedMaterial: null,
    normalizedColor: null,
    configuration: null,
    widthCm: null,
    depthCm: null,
  });
  const result = evaluateAestheticCompatibility(current, alternative);

  assert.equal(result.status, "unknown");
  assert.ok(result.reasons.includes("insufficient_aesthetic_metadata"));
});

test("price and availability do not affect aesthetic score", () => {
  const baseline = evaluateAestheticCompatibility(candidate(), candidate());
  const changedCommerce = evaluateAestheticCompatibility(candidate(), candidate({
    roomaiSellingPrice: 9999,
    currency: "CAD",
    normalizedAvailability: "out_of_stock",
  }));

  assert.deepEqual(changedCommerce, baseline);
});
