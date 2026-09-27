import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogCandidate } from "@/lib/catalog/schema";
import {
  evaluateCandidateColorHarmony,
  normalizeDesignColor,
} from "./color-harmony";

function candidate(normalizedColor: string | null): CatalogCandidate {
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
    normalizedColor,
    normalizedMaterial: "linen",
    normalizedStyle: "warm_modern",
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

function colors(
  primary: string | null,
  secondary: string | null = null,
  accent: string | null = null,
  metal: string | null = null,
) {
  return {
    colors: {
      primary,
      secondary,
      accent,
      metal,
    },
  };
}

test("normalizes common design-language colors into families", () => {
  assert.deepEqual(normalizeDesignColor("Warm Taupe"), {
    value: "warm_taupe",
    family: "beige",
  });

  assert.deepEqual(normalizeDesignColor("Forest Green"), {
    value: "forest_green",
    family: "green",
  });

  assert.deepEqual(normalizeDesignColor("Light Grey"), {
    value: "light_grey",
    family: "gray",
  });
});

test("exact primary color match is compatible", () => {
  const result = evaluateCandidateColorHarmony(
    colors("tan"),
    candidate("tan"),
  );

  assert.equal(result.compatibility, "compatible");
  assert.deepEqual(result.reasons, ["candidate_matches_primary_color"]);
});

test("exact secondary color match is compatible", () => {
  const result = evaluateCandidateColorHarmony(
    colors("cream", "navy"),
    candidate("navy"),
  );

  assert.equal(result.compatibility, "compatible");
  assert.deepEqual(result.reasons, ["candidate_matches_secondary_color"]);
});

test("exact accent color match is compatible", () => {
  const result = evaluateCandidateColorHarmony(
    colors("cream", null, "forest green"),
    candidate("forest green"),
  );

  assert.equal(result.compatibility, "compatible");
  assert.deepEqual(result.reasons, ["candidate_matches_accent_color"]);
});

test("different shades in the same color family are compatible", () => {
  const result = evaluateCandidateColorHarmony(
    colors("warm taupe"),
    candidate("beige"),
  );

  assert.equal(result.compatibility, "compatible");
  assert.deepEqual(result.reasons, ["candidate_same_family_as_primary"]);
});

test("warm neutral families can harmonize without exact matching", () => {
  const result = evaluateCandidateColorHarmony(
    colors("cream"),
    candidate("tan"),
  );

  assert.equal(result.compatibility, "compatible");
  assert.deepEqual(result.reasons, ["candidate_harmonizes_with_primary"]);
});

test("valid but unaligned colors remain mixed rather than rejected", () => {
  const result = evaluateCandidateColorHarmony(
    colors("cream"),
    candidate("purple"),
  );

  assert.equal(result.compatibility, "mixed");
  assert.deepEqual(result.reasons, ["candidate_color_valid_but_not_aligned"]);
});

test("missing candidate color produces unknown compatibility", () => {
  const result = evaluateCandidateColorHarmony(
    colors("cream"),
    candidate(null),
  );

  assert.equal(result.compatibility, "unknown");
  assert.deepEqual(result.reasons, ["candidate_color_missing"]);
});

test("unsupported candidate color produces unknown compatibility", () => {
  const result = evaluateCandidateColorHarmony(
    colors("cream"),
    candidate("dark fleck"),
  );

  assert.equal(result.compatibility, "unknown");
  assert.deepEqual(result.reasons, ["candidate_color_unknown"]);
});

test("missing usable design color intent produces unknown compatibility", () => {
  const result = evaluateCandidateColorHarmony(
    colors(null, null, null, "brushed nickel"),
    candidate("cream"),
  );

  assert.equal(result.compatibility, "unknown");
  assert.deepEqual(result.reasons, ["design_color_intent_missing"]);
});

test("metal color does not determine furniture color harmony", () => {
  const result = evaluateCandidateColorHarmony(
    colors("cream", null, null, "black"),
    candidate("cream"),
  );

  assert.equal(result.compatibility, "compatible");
  assert.deepEqual(result.reasons, ["candidate_matches_primary_color"]);
});

test("harmonious family relationships work in both directions", () => {
  const creamWithTan = evaluateCandidateColorHarmony(
    colors("cream"),
    candidate("tan"),
  );

  const tanWithCream = evaluateCandidateColorHarmony(
    colors("tan"),
    candidate("cream"),
  );

  assert.equal(creamWithTan.compatibility, "compatible");
  assert.equal(tanWithCream.compatibility, "compatible");
});

test("neutral variation can harmonize without exact sameness", () => {
  const result = evaluateCandidateColorHarmony(
    colors("beige"),
    candidate("gray"),
  );

  assert.equal(result.compatibility, "compatible");
  assert.deepEqual(result.reasons, ["candidate_harmonizes_with_primary"]);
});

test("related chromatic families can harmonize without exact sameness", () => {
  const result = evaluateCandidateColorHarmony(
    colors("blue"),
    candidate("green"),
  );

  assert.equal(result.compatibility, "compatible");
  assert.deepEqual(result.reasons, ["candidate_harmonizes_with_primary"]);
});

test("unrelated known chromatic families remain mixed", () => {
  const result = evaluateCandidateColorHarmony(
    colors("blue"),
    candidate("orange"),
  );

  assert.equal(result.compatibility, "mixed");
  assert.deepEqual(result.reasons, ["candidate_color_valid_but_not_aligned"]);
});

test("an exact accent match takes precedence over general harmony", () => {
  const result = evaluateCandidateColorHarmony(
    colors("cream", "beige", "green"),
    candidate("green"),
  );

  assert.equal(result.compatibility, "compatible");
  assert.deepEqual(result.reasons, ["candidate_matches_accent_color"]);
});
