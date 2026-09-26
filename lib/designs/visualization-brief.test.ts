import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogCandidate } from "@/lib/catalog/schema";
import { buildVisualizationBrief, visualizationPrompt } from "@/lib/designs/visualization-brief";
import type { DesignSpecification } from "@/lib/designs/types";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";
import type { Tables } from "@/types/database.types";

const specification: DesignSpecification = {
  contractVersion: "1.0",
  designName: "Quiet Living Room",
  summary: "A calm room with grounded seating.",
  room: { widthCm: 500, lengthCm: 400, heightCm: 260, roomType: "living_room" },
  palette: { walls: "warm white", primary: "green", secondary: "oak", accent: "black", metal: "brass" },
  surfaces: { walls: "matte paint", floor: "oak", ceiling: "white paint" },
  lighting: { ambient: "ceiling light", task: "floor lamp", accent: "wall light" },
  furniture: [],
  decorations: [],
  budget: { low: 1000, high: 5000, currency: "USD" },
  advice: [],
  warnings: [],
};

const geometry: RoomGeometry = {
  schemaVersion: "1.0",
  shapeType: "rectangle",
  templateTransform: { rotationDegrees: 0, mirroredHorizontal: false, mirroredVertical: false },
  ceilingHeightCm: 260,
  vertices: [
    { id: "v1", xCm: 0, yCm: 0 },
    { id: "v2", xCm: 500, yCm: 0 },
    { id: "v3", xCm: 500, yCm: 400 },
    { id: "v4", xCm: 0, yCm: 400 },
  ],
  wallSegments: [
    { id: "w1", startVertexId: "v1", endVertexId: "v2" },
    { id: "w2", startVertexId: "v2", endVertexId: "v3" },
    { id: "w3", startVertexId: "v3", endVertexId: "v4" },
    { id: "w4", startVertexId: "v4", endVertexId: "v1" },
  ],
};

const openings: RoomOpening[] = [{
  id: "door-1",
  openingType: "door",
  wallSegmentId: "w1",
  offsetCm: 40,
  widthCm: 90,
  heightCm: 210,
  sillHeightCm: null,
  hingeSide: "left",
  swingDirection: "inward",
}];

const object: Tables<"design_objects"> = {
  id: "object-1",
  design_id: "design-1",
  object_type: "furniture",
  category: "sofa",
  name: "Old sofa name",
  x_cm: 240,
  y_cm: 180,
  z_cm: 0,
  width_cm: 220,
  depth_cm: 95,
  height_cm: 85,
  rotation_degrees: 90,
  material: "old material",
  primary_color: "old color",
  product_id: null,
  catalog_product_id: "secret-product-id",
  catalog_product_variant_id: "secret-variant-id",
  reasoning: "Internal placement reasoning",
  created_at: "2026-01-01T00:00:00Z",
};

const decoration: Tables<"design_objects"> = {
  ...object,
  id: "decoration-1",
  object_type: "decoration",
  category: "art",
  name: "Abstract Print",
  x_cm: 300,
  y_cm: 10,
  z_cm: 140,
  width_cm: null,
  depth_cm: null,
  height_cm: null,
  rotation_degrees: 0,
  material: "paper",
  primary_color: "ochre",
  catalog_product_id: null,
  catalog_product_variant_id: null,
};

const candidate: CatalogCandidate = {
  productId: "secret-product-id",
  variantId: "secret-variant-id",
  countryCode: "US",
  categoryCode: "seating",
  categoryName: "Seating",
  furnitureTypeCode: "sofa",
  furnitureTypeName: "Sofa",
  productTitle: "Green Leather Sofa",
  roomaiDescription: "Customer description",
  normalizedColor: "forest green",
  normalizedMaterial: "leather",
  normalizedStyle: "modern",
  configuration: "three-seat",
  seatingCapacity: 3,
  widthCm: 220,
  depthCm: 95,
  heightCm: 85,
  weightKg: null,
  currency: "USD",
  roomaiSellingPrice: 1800,
  normalizedAvailability: "in_stock",
  deliveryText: null,
  estimatedDeliveryDaysMin: null,
  estimatedDeliveryDaysMax: null,
  vendorDataCheckedAt: "2026-01-01T00:00:00Z",
  roomaiPriceCalculatedAt: "2026-01-01T00:00:00Z",
  vendorName: "Secret Vendor",
  productUrl: "https://vendor.example/product",
  primaryImageUrl: "https://vendor.example/image.jpg",
};

function createBrief() {
  return buildVisualizationBrief({
    project: { name: "My room", roomType: "living_room" },
    specification,
    geometry,
    openings,
    objects: [object, decoration],
    catalogByVariantId: new Map([[candidate.variantId, candidate]]),
  });
}

test("builds a deterministic brief with authoritative room and placement data", () => {
  const first = createBrief();
  const second = createBrief();

  assert.deepEqual(first, second);
  assert.deepEqual(first.room.polygon, geometry.vertices.map(({ xCm, yCm }) => ({ xCm, yCm })));
  assert.deepEqual(first.room.walls, geometry.wallSegments);
  assert.deepEqual(first.room.openings[0], {
    openingType: "door",
    wallSegmentId: "w1",
    offsetCm: 40,
    widthCm: 90,
    heightCm: 210,
    sillHeightCm: null,
    hingeSide: "left",
    swingDirection: "inward",
  });
  assert.deepEqual(first.furniture[0].position, { xCm: 240, yCm: 180, zCm: 0 });
  assert.equal(first.furniture[0].rotationDegrees, 90);
  assert.deepEqual(first.furniture[0].dimensions, { widthCm: 220, depthCm: 95, heightCm: 85 });
  assert.deepEqual(first.decorations[0], {
    role: "art",
    name: "Abstract Print",
    position: { xCm: 300, yCm: 10, zCm: 140 },
    rotationDegrees: 0,
    material: "paper",
    color: "ochre",
  });
});

test("uses selected catalog appearance without exposing internal catalog or vendor data", () => {
  const brief = createBrief();
  const serialized = JSON.stringify(brief);

  assert.equal(brief.furniture[0].name, "Green Leather Sofa");
  assert.equal(brief.furniture[0].material, "leather");
  assert.equal(brief.furniture[0].color, "forest green");
  assert.equal(brief.furniture[0].style, "modern");
  assert.equal(brief.furniture[0].configuration, "three-seat");
  assert.equal(serialized.includes("secret-product-id"), false);
  assert.equal(serialized.includes("secret-variant-id"), false);
  assert.equal(serialized.includes("Secret Vendor"), false);
  assert.equal(serialized.includes("vendor.example"), false);
  assert.equal(serialized.includes("Internal placement reasoning"), false);
  assert.equal(serialized.includes("1800"), false);
});

test("renderer prompt explicitly preserves the existing design without text overlays", () => {
  const prompt = visualizationPrompt(createBrief());

  assert.match(prompt, /VISUALIZE THE EXISTING DESIGN\. DO NOT REDESIGN THE ROOM\./);
  assert.match(prompt, /Do not add, remove, replace, or reposition major furniture or decorations\./);
  assert.match(prompt, /Do not display logos, vendor names, websites, product labels, measurements, captions, or text overlays\./);
});
