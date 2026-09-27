import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogCandidate } from "@/lib/catalog/schema";
import { evaluateDeskOfficeChairRelationship } from "@/lib/design-intelligence/desk-office-chair-relationship";
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
  const chair = furnitureTypeCode === "office_chair";

  return {
    productId: `product-${furnitureTypeCode}`,
    variantId: `variant-${furnitureTypeCode}`,
    countryCode: "US",
    categoryCode: "home_office",
    categoryName: "Home Office",
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
        ? chair
          ? 60
          : 140
        : options.widthCm,
    depthCm:
      options.depthCm === undefined
        ? chair
          ? 60
          : 70
        : options.depthCm,
    heightCm:
      options.heightCm === undefined
        ? chair
          ? 110
          : 75
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

test("recognizes desk office chair relationship", () => {
  const result = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk"),
    role("chair", "office_chair"),
    candidate("office_chair"),
  );

  assert.equal(result.applicable, true);
  assert.equal(result.deskRoleId, "desk");
  assert.equal(result.chairRoleId, "chair");
});

test("recognizes relationship regardless of argument order", () => {
  const result = evaluateDeskOfficeChairRelationship(
    role("chair", "office_chair"),
    candidate("office_chair"),
    role("desk", "desk"),
    candidate("desk"),
  );

  assert.equal(result.applicable, true);
  assert.equal(result.deskRoleId, "desk");
  assert.equal(result.chairRoleId, "chair");
});

test("unsupported pair is not applicable", () => {
  const result = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk"),
    role("dining-chair", "dining_chair"),
    candidate("dining_chair"),
  );

  assert.equal(result.applicable, false);
  assert.equal(result.overallCompatibility, "unknown");
});

test("complete overall dimensions provide compatible scale evidence", () => {
  const result = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk"),
    role("chair", "office_chair"),
    candidate("office_chair"),
  );

  assert.equal(result.scaleProportion.compatibility, "compatible");
  assert.deepEqual(result.scaleProportion.reasons, [
    "desk_overall_dimensions_available",
    "office_chair_overall_dimensions_available",
  ]);
});

test("missing desk width makes scale evidence unknown", () => {
  const result = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk", { widthCm: null }),
    role("chair", "office_chair"),
    candidate("office_chair"),
  );

  assert.equal(result.scaleProportion.compatibility, "unknown");
  assert.deepEqual(result.scaleProportion.reasons, [
    "desk_dimensions_missing_or_invalid",
    "office_chair_overall_dimensions_available",
  ]);
});

test("missing desk depth makes scale evidence unknown", () => {
  const result = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk", { depthCm: null }),
    role("chair", "office_chair"),
    candidate("office_chair"),
  );

  assert.equal(result.scaleProportion.compatibility, "unknown");
});

test("missing desk height makes scale evidence unknown", () => {
  const result = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk", { heightCm: null }),
    role("chair", "office_chair"),
    candidate("office_chair"),
  );

  assert.equal(result.scaleProportion.compatibility, "unknown");
});

test("missing office chair width makes scale evidence unknown", () => {
  const result = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk"),
    role("chair", "office_chair"),
    candidate("office_chair", { widthCm: null }),
  );

  assert.equal(result.scaleProportion.compatibility, "unknown");
});

test("missing office chair depth makes scale evidence unknown", () => {
  const result = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk"),
    role("chair", "office_chair"),
    candidate("office_chair", { depthCm: null }),
  );

  assert.equal(result.scaleProportion.compatibility, "unknown");
});

test("missing office chair height makes scale evidence unknown", () => {
  const result = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk"),
    role("chair", "office_chair"),
    candidate("office_chair", { heightCm: null }),
  );

  assert.equal(result.scaleProportion.compatibility, "unknown");
});

test("nonpositive dimensions are not treated as usable evidence", () => {
  const result = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk", { widthCm: 0 }),
    role("chair", "office_chair"),
    candidate("office_chair"),
  );

  assert.equal(result.scaleProportion.compatibility, "unknown");
});

test("ergonomic fit remains unknown with current catalog candidate contract", () => {
  const result = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk"),
    role("chair", "office_chair"),
    candidate("office_chair"),
  );

  assert.equal(
    result.functionalRelationship.compatibility,
    "unknown",
  );

  assert.deepEqual(result.functionalRelationship.reasons, [
    "office_chair_seat_height_not_exposed",
    "office_chair_seat_depth_not_exposed",
    "office_chair_arm_clearance_not_exposed",
    "desk_underside_clearance_not_exposed",
    "adjustable_height_attributes_not_exposed",
    "ergonomic_fit_unknown",
  ]);
});

