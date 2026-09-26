import { test } from "node:test";
import assert from "node:assert/strict";

import type { CatalogCandidate } from "@/lib/catalog/schema";
import {
  evaluateCatalogReplacementContextCompatibility,
  evaluateCatalogReplacementSpatialCompatibility,
} from "@/lib/catalog/spatial-compatibility";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";

const geometry: RoomGeometry = {
  schemaVersion: "1.0",
  shapeType: "rectangle",
  templateTransform: {
    rotationDegrees: 0,
    mirroredHorizontal: false,
    mirroredVertical: false,
  },
  ceilingHeightCm: 250,
  vertices: [
    { id: "v1", xCm: 0, yCm: 0 },
    { id: "v2", xCm: 400, yCm: 0 },
    { id: "v3", xCm: 400, yCm: 300 },
    { id: "v4", xCm: 0, yCm: 300 },
  ],
  wallSegments: [
    { id: "w1", startVertexId: "v1", endVertexId: "v2" },
    { id: "w2", startVertexId: "v2", endVertexId: "v3" },
    { id: "w3", startVertexId: "v3", endVertexId: "v4" },
    { id: "w4", startVertexId: "v4", endVertexId: "v1" },
  ],
};

const designObject = {
  x_cm: 200,
  y_cm: 150,
  rotation_degrees: 0,
};

function candidate(
  widthCm: number | null,
  depthCm: number | null,
  overrides: Partial<CatalogCandidate> = {},
): CatalogCandidate {
  return {
    productId: "product-1",
    variantId: "variant-1",
    countryCode: "US",
    categoryCode: "living_room",
    categoryName: "Living Room",
    furnitureTypeCode: "area_rug",
    furnitureTypeName: "Area Rug",
    productTitle: "Test Rug",
    roomaiDescription: null,
    normalizedColor: null,
    normalizedMaterial: null,
    normalizedStyle: null,
    configuration: null,
    seatingCapacity: null,
    widthCm,
    depthCm,
    heightCm: 1,
    weightKg: null,
    currency: "USD",
    roomaiSellingPrice: 100,
    normalizedAvailability: "in_stock",
    deliveryText: null,
    estimatedDeliveryDaysMin: null,
    estimatedDeliveryDaysMax: null,
    vendorDataCheckedAt: null,
    roomaiPriceCalculatedAt: null,
    vendorName: "Vendor",
    productUrl: "https://example.com/product",
    primaryImageUrl: null,
    ...overrides,
  };
}

const door: RoomOpening = {
  id: "door-1",
  openingType: "door",
  wallSegmentId: "w1",
  offsetCm: 160,
  widthCm: 80,
  heightCm: 210,
  sillHeightCm: null,
  hingeSide: "left",
  swingDirection: "inward",
};

const windowOpening: RoomOpening = {
  id: "window-1",
  openingType: "window",
  wallSegmentId: "w1",
  offsetCm: 160,
  widthCm: 80,
  heightCm: 100,
  sillHeightCm: 100,
  hingeSide: null,
  swingDirection: null,
};

test("same-size and smaller replacements fit the local room envelope", () => {
  const sameSize = evaluateCatalogReplacementSpatialCompatibility(
    designObject,
    candidate(380, 280),
    geometry,
  );
  const smaller = evaluateCatalogReplacementSpatialCompatibility(
    designObject,
    candidate(200, 100),
    geometry,
  );

  assert.equal(sameSize.status, "compatible");
  assert.equal(sameSize.availableWidthCm, 380);
  assert.equal(sameSize.availableDepthCm, 280);
  assert.equal(smaller.status, "compatible");
});

test("oversized width is incompatible", () => {
  const result = evaluateCatalogReplacementSpatialCompatibility(
    designObject,
    candidate(381, 280),
    geometry,
  );

  assert.equal(result.status, "incompatible");
  assert.deepEqual(result.reasons, ["candidate_width_exceeds_available_width"]);
});

test("oversized depth is incompatible", () => {
  const result = evaluateCatalogReplacementSpatialCompatibility(
    designObject,
    candidate(380, 281),
    geometry,
  );

  assert.equal(result.status, "incompatible");
  assert.deepEqual(result.reasons, ["candidate_depth_exceeds_available_depth"]);
});

test("missing candidate dimensions return unknown", () => {
  const result = evaluateCatalogReplacementSpatialCompatibility(
    designObject,
    candidate(null, 100),
    geometry,
  );

  assert.equal(result.status, "unknown");
  assert.deepEqual(result.reasons, ["candidate_dimensions_missing_or_invalid"]);
});

test("saved position outside the polygon is incompatible", () => {
  const result = evaluateCatalogReplacementSpatialCompatibility(
    { ...designObject, x_cm: 500 },
    candidate(100, 100),
    geometry,
  );

  assert.equal(result.status, "incompatible");
  assert.deepEqual(result.reasons, ["saved_position_outside_room"]);
});

test("rotated placement uses rotated local width and depth axes", () => {
  const result = evaluateCatalogReplacementSpatialCompatibility(
    { ...designObject, rotation_degrees: 90 },
    candidate(279, 379),
    geometry,
  );

  assert.equal(result.status, "compatible");
  assert.ok(result.availableWidthCm !== null && Math.abs(result.availableWidthCm - 280) < 1e-6);
  assert.ok(result.availableDepthCm !== null && Math.abs(result.availableDepthCm - 380) < 1e-6);
});

