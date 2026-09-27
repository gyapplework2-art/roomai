import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogCandidate } from "@/lib/catalog/schema";
import {
  evaluateBedNightstandRelationship,
  NIGHTSTAND_DEPTH_MAX_CM,
  NIGHTSTAND_DEPTH_MIN_CM,
  NIGHTSTAND_HEIGHT_MAX_CM,
  NIGHTSTAND_HEIGHT_MIN_CM,
  NIGHTSTAND_WIDTH_MAX_CM,
  NIGHTSTAND_WIDTH_MIN_CM,
} from "@/lib/design-intelligence/bed-nightstand-relationship";
import type { DesignRole } from "@/lib/design-intelligence/schema";

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
  options: {
    widthCm?: number | null;
    depthCm?: number | null;
    heightCm?: number | null;
    color?: string | null;
  } = {},
): CatalogCandidate {
  const nightstand = furnitureTypeCode === "nightstand";

  return {
    productId: `product-${furnitureTypeCode}`,
    variantId: `variant-${furnitureTypeCode}`,
    countryCode: "US",
    categoryCode: "bedroom",
    categoryName: "Bedroom",
    furnitureTypeCode,
    furnitureTypeName: furnitureTypeCode,
    productTitle: `Test ${furnitureTypeCode}`,
    roomaiDescription: null,
    normalizedColor:
      options.color === undefined ? "beige" : options.color,
    normalizedMaterial: null,
    normalizedStyle: null,
    configuration: null,
    seatingCapacity: null,
    widthCm:
      options.widthCm === undefined
        ? nightstand
          ? 50
          : 165
        : options.widthCm,
    depthCm:
      options.depthCm === undefined
        ? nightstand
          ? 40
          : 220
        : options.depthCm,
    heightCm:
      options.heightCm === undefined
        ? nightstand
          ? 60
          : 110
        : options.heightCm,
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

test("uses explicit nightstand planning thresholds", () => {
  assert.equal(NIGHTSTAND_WIDTH_MIN_CM, 35);
  assert.equal(NIGHTSTAND_WIDTH_MAX_CM, 70);
  assert.equal(NIGHTSTAND_DEPTH_MIN_CM, 30);
  assert.equal(NIGHTSTAND_DEPTH_MAX_CM, 55);
  assert.equal(NIGHTSTAND_HEIGHT_MIN_CM, 45);
  assert.equal(NIGHTSTAND_HEIGHT_MAX_CM, 75);
});

test("recognizes bed and nightstand relationship", () => {
  const result = evaluateBedNightstandRelationship(
    role("bed", "bed"),
    candidate("bed"),
    role("nightstand", "nightstand"),
    candidate("nightstand"),
  );

  assert.equal(result.applicable, true);
  assert.equal(result.bedRoleId, "bed");
  assert.equal(result.nightstandRoleId, "nightstand");
});

test("recognizes bed frame alias", () => {
  const result = evaluateBedNightstandRelationship(
    role("bed", "bed_frame"),
    candidate("bed_frame"),
    role("nightstand", "nightstand"),
    candidate("nightstand"),
  );

  assert.equal(result.applicable, true);
  assert.equal(result.bedRoleId, "bed");
});

test("recognizes relationship regardless of argument order", () => {
  const result = evaluateBedNightstandRelationship(
    role("nightstand", "nightstand"),
    candidate("nightstand"),
    role("bed", "bed"),
    candidate("bed"),
  );

  assert.equal(result.applicable, true);
  assert.equal(result.bedRoleId, "bed");
  assert.equal(result.nightstandRoleId, "nightstand");
});

test("non bed nightstand pair is not applicable", () => {
  const result = evaluateBedNightstandRelationship(
    role("dresser", "dresser"),
    candidate("dresser"),
    role("nightstand", "nightstand"),
    candidate("nightstand"),
  );

  assert.equal(result.applicable, false);
  assert.equal(result.overallCompatibility, "unknown");
});

test("typical nightstand dimensions provide compatible scale evidence", () => {
  const result = evaluateBedNightstandRelationship(
    role("bed", "bed"),
    candidate("bed"),
    role("nightstand", "nightstand"),
    candidate("nightstand", {
      widthCm: 50,
      depthCm: 40,
      heightCm: 60,
    }),
  );

  assert.equal(result.scaleProportion.compatibility, "compatible");
  assert.deepEqual(result.scaleProportion.reasons, [
    "nightstand_dimensions_typical",
  ]);
});

test("nightstand dimensions exactly on minimum boundaries are compatible", () => {
  const result = evaluateBedNightstandRelationship(
    role("bed", "bed"),
    candidate("bed"),
    role("nightstand", "nightstand"),
    candidate("nightstand", {
      widthCm: NIGHTSTAND_WIDTH_MIN_CM,
      depthCm: NIGHTSTAND_DEPTH_MIN_CM,
      heightCm: NIGHTSTAND_HEIGHT_MIN_CM,
    }),
  );

  assert.equal(result.scaleProportion.compatibility, "compatible");
});

test("nightstand dimensions exactly on maximum boundaries are compatible", () => {
  const result = evaluateBedNightstandRelationship(
    role("bed", "bed"),
    candidate("bed"),
    role("nightstand", "nightstand"),
    candidate("nightstand", {
      widthCm: NIGHTSTAND_WIDTH_MAX_CM,
      depthCm: NIGHTSTAND_DEPTH_MAX_CM,
      heightCm: NIGHTSTAND_HEIGHT_MAX_CM,
    }),
  );

  assert.equal(result.scaleProportion.compatibility, "compatible");
});

test("nightstand outside typical dimensions is mixed rather than rejected", () => {
  const result = evaluateBedNightstandRelationship(
    role("bed", "bed"),
    candidate("bed"),
    role("nightstand", "nightstand"),
    candidate("nightstand", {
      widthCm: 85,
      depthCm: 40,
      heightCm: 60,
    }),
  );

  assert.equal(result.scaleProportion.compatibility, "mixed");
  assert.deepEqual(result.scaleProportion.reasons, [
    "nightstand_dimensions_outside_typical_range",
  ]);
});

test("missing nightstand width produces unknown scale evidence", () => {
  const result = evaluateBedNightstandRelationship(
    role("bed", "bed"),
    candidate("bed"),
    role("nightstand", "nightstand"),
    candidate("nightstand", { widthCm: null }),
  );

  assert.equal(result.scaleProportion.compatibility, "unknown");
});

test("missing nightstand depth produces unknown scale evidence", () => {
  const result = evaluateBedNightstandRelationship(
    role("bed", "bed"),
    candidate("bed"),
    role("nightstand", "nightstand"),
    candidate("nightstand", { depthCm: null }),
  );

  assert.equal(result.scaleProportion.compatibility, "unknown");
});

test("missing nightstand height produces unknown scale evidence", () => {
  const result = evaluateBedNightstandRelationship(
    role("bed", "bed"),
    candidate("bed"),
    role("nightstand", "nightstand"),
    candidate("nightstand", { heightCm: null }),
  );

  assert.equal(result.scaleProportion.compatibility, "unknown");
});

test("bedside height alignment remains unknown with current catalog contract", () => {
  const result = evaluateBedNightstandRelationship(
    role("bed", "bed"),
    candidate("bed", { heightCm: 110 }),
    role("nightstand", "nightstand"),
    candidate("nightstand", { heightCm: 60 }),
  );

  assert.equal(
    result.functionalRelationship.compatibility,
    "unknown",
  );
  assert.deepEqual(result.functionalRelationship.reasons, [
    "bed_sleeping_surface_height_not_represented",
    "nightstand_height_known_but_not_comparable_to_bed_total_height",
    "bedside_height_alignment_unknown",
  ]);
});

test("changing total bed height does not manufacture bedside alignment evidence", () => {
  const lowBed = evaluateBedNightstandRelationship(
    role("bed", "bed"),
    candidate("bed", { heightCm: 55 }),
    role("nightstand", "nightstand"),
    candidate("nightstand", { heightCm: 60 }),
  );

  const tallBed = evaluateBedNightstandRelationship(
    role("bed", "bed"),
    candidate("bed", { heightCm: 150 }),
    role("nightstand", "nightstand"),
    candidate("nightstand", { heightCm: 60 }),
  );

  assert.deepEqual(
    lowBed.functionalRelationship,
    tallBed.functionalRelationship,
  );
  assert.equal(
    lowBed.functionalRelationship.compatibility,
    "unknown",
  );
});

test("missing nightstand height preserves unknown functional evidence", () => {
  const result = evaluateBedNightstandRelationship(
    role("bed", "bed"),
    candidate("bed"),
    role("nightstand", "nightstand"),
    candidate("nightstand", { heightCm: null }),
  );

  assert.equal(
    result.functionalRelationship.compatibility,
    "unknown",
  );
  assert.deepEqual(result.functionalRelationship.reasons, [
    "bed_sleeping_surface_height_not_represented",
    "bedside_height_alignment_unknown",
  ]);
});

test("exact bed and nightstand colors are compatible", () => {
  const result = evaluateBedNightstandRelationship(
    role("bed", "bed"),
    candidate("bed", { color: "beige" }),
    role("nightstand", "nightstand"),
    candidate("nightstand", { color: "beige" }),
  );

  assert.equal(result.colorHarmony.compatibility, "compatible");
});

test("same color family is compatible without exact sameness", () => {
  const result = evaluateBedNightstandRelationship(
    role("bed", "bed"),
    candidate("bed", { color: "beige" }),
    role("nightstand", "nightstand"),
    candidate("nightstand", { color: "taupe" }),
  );

  assert.equal(result.colorHarmony.compatibility, "compatible");
});

test("harmonious bed and nightstand colors are compatible", () => {
  const result = evaluateBedNightstandRelationship(
    role("bed", "bed"),
    candidate("bed", { color: "brown" }),
    role("nightstand", "nightstand"),
    candidate("nightstand", { color: "green" }),
  );

  assert.equal(result.colorHarmony.compatibility, "compatible");
});

test("known but unaligned colors are mixed", () => {
  const result = evaluateBedNightstandRelationship(
    role("bed", "bed"),
    candidate("bed", { color: "red" }),
    role("nightstand", "nightstand"),
    candidate("nightstand", { color: "blue" }),
  );

  assert.equal(result.colorHarmony.compatibility, "mixed");
});

test("missing relationship color is unknown", () => {
  const result = evaluateBedNightstandRelationship(
    role("bed", "bed"),
    candidate("bed", { color: null }),
    role("nightstand", "nightstand"),
    candidate("nightstand", { color: "cream" }),
  );

  assert.equal(result.colorHarmony.compatibility, "unknown");
});

test("unsupported relationship color is unknown", () => {
  const result = evaluateBedNightstandRelationship(
    role("bed", "bed"),
    candidate("bed", { color: "ultraviolet" }),
    role("nightstand", "nightstand"),
    candidate("nightstand", { color: "cream" }),
  );

  assert.equal(result.colorHarmony.compatibility, "unknown");
});

test("compatible scale and color are not downgraded by unknown bedside alignment", () => {
  const result = evaluateBedNightstandRelationship(
    role("bed", "bed"),
    candidate("bed", { color: "beige" }),
    role("nightstand", "nightstand"),
    candidate("nightstand", {
      widthCm: 50,
      depthCm: 40,
      heightCm: 60,
      color: "cream",
    }),
  );

  assert.equal(result.scaleProportion.compatibility, "compatible");
  assert.equal(
    result.functionalRelationship.compatibility,
    "unknown",
  );
  assert.equal(result.colorHarmony.compatibility, "compatible");
  assert.equal(result.overallCompatibility, "compatible");
});

test("mixed nightstand scale makes overall relationship mixed", () => {
  const result = evaluateBedNightstandRelationship(
    role("bed", "bed"),
    candidate("bed", { color: "beige" }),
    role("nightstand", "nightstand"),
    candidate("nightstand", {
      widthCm: 85,
      depthCm: 40,
      heightCm: 60,
      color: "cream",
    }),
  );

  assert.equal(result.overallCompatibility, "mixed");
});

test("mixed color evidence makes overall relationship mixed", () => {
  const result = evaluateBedNightstandRelationship(
    role("bed", "bed"),
    candidate("bed", { color: "red" }),
    role("nightstand", "nightstand"),
    candidate("nightstand", {
      widthCm: 50,
      depthCm: 40,
      heightCm: 60,
      color: "blue",
    }),
  );

  assert.equal(result.overallCompatibility, "mixed");
});
