import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogCandidate } from "@/lib/catalog/schema";
import type { DesignRole } from "@/lib/design-intelligence/schema";
import {
  SOFA_RUG_COMPATIBLE_WIDTH_RATIO,
  SOFA_RUG_MIXED_WIDTH_RATIO,
  evaluateSofaRugScaleProportion,
  evaluateSofaRugRelationship,
} from "@/lib/design-intelligence/sofa-rug-relationship";

function role(
  roleId: string,
  furnitureTypeCode: string,
): DesignRole {
  return {
    roleId,
    furnitureTypeCode,
    required: true,
    approximatePosition: null,
    sizeRange: {
      widthMinCm: 1,
      widthMaxCm: 1000,
      depthMinCm: 1,
      depthMaxCm: 1000,
      heightMinCm: 1,
      heightMaxCm: 1000,
    },
  };
}

function candidate(
  furnitureTypeCode: string,
  widthCm: number | null,
  normalizedColor: string | null,
): CatalogCandidate {
  return {
    productId: `product-${furnitureTypeCode}`,
    variantId: `variant-${furnitureTypeCode}`,
    countryCode: "US",
    categoryCode: "living_room",
    categoryName: "Living Room",
    furnitureTypeCode,
    furnitureTypeName: furnitureTypeCode,
    productTitle: `Test ${furnitureTypeCode}`,
    roomaiDescription: null,
    normalizedColor,
    normalizedMaterial: null,
    normalizedStyle: null,
    configuration: null,
    seatingCapacity: null,
    widthCm,
    depthCm: 100,
    heightCm: 80,
    weightKg: null,
    currency: "USD",
    roomaiSellingPrice: 100,
    normalizedAvailability: "in_stock",
    deliveryText: null,
    estimatedDeliveryDaysMin: null,
    estimatedDeliveryDaysMax: null,
    vendorDataCheckedAt: null,
    roomaiPriceCalculatedAt: null,
    vendorName: "Test Vendor",
    productUrl: "https://example.com/product",
    primaryImageUrl: null,
  };
}

const sofaRole = role("primary_sofa", "sofa");
const rugRole = role("area_rug", "area_rug");

test("uses explicit sofa rug width thresholds", () => {
  assert.equal(SOFA_RUG_COMPATIBLE_WIDTH_RATIO, 0.75);
  assert.equal(SOFA_RUG_MIXED_WIDTH_RATIO, 0.6);
});

test("recognizes sofa and area rug relationship", () => {
  const result = evaluateSofaRugRelationship(
    sofaRole,
    candidate("sofa", 240, "warm_taupe"),
    rugRole,
    candidate("area_rug", 200, "cream"),
  );

  assert.equal(result.applicable, true);
  assert.equal(result.seatingRoleId, "primary_sofa");
  assert.equal(result.rugRoleId, "area_rug");
});

test("recognizes relationship regardless of argument order", () => {
  const result = evaluateSofaRugRelationship(
    rugRole,
    candidate("area_rug", 200, "cream"),
    sofaRole,
    candidate("sofa", 240, "warm_taupe"),
  );

  assert.equal(result.applicable, true);
  assert.equal(result.seatingRoleId, "primary_sofa");
  assert.equal(result.rugRoleId, "area_rug");
});

test("recognizes supported seating aliases", () => {
  for (const type of [
    "loveseat",
    "sectional",
    "sectional_sofa",
    "sofa_with_chaise",
  ]) {
    const result = evaluateSofaRugRelationship(
      role("seating", type),
      candidate(type, 240, "beige"),
      rugRole,
      candidate("area_rug", 200, "cream"),
    );

    assert.equal(result.applicable, true);
  }
});

test("non sofa rug pair is not applicable", () => {
  const result = evaluateSofaRugRelationship(
    role("desk", "desk"),
    candidate("desk", 140, "brown"),
    role("office_chair", "office_chair"),
    candidate("office_chair", 60, "black"),
  );

  assert.equal(result.applicable, false);
  assert.equal(result.overallCompatibility, "unknown");
});

test("proportionate rug width is compatible", () => {
  const result = evaluateSofaRugRelationship(
    sofaRole,
    candidate("sofa", 240, "beige"),
    rugRole,
    candidate("area_rug", 180, "cream"),
  );

  assert.equal(result.scaleProportion.compatibility, "compatible");
  assert.deepEqual(result.scaleProportion.reasons, [
    "rug_width_proportionate_to_seating",
  ]);
});

test("rug at compatible threshold remains compatible", () => {
  const result = evaluateSofaRugRelationship(
    sofaRole,
    candidate("sofa", 200, "beige"),
    rugRole,
    candidate("area_rug", 150, "cream"),
  );

  assert.equal(result.scaleProportion.compatibility, "compatible");
});

test("somewhat small rug is mixed", () => {
  const result = evaluateSofaRugRelationship(
    sofaRole,
    candidate("sofa", 200, "beige"),
    rugRole,
    candidate("area_rug", 140, "cream"),
  );

  assert.equal(result.scaleProportion.compatibility, "mixed");
  assert.deepEqual(result.scaleProportion.reasons, [
    "rug_width_somewhat_small_for_seating",
  ]);
});

test("rug at mixed threshold remains mixed", () => {
  const result = evaluateSofaRugRelationship(
    sofaRole,
    candidate("sofa", 200, "beige"),
    rugRole,
    candidate("area_rug", 120, "cream"),
  );

  assert.equal(result.scaleProportion.compatibility, "mixed");
});

