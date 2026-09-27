import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogCandidate } from "@/lib/catalog/schema";
import {
  relationshipEvaluationSchema,
  type DesignRole,
} from "@/lib/design-intelligence/schema";
import {
  evaluateFurnitureRelationship,
  type RelationshipInput,
} from "@/lib/design-intelligence/relationship-engine";

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

function input(
  firstType: string,
  secondType: string,
  firstWidth = 240,
  secondWidth = 200,
  firstColor: string | null = "beige",
  secondColor: string | null = "cream",
): RelationshipInput {
  return {
    firstRole: role(`role-${firstType}`, firstType),
    firstCandidate: candidate(firstType, firstWidth, firstColor),
    secondRole: role(`role-${secondType}`, secondType),
    secondCandidate: candidate(secondType, secondWidth, secondColor),
  };
}

test("dispatches a registered sofa rug relationship", () => {
  const result = evaluateFurnitureRelationship(
    input("sofa", "area_rug"),
  );

  assert.ok(result);
  assert.equal(result.relationshipId, "sofa_rug");
  assert.deepEqual(result.roleIds, [
    "role-sofa",
    "role-area_rug",
  ]);
});

test("dispatcher result conforms to the E.1 relationship schema", () => {
  const result = evaluateFurnitureRelationship(
    input("sofa", "area_rug"),
  );

  assert.ok(result);
  assert.doesNotThrow(() =>
    relationshipEvaluationSchema.parse(result),
  );
});

test("normalizes sofa rug dimensions into E.1 dimension names", () => {
  const result = evaluateFurnitureRelationship(
    input("sofa", "area_rug"),
  );

  assert.ok(result);
  assert.deepEqual(
    result.dimensions.map((dimension) => dimension.dimension),
    [
      "scale_proportion",
      "color_harmony",
      "composition",
    ],
  );
});

test("preserves sofa rug compatibility results", () => {
  const result = evaluateFurnitureRelationship(
    input("sofa", "area_rug", 240, 100),
  );

  assert.ok(result);
  assert.equal(result.overallCompatibility, "incompatible");

  const scale = result.dimensions.find(
    (dimension) => dimension.dimension === "scale_proportion",
  );

  assert.equal(scale?.compatibility, "incompatible");
  assert.deepEqual(scale?.reasons, [
    "rug_width_too_small_for_seating",
  ]);
});

test("preserves unknown evidence inside an applicable relationship", () => {
  const result = evaluateFurnitureRelationship(
    input("sofa", "area_rug", 240, 200, null, "cream"),
  );

  assert.ok(result);

  const color = result.dimensions.find(
    (dimension) => dimension.dimension === "color_harmony",
  );

  assert.equal(color?.compatibility, "unknown");
  assert.deepEqual(color?.reasons, [
    "relationship_color_missing",
  ]);
});

test("preserves canonical role order when arguments are reversed", () => {
  const result = evaluateFurnitureRelationship(
    input("area_rug", "sofa", 200, 240, "cream", "beige"),
  );

  assert.ok(result);
  assert.deepEqual(result.roleIds, [
    "role-sofa",
    "role-area_rug",
  ]);
});

test("supports sofa relationship aliases through the registry", () => {
  for (const type of [
    "loveseat",
    "sectional",
    "sectional_sofa",
    "sofa_with_chaise",
  ]) {
    const result = evaluateFurnitureRelationship(
      input(type, "area_rug"),
    );

    assert.ok(result);
    assert.equal(result.relationshipId, "sofa_rug");
  }
});

test("supports rug alias through the registry", () => {
  const result = evaluateFurnitureRelationship(
    input("sofa", "rug"),
  );

  assert.ok(result);
  assert.equal(result.relationshipId, "sofa_rug");
});

test("unsupported furniture pair returns null", () => {
  const result = evaluateFurnitureRelationship(
    input("desk", "office_chair"),
  );

  assert.equal(result, null);
});

test("unsupported pair is not confused with unknown evidence", () => {
  const unsupported = evaluateFurnitureRelationship(
    input("desk", "office_chair", 140, 60, null, null),
  );

  const applicableUnknown = evaluateFurnitureRelationship(
    input("sofa", "area_rug", 240, 200, null, null),
  );

  assert.equal(unsupported, null);
  assert.ok(applicableUnknown);

  const color = applicableUnknown.dimensions.find(
    (dimension) => dimension.dimension === "color_harmony",
  );

  assert.equal(color?.compatibility, "unknown");
});

test("dispatcher does not expose vendor or product identity in relationship output", () => {
  const result = evaluateFurnitureRelationship(
    input("sofa", "area_rug"),
  );

  assert.ok(result);

  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes("vendorName"), false);
  assert.equal(serialized.includes("productUrl"), false);
  assert.equal(serialized.includes("productId"), false);
  assert.equal(serialized.includes("variantId"), false);
});

test("dispatcher is deterministic for identical input", () => {
  const relationshipInput = input("sofa", "area_rug");

  const first = evaluateFurnitureRelationship(relationshipInput);
  const second = evaluateFurnitureRelationship(relationshipInput);

  assert.deepEqual(first, second);
});

test("dispatches dining table chair relationship", () => {
  const result = evaluateFurnitureRelationship(
    input("dining_table", "dining_chair", 180, 50),
  );

  assert.ok(result);
  assert.equal(result.relationshipId, "dining_table_chair");
  assert.deepEqual(result.roleIds, [
    "role-dining_table",
    "role-dining_chair",
  ]);
});

test("dining dispatcher result conforms to the E.1 relationship schema", () => {
  const result = evaluateFurnitureRelationship(
    input("dining_table", "dining_chair", 180, 50),
  );

  assert.ok(result);
  assert.doesNotThrow(() =>
    relationshipEvaluationSchema.parse(result),
  );
});

test("normalizes dining relationship dimensions into E.1 dimension names", () => {
  const result = evaluateFurnitureRelationship(
    input("dining_table", "dining_chair", 180, 50),
  );

  assert.ok(result);
  assert.deepEqual(
    result.dimensions.map((dimension) => dimension.dimension),
    [
      "scale_proportion",
      "functional_relationship",
      "color_harmony",
    ],
  );
});

test("preserves canonical dining role order when arguments are reversed", () => {
  const result = evaluateFurnitureRelationship(
    input("dining_chair", "dining_table", 50, 180),
  );

  assert.ok(result);
  assert.equal(result.relationshipId, "dining_table_chair");
  assert.deepEqual(result.roleIds, [
    "role-dining_table",
    "role-dining_chair",
  ]);
});

test("dining relationship output does not expose catalog identity", () => {
  const result = evaluateFurnitureRelationship(
    input("dining_table", "dining_chair", 180, 50),
  );

  assert.ok(result);

  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes("vendorName"), false);
  assert.equal(serialized.includes("productUrl"), false);
  assert.equal(serialized.includes("productId"), false);
  assert.equal(serialized.includes("variantId"), false);
});

test("registered dining pair is no longer treated as unsupported", () => {
  const result = evaluateFurnitureRelationship(
    input("dining_table", "dining_chair", 180, 50),
  );

  assert.notEqual(result, null);
  assert.equal(result?.relationshipId, "dining_table_chair");
});
