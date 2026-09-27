import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogCandidate } from "@/lib/catalog/schema";
import {
  evaluateCandidateStyleHarmony,
  normalizeDesignStyle,
} from "./style-harmony";

function candidate(normalizedStyle: string | null): CatalogCandidate {
  return {
    productId: "11111111-1111-4111-8111-111111111111",
    variantId: "22222222-2222-4222-8222-222222222222",
    countryCode: "US",
    categoryCode: "living_room",
    categoryName: "Living Room",
    furnitureTypeCode: "sofa",
    furnitureTypeName: "Sofa",
    productTitle: "Example Sofa",
    roomaiDescription: null,
    normalizedColor: "cream",
    normalizedMaterial: "linen",
    normalizedStyle,
    configuration: null,
    seatingCapacity: 3,
    widthCm: 220,
    depthCm: 95,
    heightCm: 82,
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
  };
}

test("normalizes project display labels to catalog style codes", () => {
  assert.equal(normalizeDesignStyle("Warm Modern"), "warm_modern");
  assert.equal(
    normalizeDesignStyle("Mid-Century Modern"),
    "mid_century_modern",
  );
  assert.equal(normalizeDesignStyle("Art Deco"), "art_deco");
});

test("exact primary style match is compatible", () => {
  const result = evaluateCandidateStyleHarmony(
    { primaryStyle: "Modern", secondaryStyle: null },
    candidate("modern"),
  );

  assert.equal(result.compatibility, "compatible");
  assert.deepEqual(result.reasons, [
    "candidate_matches_primary_style",
  ]);
});

test("exact secondary style match is compatible", () => {
  const result = evaluateCandidateStyleHarmony(
    { primaryStyle: "Modern", secondaryStyle: "Scandinavian" },
    candidate("scandinavian"),
  );

  assert.equal(result.compatibility, "compatible");
  assert.deepEqual(result.reasons, [
    "candidate_matches_secondary_style",
  ]);
});

test("adjacent style to primary intent is compatible", () => {
  const result = evaluateCandidateStyleHarmony(
    { primaryStyle: "Modern", secondaryStyle: null },
    candidate("warm_modern"),
  );

  assert.equal(result.compatibility, "compatible");
  assert.deepEqual(result.reasons, [
    "candidate_adjacent_to_primary_style",
  ]);
});

test("scandinavian and japandi are treated as adjacent", () => {
  const result = evaluateCandidateStyleHarmony(
    { primaryStyle: "Scandinavian", secondaryStyle: null },
    candidate("japandi"),
  );

  assert.equal(result.compatibility, "compatible");
});

test("traditional and transitional are treated as adjacent", () => {
  const result = evaluateCandidateStyleHarmony(
    { primaryStyle: "Traditional", secondaryStyle: null },
    candidate("transitional"),
  );

  assert.equal(result.compatibility, "compatible");
});

test("valid but non-aligned style remains mixed rather than rejected", () => {
  const result = evaluateCandidateStyleHarmony(
    { primaryStyle: "Traditional", secondaryStyle: null },
    candidate("industrial"),
  );

  assert.equal(result.compatibility, "mixed");
  assert.deepEqual(result.reasons, [
    "candidate_style_valid_but_not_aligned",
  ]);
});

test("missing candidate style produces unknown compatibility", () => {
  const result = evaluateCandidateStyleHarmony(
    { primaryStyle: "Modern", secondaryStyle: null },
    candidate(null),
  );

  assert.equal(result.compatibility, "unknown");
  assert.deepEqual(result.reasons, ["candidate_style_missing"]);
});

test("unsupported candidate style produces unknown compatibility", () => {
  const result = evaluateCandidateStyleHarmony(
    { primaryStyle: "Modern", secondaryStyle: null },
    candidate("eclectic_future_style"),
  );

  assert.equal(result.compatibility, "unknown");
  assert.deepEqual(result.reasons, ["candidate_style_unknown"]);
});

test("missing design style intent produces unknown compatibility", () => {
  const result = evaluateCandidateStyleHarmony(
    { primaryStyle: null, secondaryStyle: null },
    candidate("modern"),
  );

  assert.equal(result.compatibility, "unknown");
  assert.deepEqual(result.reasons, [
    "design_style_intent_missing",
  ]);
});

test("declared style adjacency is symmetric", () => {
  const styles = [
    "modern",
    "warm_modern",
    "contemporary",
    "minimalist",
    "scandinavian",
    "mid_century_modern",
    "traditional",
    "transitional",
    "industrial",
    "japandi",
    "coastal",
    "farmhouse",
    "bohemian",
    "art_deco",
    "luxury_modern",
  ] as const;

  for (const first of styles) {
    for (const second of styles) {
      if (first === second) continue;

      const firstToSecond = evaluateCandidateStyleHarmony(
        { primaryStyle: first, secondaryStyle: null },
        candidate(second),
      );

      const secondToFirst = evaluateCandidateStyleHarmony(
        { primaryStyle: second, secondaryStyle: null },
        candidate(first),
      );

      assert.equal(
        firstToSecond.compatibility,
        secondToFirst.compatibility,
        `${first} -> ${second} differs from ${second} -> ${first}`,
      );
    }
  }
});
