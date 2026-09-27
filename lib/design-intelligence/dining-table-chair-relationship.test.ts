import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogCandidate } from "@/lib/catalog/schema";
import type { DesignRole } from "@/lib/design-intelligence/schema";
import { evaluateDiningTableChairRelationship } from "@/lib/design-intelligence/dining-table-chair-relationship";

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
    heightCm?: number | null;
    seatingCapacity?: number | null;
    color?: string | null;
  } = {},
): CatalogCandidate {
  return {
    productId: `product-${furnitureTypeCode}`,
    variantId: `variant-${furnitureTypeCode}`,
    countryCode: "US",
    categoryCode: "dining_room",
    categoryName: "Dining Room",
    furnitureTypeCode,
    furnitureTypeName: furnitureTypeCode,
    productTitle: `Test ${furnitureTypeCode}`,
    roomaiDescription: null,
    normalizedColor:
      options.color === undefined ? "beige" : options.color,
    normalizedMaterial: null,
    normalizedStyle: null,
    configuration: null,
    seatingCapacity: options.seatingCapacity ?? null,
    widthCm: furnitureTypeCode === "dining_table" ? 180 : 50,
    depthCm: furnitureTypeCode === "dining_table" ? 90 : 50,
    heightCm:
      options.heightCm === undefined
        ? furnitureTypeCode === "dining_table"
          ? 75
          : 90
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

test("recognizes dining table and dining chair", () => {
  const result = evaluateDiningTableChairRelationship(
    role("table", "dining_table"),
    candidate("dining_table"),
    role("chair", "dining_chair"),
    candidate("dining_chair"),
  );

  assert.equal(result.applicable, true);
  assert.equal(result.tableRoleId, "table");
  assert.equal(result.chairRoleId, "chair");
});

test("recognizes dining relationship regardless of argument order", () => {
  const result = evaluateDiningTableChairRelationship(
    role("chair", "dining_chair"),
    candidate("dining_chair"),
    role("table", "dining_table"),
    candidate("dining_table"),
  );

  assert.equal(result.applicable, true);
  assert.equal(result.tableRoleId, "table");
  assert.equal(result.chairRoleId, "chair");
});

test("non dining pair is not applicable", () => {
  const result = evaluateDiningTableChairRelationship(
    role("desk", "desk"),
    candidate("desk"),
    role("chair", "dining_chair"),
    candidate("dining_chair"),
  );

  assert.equal(result.applicable, false);
  assert.equal(result.overallCompatibility, "unknown");
});

test("typical dining table height is compatible scale evidence", () => {
  const result = evaluateDiningTableChairRelationship(
    role("table", "dining_table"),
    candidate("dining_table", { heightCm: 75 }),
    role("chair", "dining_chair"),
    candidate("dining_chair", { heightCm: 90 }),
  );

  assert.equal(result.scaleProportion.compatibility, "compatible");
  assert.deepEqual(result.scaleProportion.reasons, [
    "table_height_dining_appropriate",
    "chair_overall_height_available_but_seat_height_unknown",
  ]);
});

test("70 cm dining table boundary is accepted", () => {
  const result = evaluateDiningTableChairRelationship(
    role("table", "dining_table"),
    candidate("dining_table", { heightCm: 70 }),
    role("chair", "dining_chair"),
    candidate("dining_chair"),
  );

  assert.equal(result.scaleProportion.compatibility, "compatible");
});

test("80 cm dining table boundary is accepted", () => {
  const result = evaluateDiningTableChairRelationship(
    role("table", "dining_table"),
    candidate("dining_table", { heightCm: 80 }),
    role("chair", "dining_chair"),
    candidate("dining_chair"),
  );

  assert.equal(result.scaleProportion.compatibility, "compatible");
});

test("table outside typical dining height is mixed rather than rejected", () => {
  const result = evaluateDiningTableChairRelationship(
    role("table", "dining_table"),
    candidate("dining_table", { heightCm: 90 }),
    role("chair", "dining_chair"),
    candidate("dining_chair"),
  );

  assert.equal(result.scaleProportion.compatibility, "mixed");
  assert.equal(
    result.scaleProportion.reasons.includes(
      "table_height_outside_typical_dining_range",
    ),
    true,
  );
});

test("missing table height produces unknown scale evidence", () => {
  const result = evaluateDiningTableChairRelationship(
    role("table", "dining_table"),
    candidate("dining_table", { heightCm: null }),
    role("chair", "dining_chair"),
    candidate("dining_chair"),
  );

  assert.equal(result.scaleProportion.compatibility, "unknown");
});

test("missing chair overall height produces unknown scale evidence", () => {
  const result = evaluateDiningTableChairRelationship(
    role("table", "dining_table"),
    candidate("dining_table"),
    role("chair", "dining_chair"),
    candidate("dining_chair", { heightCm: null }),
  );

  assert.equal(result.scaleProportion.compatibility, "unknown");
});

test("chair overall height is not treated as seat height", () => {
  const result = evaluateDiningTableChairRelationship(
    role("table", "dining_table"),
    candidate("dining_table"),
    role("chair", "dining_chair"),
    candidate("dining_chair", { heightCm: 95 }),
  );

  assert.equal(
    result.scaleProportion.reasons.includes(
      "chair_overall_height_available_but_seat_height_unknown",
    ),
    true,
  );
});

test("known table seating capacity does not imply chair count compatibility", () => {
  const result = evaluateDiningTableChairRelationship(
    role("table", "dining_table"),
    candidate("dining_table", { seatingCapacity: 6 }),
    role("chair", "dining_chair"),
    candidate("dining_chair", { seatingCapacity: 1 }),
  );

  assert.equal(
    result.functionalRelationship.compatibility,
    "unknown",
  );
  assert.deepEqual(result.functionalRelationship.reasons, [
    "table_seating_capacity_known",
    "chair_count_not_represented_by_candidate",
  ]);
});

test("missing table seating capacity remains unknown", () => {
  const result = evaluateDiningTableChairRelationship(
    role("table", "dining_table"),
    candidate("dining_table", { seatingCapacity: null }),
    role("chair", "dining_chair"),
    candidate("dining_chair"),
  );

  assert.equal(
    result.functionalRelationship.compatibility,
    "unknown",
  );
  assert.deepEqual(result.functionalRelationship.reasons, [
    "table_seating_capacity_missing_or_invalid",
    "chair_count_not_represented_by_candidate",
  ]);
});

test("exact table and chair colors are compatible", () => {
  const result = evaluateDiningTableChairRelationship(
    role("table", "dining_table"),
    candidate("dining_table", { color: "beige" }),
    role("chair", "dining_chair"),
    candidate("dining_chair", { color: "beige" }),
  );

  assert.equal(result.colorHarmony.compatibility, "compatible");
});

test("same color family is compatible without exact sameness", () => {
  const result = evaluateDiningTableChairRelationship(
    role("table", "dining_table"),
    candidate("dining_table", { color: "beige" }),
    role("chair", "dining_chair"),
    candidate("dining_chair", { color: "taupe" }),
  );

  assert.equal(result.colorHarmony.compatibility, "compatible");
});

test("harmonious table and chair colors are compatible", () => {
  const result = evaluateDiningTableChairRelationship(
    role("table", "dining_table"),
    candidate("dining_table", { color: "brown" }),
    role("chair", "dining_chair"),
    candidate("dining_chair", { color: "green" }),
  );

  assert.equal(result.colorHarmony.compatibility, "compatible");
});

test("known but unaligned colors are mixed", () => {
  const result = evaluateDiningTableChairRelationship(
    role("table", "dining_table"),
    candidate("dining_table", { color: "red" }),
    role("chair", "dining_chair"),
    candidate("dining_chair", { color: "blue" }),
  );

  assert.equal(result.colorHarmony.compatibility, "mixed");
});

test("missing relationship color is unknown", () => {
  const result = evaluateDiningTableChairRelationship(
    role("table", "dining_table"),
    candidate("dining_table", { color: null }),
    role("chair", "dining_chair"),
    candidate("dining_chair", { color: "cream" }),
  );

  assert.equal(result.colorHarmony.compatibility, "unknown");
});

test("unsupported relationship color is unknown", () => {
  const result = evaluateDiningTableChairRelationship(
    role("table", "dining_table"),
    candidate("dining_table", { color: "ultraviolet" }),
    role("chair", "dining_chair"),
    candidate("dining_chair", { color: "cream" }),
  );

  assert.equal(result.colorHarmony.compatibility, "unknown");
});

test("compatible scale and color are not downgraded by unknown chair count", () => {
  const result = evaluateDiningTableChairRelationship(
    role("table", "dining_table"),
    candidate("dining_table", {
      heightCm: 75,
      seatingCapacity: 6,
      color: "beige",
    }),
    role("chair", "dining_chair"),
    candidate("dining_chair", {
      heightCm: 90,
      color: "cream",
    }),
  );

  assert.equal(result.scaleProportion.compatibility, "compatible");
  assert.equal(result.colorHarmony.compatibility, "compatible");
  assert.equal(
    result.functionalRelationship.compatibility,
    "unknown",
  );
  assert.equal(result.overallCompatibility, "compatible");
});

test("mixed scale evidence makes overall relationship mixed", () => {
  const result = evaluateDiningTableChairRelationship(
    role("table", "dining_table"),
    candidate("dining_table", {
      heightCm: 90,
      color: "beige",
    }),
    role("chair", "dining_chair"),
    candidate("dining_chair", {
      color: "cream",
    }),
  );

  assert.equal(result.overallCompatibility, "mixed");
});

test("mixed color evidence makes overall relationship mixed", () => {
  const result = evaluateDiningTableChairRelationship(
    role("table", "dining_table"),
    candidate("dining_table", {
      heightCm: 75,
      color: "red",
    }),
    role("chair", "dining_chair"),
    candidate("dining_chair", {
      color: "blue",
    }),
  );

  assert.equal(result.overallCompatibility, "mixed");
});