test("clearly undersized rug is incompatible", () => {
  const result = evaluateSofaRugRelationship(
    sofaRole,
    candidate("sofa", 240, "beige"),
    rugRole,
    candidate("area_rug", 100, "cream"),
  );

  assert.equal(result.scaleProportion.compatibility, "incompatible");
  assert.deepEqual(result.scaleProportion.reasons, [
    "rug_width_too_small_for_seating",
  ]);
});

test("missing relationship dimensions produce unknown", () => {
  const result = evaluateSofaRugRelationship(
    sofaRole,
    candidate("sofa", null, "beige"),
    rugRole,
    candidate("area_rug", 200, "cream"),
  );

  assert.equal(result.scaleProportion.compatibility, "unknown");
});

test("width-only proportion adapter reuses existing thresholds and is argument-order invariant", () => {
  const forward = evaluateSofaRugScaleProportion(sofaRole, 200, rugRole, 150);
  const reversed = evaluateSofaRugScaleProportion(rugRole, 150, sofaRole, 200);
  assert.deepEqual(forward, reversed);
  assert.equal(forward.applicable, true);
  assert.equal(forward.scaleProportion.compatibility, "compatible");
  assert.deepEqual(evaluateSofaRugScaleProportion(sofaRole, null, rugRole, 150).scaleProportion, {
    compatibility: "unknown", reasons: ["relationship_dimensions_missing_or_invalid"],
  });
});

test("exact relationship colors are compatible", () => {
  const result = evaluateSofaRugRelationship(
    sofaRole,
    candidate("sofa", 240, "warm_taupe"),
    rugRole,
    candidate("area_rug", 200, "warm_taupe"),
  );

  assert.equal(result.colorHarmony.compatibility, "compatible");
  assert.deepEqual(result.colorHarmony.reasons, [
    "relationship_colors_match",
  ]);
});

test("same color family is compatible without exact sameness", () => {
  const result = evaluateSofaRugRelationship(
    sofaRole,
    candidate("sofa", 240, "warm_taupe"),
    rugRole,
    candidate("area_rug", 200, "beige"),
  );

  assert.equal(result.colorHarmony.compatibility, "compatible");
  assert.deepEqual(result.colorHarmony.reasons, [
    "relationship_colors_share_family",
  ]);
});

test("harmonious color families are compatible", () => {
  const result = evaluateSofaRugRelationship(
    sofaRole,
    candidate("sofa", 240, "beige"),
    rugRole,
    candidate("area_rug", 200, "cream"),
  );

  assert.equal(result.colorHarmony.compatibility, "compatible");
  assert.deepEqual(result.colorHarmony.reasons, [
    "relationship_colors_harmonize",
  ]);
});

test("known but unaligned relationship colors are mixed", () => {
  const result = evaluateSofaRugRelationship(
    sofaRole,
    candidate("sofa", 240, "red"),
    rugRole,
    candidate("area_rug", 200, "blue"),
  );

  assert.equal(result.colorHarmony.compatibility, "mixed");
  assert.deepEqual(result.colorHarmony.reasons, [
    "relationship_colors_valid_but_not_aligned",
  ]);
});

test("missing relationship color produces unknown", () => {
  const result = evaluateSofaRugRelationship(
    sofaRole,
    candidate("sofa", 240, null),
    rugRole,
    candidate("area_rug", 200, "cream"),
  );

  assert.equal(result.colorHarmony.compatibility, "unknown");
});

test("unsupported relationship color produces unknown", () => {
  const result = evaluateSofaRugRelationship(
    sofaRole,
    candidate("sofa", 240, "mystery"),
    rugRole,
    candidate("area_rug", 200, "cream"),
  );

  assert.equal(result.colorHarmony.compatibility, "unknown");
});

test("visual hierarchy remains unknown without reliable lightness evidence", () => {
  const result = evaluateSofaRugRelationship(
    sofaRole,
    candidate("sofa", 240, "beige"),
    rugRole,
    candidate("area_rug", 200, "cream"),
  );

  assert.equal(result.composition.compatibility, "unknown");
  assert.deepEqual(result.composition.reasons, [
    "visual_hierarchy_evidence_unavailable",
  ]);
});

test("incompatible scale makes overall relationship incompatible", () => {
  const result = evaluateSofaRugRelationship(
    sofaRole,
    candidate("sofa", 240, "beige"),
    rugRole,
    candidate("area_rug", 100, "cream"),
  );

  assert.equal(result.overallCompatibility, "incompatible");
});

test("mixed evidence makes overall relationship mixed", () => {
  const result = evaluateSofaRugRelationship(
    sofaRole,
    candidate("sofa", 200, "red"),
    rugRole,
    candidate("area_rug", 140, "blue"),
  );

  assert.equal(result.overallCompatibility, "mixed");
});

test("compatible evidence is not downgraded by unavailable composition evidence", () => {
  const result = evaluateSofaRugRelationship(
    sofaRole,
    candidate("sofa", 240, "beige"),
    rugRole,
    candidate("area_rug", 200, "cream"),
  );

  assert.equal(result.scaleProportion.compatibility, "compatible");
  assert.equal(result.colorHarmony.compatibility, "compatible");
  assert.equal(result.composition.compatibility, "unknown");
  assert.equal(result.overallCompatibility, "compatible");
});
