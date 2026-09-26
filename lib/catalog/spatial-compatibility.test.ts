import { test } from "node:test";
import assert from "node:assert/strict";

import type { CatalogCandidate } from "@/lib/catalog/schema";
import { evaluateCatalogReplacementSpatialCompatibility } from "@/lib/catalog/spatial-compatibility";
import type { RoomGeometry } from "@/lib/geometry/types";

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

function candidate(widthCm: number | null, depthCm: number | null): CatalogCandidate {
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
  };
}

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