test("candidate with no opening or neighbor conflict is compatible", () => {
  const result = evaluateCatalogReplacementContextCompatibility(
    "current",
    designObject,
    candidate(20, 20),
    candidate(100, 60),
    geometry,
    [],
    [],
  );

  assert.equal(result.status, "compatible");
});

test("candidate overlapping a neighbor is incompatible while edge touching is compatible", () => {
  const overlapping = evaluateCatalogReplacementContextCompatibility(
    "current",
    designObject,
    candidate(20, 20),
    candidate(100, 60),
    geometry,
    [],
    [{ id: "neighbor", x_cm: 260, y_cm: 150, width_cm: 100, depth_cm: 60, rotation_degrees: 0 }],
  );
  const touching = evaluateCatalogReplacementContextCompatibility(
    "current",
    designObject,
    candidate(20, 20),
    candidate(100, 60),
    geometry,
    [],
    [{ id: "neighbor", x_cm: 300, y_cm: 150, width_cm: 100, depth_cm: 60, rotation_degrees: 0 }],
  );

  assert.equal(overlapping.status, "incompatible");
  assert.deepEqual(overlapping.reasons, ["candidate_overlaps_neighbor"]);
  assert.equal(touching.status, "compatible");
});

test("rotated candidate overlapping a rotated neighbor is incompatible", () => {
  const result = evaluateCatalogReplacementContextCompatibility(
    "current",
    { ...designObject, rotation_degrees: 45 },
    candidate(20, 20),
    candidate(100, 40),
    geometry,
    [],
    [{ id: "neighbor", x_cm: 255, y_cm: 150, width_cm: 100, depth_cm: 40, rotation_degrees: -45 }],
  );

  assert.equal(result.status, "incompatible");
  assert.deepEqual(result.reasons, ["candidate_overlaps_neighbor"]);
});

test("candidate intruding into door clearance is incompatible and a clear candidate fits", () => {
  const blocked = evaluateCatalogReplacementContextCompatibility(
    "current",
    { x_cm: 200, y_cm: 20, rotation_degrees: 0 },
    candidate(20, 20),
    candidate(80, 20),
    geometry,
    [door],
    [],
  );
  const clear = evaluateCatalogReplacementContextCompatibility(
    "current",
    { x_cm: 200, y_cm: 50, rotation_degrees: 0 },
    candidate(20, 20),
    candidate(80, 20),
    geometry,
    [door],
    [],
  );

  assert.equal(blocked.status, "incompatible");
  assert.deepEqual(blocked.reasons, ["candidate_intersects_door_clearance"]);
  assert.equal(clear.status, "compatible");
});

test("low furniture below a window sill fits while tall furniture blocks it", () => {
  const placement = { x_cm: 200, y_cm: 10, rotation_degrees: 0 };
  const low = evaluateCatalogReplacementContextCompatibility(
    "current",
    placement,
    candidate(20, 20),
    candidate(80, 20, { heightCm: 90 }),
    geometry,
    [windowOpening],
    [],
  );
  const tall = evaluateCatalogReplacementContextCompatibility(
    "current",
    placement,
    candidate(20, 20),
    candidate(80, 20, { heightCm: 91 }),
    geometry,
    [windowOpening],
    [],
  );

  assert.equal(low.status, "compatible");
  assert.equal(tall.status, "incompatible");
  assert.deepEqual(tall.reasons, ["candidate_blocks_window"]);
});

test("missing required window clearance data is unknown", () => {
  const result = evaluateCatalogReplacementContextCompatibility(
    "current",
    { x_cm: 200, y_cm: 10, rotation_degrees: 0 },
    candidate(20, 20),
    candidate(80, 20, { heightCm: null }),
    geometry,
    [windowOpening],
    [],
  );

  assert.equal(result.status, "unknown");
  assert.deepEqual(result.reasons, ["window_clearance_unavailable"]);
});

test("replacement preserves a pre-existing neighbor overlap without creating a new collision", () => {
  const current = candidate(100, 60, { variantId: "current" });
  const replacement = candidate(100, 60, { variantId: "replacement" });

  const result = evaluateCatalogReplacementContextCompatibility(
    "current",
    designObject,
    current,
    replacement,
    geometry,
    [],
    [
      {
        id: "neighbor",
        x_cm: 240,
        y_cm: 150,
        width_cm: 100,
        depth_cm: 60,
        rotation_degrees: 0,
      },
    ],
  );

  assert.equal(result.status, "compatible");
  assert.deepEqual(result.reasons, []);
});

test("replacement that introduces a new neighbor overlap remains incompatible", () => {
  const current = candidate(20, 20, { variantId: "current" });
  const replacement = candidate(100, 60, { variantId: "replacement" });

  const result = evaluateCatalogReplacementContextCompatibility(
    "current",
    designObject,
    current,
    replacement,
    geometry,
    [],
    [
      {
        id: "neighbor",
        x_cm: 260,
        y_cm: 150,
        width_cm: 100,
        depth_cm: 60,
        rotation_degrees: 0,
      },
    ],
  );

  assert.equal(result.status, "incompatible");
  assert.deepEqual(result.reasons, ["candidate_overlaps_neighbor"]);
});
