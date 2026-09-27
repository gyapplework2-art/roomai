import assert from "node:assert/strict";
import test from "node:test";

import {
  AESTHETIC_SCORE_WEIGHTS,
  evaluateAestheticCompatibility,
} from "@/lib/catalog/aesthetic-compatibility";
import type { CatalogCandidate } from "@/lib/catalog/schema";
import { normalizeFurnitureAttributes } from "@/lib/design-intelligence/furniture-attributes";

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

test("omitting furniture attributes preserves the original result shape", () => {
  const result = evaluateAestheticCompatibility(candidate(), candidate());

  assert.deepEqual(Object.keys(result), ["score", "status", "reasons"]);
  assert.equal(result.furnitureAttributeCompatibility, undefined);
});

test("exact detailed attributes are supplementary evidence without changing five-component results", () => {
  const current = candidate();
  const alternative = candidate({ normalizedColor: "green" });
  const attributes = normalizeFurnitureAttributes(current, {
    sourceAttributes: { "Arm Style": "Rolled Arms", "Seat Depth": "22 in", Tufting: "No" },
  });
  const baseline = evaluateAestheticCompatibility(current, alternative);
  const withEvidence = evaluateAestheticCompatibility(current, alternative, {
    current: attributes,
    alternative: attributes,
  });
  const { furnitureAttributeCompatibility, ...originalResult } = withEvidence;

  assert.deepEqual(originalResult, baseline);
  assert.equal(withEvidence.score, 80);
  assert.equal(withEvidence.status, "compatible");
  assert.equal(furnitureAttributeCompatibility?.attributes.armStyle.compatibility, "compatible");
  assert.equal(furnitureAttributeCompatibility?.attributes.tufting.compatibility, "compatible");
  assert.equal(furnitureAttributeCompatibility?.overallCompatibility, "compatible");
});

test("mixed detailed attributes do not alter the existing aesthetic score or status", () => {
  const current = candidate();
  const alternative = candidate({ normalizedMaterial: "fabric", normalizedColor: "green" });
  const currentAttributes = normalizeFurnitureAttributes(current, {
    sourceAttributes: { "Arm Style": "Rolled Arms" },
  });
  const alternativeAttributes = normalizeFurnitureAttributes(alternative, {
    sourceAttributes: { "Arm Style": "Track Arms" },
  });
  const baseline = evaluateAestheticCompatibility(current, alternative);
  const withEvidence = evaluateAestheticCompatibility(current, alternative, {
    current: currentAttributes,
    alternative: alternativeAttributes,
  });
  const { furnitureAttributeCompatibility, ...originalResult } = withEvidence;

  assert.deepEqual(originalResult, baseline);
  assert.equal(furnitureAttributeCompatibility?.attributes.armStyle.compatibility, "mixed");
  assert.equal(furnitureAttributeCompatibility?.overallCompatibility, "mixed");
});

test("unknown detail stays unknown, including when all five aesthetic components are unknown", () => {
  const current = candidate({ normalizedStyle: null, normalizedMaterial: null, normalizedColor: null, configuration: null, widthCm: null, depthCm: null });
  const alternative = candidate({ normalizedStyle: null, normalizedMaterial: null, normalizedColor: null, configuration: null, widthCm: null, depthCm: null });
  const empty = normalizeFurnitureAttributes({ seatingCapacity: null });
  const baseline = evaluateAestheticCompatibility(current, alternative);
  const withEvidence = evaluateAestheticCompatibility(current, alternative, { current: empty, alternative: empty });
  const { furnitureAttributeCompatibility, ...originalResult } = withEvidence;

  assert.deepEqual(originalResult, baseline);
  assert.equal(furnitureAttributeCompatibility?.overallCompatibility, "unknown");
  assert.equal(furnitureAttributeCompatibility?.attributes.seatDepthCm.compatibility, "unknown");
});

test("supplementary evaluation does not mutate inputs or use commercial and vendor fields", () => {
  const current = candidate();
  const alternative = candidate();
  const currentAttributes = normalizeFurnitureAttributes(current, { sourceAttributes: { Tufting: "Yes" } });
  const alternativeAttributes = normalizeFurnitureAttributes(alternative, { sourceAttributes: { Tufting: "No" } });
  const currentSnapshot = structuredClone(current);
  const alternativeSnapshot = structuredClone(alternative);
  const attributesSnapshot = structuredClone({ current: currentAttributes, alternative: alternativeAttributes });
  const evidence = { current: currentAttributes, alternative: alternativeAttributes };
  const result = evaluateAestheticCompatibility(current, alternative, evidence);
  const changedCommerce = evaluateAestheticCompatibility(
    candidate({ vendorName: "Different vendor", productUrl: "https://example.com/other", roomaiDescription: "Different description", roomaiSellingPrice: 9999 }),
    candidate({ normalizedAvailability: "out_of_stock", roomaiSellingPrice: 1 }),
    evidence,
  );

  assert.deepEqual(changedCommerce, result);
  assert.deepEqual(current, currentSnapshot);
  assert.deepEqual(alternative, alternativeSnapshot);
  assert.deepEqual(evidence, attributesSnapshot);
});