test("changing generic office chair height does not manufacture seat height compatibility", () => {
  const shortChair = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk"),
    role("chair", "office_chair"),
    candidate("office_chair", { heightCm: 80 }),
  );

  const tallChair = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk"),
    role("chair", "office_chair"),
    candidate("office_chair", { heightCm: 140 }),
  );

  assert.deepEqual(
    shortChair.functionalRelationship,
    tallChair.functionalRelationship,
  );

  assert.equal(
    shortChair.functionalRelationship.compatibility,
    "unknown",
  );
});

test("changing generic desk height does not manufacture underside clearance evidence", () => {
  const lowDesk = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk", { heightCm: 65 }),
    role("chair", "office_chair"),
    candidate("office_chair"),
  );

  const highDesk = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk", { heightCm: 120 }),
    role("chair", "office_chair"),
    candidate("office_chair"),
  );

  assert.deepEqual(
    lowDesk.functionalRelationship,
    highDesk.functionalRelationship,
  );
});

test("exact colors are compatible", () => {
  const result = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk", { color: "beige" }),
    role("chair", "office_chair"),
    candidate("office_chair", { color: "beige" }),
  );

  assert.equal(result.colorHarmony.compatibility, "compatible");
  assert.deepEqual(result.colorHarmony.reasons, [
    "relationship_colors_match",
  ]);
});

test("same color family is compatible without requiring exact sameness", () => {
  const result = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk", { color: "beige" }),
    role("chair", "office_chair"),
    candidate("office_chair", { color: "taupe" }),
  );

  assert.equal(result.colorHarmony.compatibility, "compatible");
  assert.deepEqual(result.colorHarmony.reasons, [
    "relationship_colors_share_family",
  ]);
});

test("harmonious color families are compatible", () => {
  const result = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk", { color: "brown" }),
    role("chair", "office_chair"),
    candidate("office_chair", { color: "green" }),
  );

  assert.equal(result.colorHarmony.compatibility, "compatible");
});

test("known but unaligned colors are mixed", () => {
  const result = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk", { color: "red" }),
    role("chair", "office_chair"),
    candidate("office_chair", { color: "blue" }),
  );

  assert.equal(result.colorHarmony.compatibility, "mixed");
});

test("missing color evidence is unknown", () => {
  const result = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk", { color: null }),
    role("chair", "office_chair"),
    candidate("office_chair"),
  );

  assert.equal(result.colorHarmony.compatibility, "unknown");
});

test("unsupported color evidence is unknown", () => {
  const result = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk", { color: "ultraviolet" }),
    role("chair", "office_chair"),
    candidate("office_chair", { color: "cream" }),
  );

  assert.equal(result.colorHarmony.compatibility, "unknown");
});

test("complete dimensions and compatible color can make overall compatible despite unknown ergonomics", () => {
  const result = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk", { color: "beige" }),
    role("chair", "office_chair"),
    candidate("office_chair", { color: "cream" }),
  );

  assert.equal(result.scaleProportion.compatibility, "compatible");
  assert.equal(
    result.functionalRelationship.compatibility,
    "unknown",
  );
  assert.equal(result.colorHarmony.compatibility, "compatible");
  assert.equal(result.overallCompatibility, "compatible");
});

test("mixed color makes overall relationship mixed", () => {
  const result = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk", { color: "red" }),
    role("chair", "office_chair"),
    candidate("office_chair", { color: "blue" }),
  );

  assert.equal(result.overallCompatibility, "mixed");
});

test("all unknown evidence produces unknown overall compatibility", () => {
  const result = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"),
    candidate("desk", {
      widthCm: null,
      color: null,
    }),
    role("chair", "office_chair"),
    candidate("office_chair", {
      widthCm: null,
      color: null,
    }),
  );

  assert.equal(result.scaleProportion.compatibility, "unknown");
  assert.equal(
    result.functionalRelationship.compatibility,
    "unknown",
  );
  assert.equal(result.colorHarmony.compatibility, "unknown");
  assert.equal(result.overallCompatibility, "unknown");
});
