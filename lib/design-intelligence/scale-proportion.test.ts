import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogCandidate } from "@/lib/catalog/schema";
import type { DesignRole } from "./schema";
import {
  SCALE_PROPORTION_TOLERANCE_RATIO,
  evaluateCandidateScaleProportion,
  evaluateCandidateFootprintScaleProportion,
} from "./scale-proportion";

const role: DesignRole = {
  roleId: "primary_sofa",
  furnitureTypeCode: "sofa",
  required: true,
  approximatePosition: { xCm: 200, yCm: 150 },
  sizeRange: {
    widthMinCm: 180,
    widthMaxCm: 240,
    depthMinCm: 80,
    depthMaxCm: 110,
    heightMinCm: 70,
    heightMaxCm: 100,
  },
};

function candidate(
  dimensions: {
    widthCm: number | null;
    depthCm: number | null;
    heightCm: number | null;
  },
): CatalogCandidate {
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
    normalizedStyle: "modern",
    configuration: null,
    seatingCapacity: 3,
    widthCm: dimensions.widthCm,
    depthCm: dimensions.depthCm,
    heightCm: dimensions.heightCm,
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

test("uses an explicit scale proportion tolerance", () => {
  assert.equal(SCALE_PROPORTION_TOLERANCE_RATIO, 0.15);
});

test("candidate fully inside the intended role range is compatible", () => {
  const result = evaluateCandidateScaleProportion(
    role,
    candidate({ widthCm: 220, depthCm: 95, heightCm: 82 }),
  );

  assert.equal(result.compatibility, "compatible");
  assert.deepEqual(result.reasons, [
    "candidate_dimensions_within_role_range",
  ]);
});

test("candidate exactly on role boundaries is compatible", () => {
  const result = evaluateCandidateScaleProportion(
    role,
    candidate({ widthCm: 180, depthCm: 110, heightCm: 70 }),
  );

  assert.equal(result.compatibility, "compatible");
});

test("slightly undersized candidate is mixed", () => {
  const result = evaluateCandidateScaleProportion(
    role,
    candidate({ widthCm: 160, depthCm: 95, heightCm: 82 }),
  );

  assert.equal(result.compatibility, "mixed");
  assert.deepEqual(result.reasons, [
    "candidate_width_slightly_below_role_range",
  ]);
});

test("slightly oversized candidate is mixed", () => {
  const result = evaluateCandidateScaleProportion(
    role,
    candidate({ widthCm: 250, depthCm: 95, heightCm: 82 }),
  );

  assert.equal(result.compatibility, "mixed");
  assert.deepEqual(result.reasons, [
    "candidate_width_slightly_above_role_range",
  ]);
});

test("substantially undersized candidate is incompatible", () => {
  const result = evaluateCandidateScaleProportion(
    role,
    candidate({ widthCm: 150, depthCm: 95, heightCm: 82 }),
  );

  assert.equal(result.compatibility, "incompatible");
  assert.deepEqual(result.reasons, [
    "candidate_width_far_below_role_range",
  ]);
});

test("substantially oversized candidate is incompatible", () => {
  const result = evaluateCandidateScaleProportion(
    role,
    candidate({ widthCm: 280, depthCm: 95, heightCm: 82 }),
  );

  assert.equal(result.compatibility, "incompatible");
  assert.deepEqual(result.reasons, [
    "candidate_width_far_above_role_range",
  ]);
});

test("any substantially incompatible dimension makes the candidate incompatible", () => {
  const result = evaluateCandidateScaleProportion(
    role,
    candidate({ widthCm: 220, depthCm: 140, heightCm: 82 }),
  );

  assert.equal(result.compatibility, "incompatible");
  assert.deepEqual(result.reasons, [
    "candidate_depth_far_above_role_range",
  ]);
});

test("multiple mild deviations remain mixed and preserve reasons", () => {
  const result = evaluateCandidateScaleProportion(
    role,
    candidate({ widthCm: 160, depthCm: 115, heightCm: 82 }),
  );

  assert.equal(result.compatibility, "mixed");
  assert.deepEqual(result.reasons, [
    "candidate_width_slightly_below_role_range",
    "candidate_depth_slightly_above_role_range",
  ]);
});

test("missing candidate dimensions produce unknown compatibility", () => {
  const result = evaluateCandidateScaleProportion(
    role,
    candidate({ widthCm: null, depthCm: 95, heightCm: 82 }),
  );

  assert.equal(result.compatibility, "unknown");
  assert.deepEqual(result.reasons, [
    "candidate_dimensions_missing_or_invalid",
  ]);
});

test("candidate exactly at the tolerance boundary remains mixed", () => {
  const result = evaluateCandidateScaleProportion(
    role,
    candidate({ widthCm: 153, depthCm: 95, heightCm: 82 }),
  );

  assert.equal(result.compatibility, "mixed");
  assert.deepEqual(result.reasons, [
    "candidate_width_slightly_below_role_range",
  ]);
});

test("candidate just beyond the tolerance boundary is incompatible", () => {
  const result = evaluateCandidateScaleProportion(
    role,
    candidate({ widthCm: 152.9, depthCm: 95, heightCm: 82 }),
  );

  assert.equal(result.compatibility, "incompatible");
  assert.deepEqual(result.reasons, [
    "candidate_width_far_below_role_range",
  ]);
});

test("footprint-only eligibility reuses the existing 15% role tolerance without requiring height", () => {
  assert.equal(evaluateCandidateFootprintScaleProportion(role, { widthCm: 180, depthCm: 80 }).compatibility, "compatible");
  assert.equal(evaluateCandidateFootprintScaleProportion(role, { widthCm: 153, depthCm: 95 }).compatibility, "mixed");
  assert.equal(evaluateCandidateFootprintScaleProportion(role, { widthCm: 152.9, depthCm: 95 }).compatibility, "incompatible");
  assert.equal(evaluateCandidateFootprintScaleProportion(role, { widthCm: 276, depthCm: 95 }).compatibility, "mixed");
  assert.equal(evaluateCandidateFootprintScaleProportion(role, { widthCm: 276.1, depthCm: 95 }).compatibility, "incompatible");
});
