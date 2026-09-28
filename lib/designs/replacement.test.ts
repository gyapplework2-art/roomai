import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogCandidate } from "@/lib/catalog/schema";
import { buildAttributeAwareCustomerAlternativeMap, buildCustomerAlternativeMap } from "@/lib/catalog/customer-alternative-map";
import type { RoomAIAlternative } from "@/lib/catalog/customer-alternative";
import { normalizeFurnitureAttributes } from "@/lib/design-intelligence/furniture-attributes";
import {
  createReplacementClone,
  REPLACEMENT_VISUALIZATION_WARNING,
} from "@/lib/designs/replacement";
import type { DesignSpecification } from "@/lib/designs/types";
import type { Tables } from "@/types/database.types";

const specification: DesignSpecification = {
  contractVersion: "1.0",
  designName: "Original Design",
  summary: "Original summary",
  room: { widthCm: 500, lengthCm: 400, heightCm: 250, roomType: "living_room" },
  palette: { walls: "white", primary: "tan", secondary: "green", accent: "black", metal: "brass" },
  surfaces: { walls: "paint", floor: "wood", ceiling: "paint" },
  lighting: { ambient: "ceiling", task: "lamp", accent: "sconce" },
  furniture: [
    {
      objectId: "spec-sofa",
      category: "sofa",
      name: "Original Sofa",
      description: "Original sofa",
      material: "fabric",
      color: "tan",
      dimensions: { widthCm: 200, depthCm: 90, heightCm: 80 },
      position: { xCm: 250, yCm: 200, zCm: 0 },
      rotationDegrees: 15,
      required: true,
      estimatedPrice: 1000,
      catalogSelectionKey: null,
      reasoning: "Original reasoning",
    },
    {
      objectId: "spec-table",
      category: "table",
      name: "Table",
      description: "Table",
      material: "wood",
      color: "brown",
      dimensions: { widthCm: 100, depthCm: 50, heightCm: 45 },
      position: { xCm: 100, yCm: 100, zCm: 0 },
      rotationDegrees: 0,
      required: false,
      estimatedPrice: 300,
      catalogSelectionKey: null,
      reasoning: "Table reasoning",
    },
  ],
  decorations: [],
  budget: { low: 0, high: 3000, currency: "USD" },
  advice: [],
  warnings: [],
};

function object(overrides: Partial<Tables<"design_objects">>): Tables<"design_objects"> {
  return {
    id: "object-sofa",
    design_id: "design-original",
    object_type: "furniture",
    category: "sofa",
    name: "Original Sofa",
    x_cm: 250,
    y_cm: 200,
    z_cm: 0,
    width_cm: 200,
    depth_cm: 90,
    height_cm: 80,
    rotation_degrees: 15,
    material: "fabric",
    primary_color: "tan",
    product_id: null,
    catalog_product_id: "old-product",
    catalog_product_variant_id: "old-variant",
    reasoning: "Original reasoning",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const objects = [
  object({}),
  object({
    id: "object-table",
    category: "table",
    name: "Table",
    x_cm: 100,
    y_cm: 100,
    width_cm: 100,
    depth_cm: 50,
    height_cm: 45,
    rotation_degrees: 0,
    material: "wood",
    primary_color: "brown",
    catalog_product_id: null,
    catalog_product_variant_id: null,
    reasoning: "Table reasoning",
  }),
];

const candidate: CatalogCandidate = {
  productId: "new-product",
  variantId: "new-variant",
  countryCode: "US",
  categoryCode: "seating",
  categoryName: "Seating",
  furnitureTypeCode: "sofa",
  furnitureTypeName: "Sofa",
  productTitle: "Green Leather Sofa",
  roomaiDescription: null,
  normalizedColor: "green",
  normalizedMaterial: "leather",
  normalizedStyle: "modern",
  configuration: "standard",
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
  vendorDataCheckedAt: null,
  roomaiPriceCalculatedAt: null,
  vendorName: "Internal Vendor",
  productUrl: "https://example.com/internal",
  primaryImageUrl: null,
};

test("replacement clones objects and deterministically updates only selected furniture", () => {
  const originalObjects = structuredClone(objects);
  const originalSpecification = structuredClone(specification);
  const result = createReplacementClone("design-new", specification, objects, "object-sofa", candidate);

  assert.ok(result);
  const selected = result.objects[0];
  const unaffected = result.objects[1];
  assert.equal(selected.design_id, "design-new");
  assert.equal(selected.x_cm, 250);
  assert.equal(selected.y_cm, 200);
  assert.equal(selected.z_cm, 0);
  assert.equal(selected.rotation_degrees, 15);
  assert.equal(selected.catalog_product_id, "new-product");
  assert.equal(selected.catalog_product_variant_id, "new-variant");
  assert.equal(selected.width_cm, 220);
  assert.equal(selected.depth_cm, 95);
  assert.equal(selected.height_cm, 85);
  assert.equal(selected.material, "leather");
  assert.equal(selected.primary_color, "green");
  assert.equal(selected.name, "Green Leather Sofa");
  assert.equal(selected.category, "sofa");
  assert.equal(selected.object_type, "furniture");
  assert.equal(selected.reasoning, "Original reasoning");
  assert.equal(selected.product_id, null);
  assert.equal(unaffected.name, "Table");
  assert.equal(unaffected.x_cm, 100);
  assert.equal(unaffected.design_id, "design-new");
  assert.deepEqual(objects, originalObjects);
  assert.deepEqual(specification, originalSpecification);
});

test("replacement keeps design specification consistent without changing placement or role", () => {
  const result = createReplacementClone("design-new", specification, objects, "object-sofa", candidate);

  assert.ok(result);
  const furniture = result.specification.furniture[0];
  assert.equal(furniture.name, "Green Leather Sofa");
  assert.deepEqual(furniture.dimensions, { widthCm: 220, depthCm: 95, heightCm: 85 });
  assert.equal(furniture.material, "leather");
  assert.equal(furniture.color, "green");
  assert.deepEqual(furniture.position, { xCm: 250, yCm: 200, zCm: 0 });
  assert.equal(furniture.rotationDegrees, 15);
  assert.equal(furniture.category, "sofa");
  assert.equal(furniture.reasoning, "Original reasoning");
  assert.equal(result.specification.furniture[1].name, "Table");
  assert.ok(result.specification.warnings.includes(REPLACEMENT_VISUALIZATION_WARNING));
});

test("attribute-aware alternative selection retains identity for a versioned furniture replacement", async () => {
  const current = { ...candidate, productId: "old-product", variantId: "old-variant" };
  const different = { ...candidate, productId: "other-product", variantId: "a-different" };
  const oversized = { ...candidate, productId: "oversized-product", variantId: "oversized", widthCm: 490 };
  const pool = [different, candidate, oversized];
  const originalObjects = structuredClone(objects);
  const originalSpecification = structuredClone(specification);
  const originalPool = structuredClone(pool);
  const contexts = new Map([[current.variantId, {
    currentObjectId: objects[0].id,
    designObject: { x_cm: objects[0].x_cm, y_cm: objects[0].y_cm, rotation_degrees: objects[0].rotation_degrees },
    geometry: {
      schemaVersion: "1.0" as const,
      shapeType: "rectangle" as const,
      templateTransform: { rotationDegrees: 0 as const, mirroredHorizontal: false, mirroredVertical: false },
      ceilingHeightCm: 250,
      vertices: [
        { id: "a", xCm: 0, yCm: 0 }, { id: "b", xCm: 500, yCm: 0 },
        { id: "c", xCm: 500, yCm: 400 }, { id: "d", xCm: 0, yCm: 400 },
      ],
      wallSegments: [
        { id: "ab", startVertexId: "a", endVertexId: "b" },
        { id: "bc", startVertexId: "b", endVertexId: "c" },
        { id: "cd", startVertexId: "c", endVertexId: "d" },
        { id: "da", startVertexId: "d", endVertexId: "a" },
      ],
    },
    openings: [],
    neighbors: objects,
  }]]);
  const baselineIdentity = new Map<RoomAIAlternative, string>();
  const baseline = buildCustomerAlternativeMap([current], pool, 3, contexts, baselineIdentity);
  assert.equal(baseline.get(current.variantId)?.length, 2);
  assert.equal(baselineIdentity.get(baseline.get(current.variantId)![0]), different.variantId);

  const identity = new Map<RoomAIAlternative, string>();
  const requestedVariantIds: string[][] = [];
  const alternatives = await buildAttributeAwareCustomerAlternativeMap(
    [current], pool, 3, contexts, identity,
    async (ids, capacities) => {
      requestedVariantIds.push([...ids]);
      return new Map(ids.map((id) => [id, normalizeFurnitureAttributes(
        { seatingCapacity: capacities.get(id) ?? null },
        { normalizedAttributes: { arm_type: id === different.variantId ? "track" : "rolled", seat_depth: 55.88 } },
      )]));
    },
  );
  assert.deepEqual(requestedVariantIds, [[current.variantId, different.variantId, candidate.variantId, oversized.variantId]]);
  assert.equal(alternatives.get(current.variantId)?.length, 2);
  const selected = alternatives.get(current.variantId)?.[0];
  assert.ok(selected);
  const selectedId = identity.get(selected);
  assert.equal(selectedId, candidate.variantId);
  assert.equal(identity.get(alternatives.get(current.variantId)![1]), different.variantId);
  assert.equal([...identity.values()].includes(oversized.variantId), false);
  const serialized = JSON.stringify(alternatives.get(current.variantId));
  for (const internalField of [
    "vendorName", "productUrl", "productId", "variantId", "catalog_product_id",
    "suitabilityScore", "scoreBreakdown", "spatialCompatibility", "aestheticCompatibility",
    "furnitureAttributeCompatibility", "armStyle", "normalized_attributes",
  ]) {
    assert.equal(serialized.includes(internalField), false, internalField);
  }
  for (const internalValue of [candidate.variantId, candidate.productId, candidate.vendorName, candidate.productUrl]) {
    assert.equal(serialized.includes(internalValue), false);
  }

  const resolvedCandidate = pool.find((item) => item.variantId === selectedId);
  assert.ok(resolvedCandidate);
  const clone = createReplacementClone("design-new", specification, objects, objects[0].id, resolvedCandidate);
  assert.ok(clone);
  assert.equal(clone.objects[0].catalog_product_variant_id, candidate.variantId);
  assert.equal(clone.objects[0].catalog_product_id, candidate.productId);
  assert.equal(clone.objects[0].object_type, objects[0].object_type);
  assert.equal(clone.objects[0].category, objects[0].category);
  assert.equal(clone.objects[0].rotation_degrees, objects[0].rotation_degrees);
  assert.deepEqual(
    [clone.objects[0].x_cm, clone.objects[0].y_cm, clone.objects[0].z_cm],
    [objects[0].x_cm, objects[0].y_cm, objects[0].z_cm],
  );
  assert.deepEqual(
    [clone.objects[0].width_cm, clone.objects[0].depth_cm, clone.objects[0].height_cm],
    [candidate.widthCm, candidate.depthCm, candidate.heightCm],
  );
  assert.deepEqual(clone.specification.furniture[0].position, specification.furniture[0].position);
  assert.deepEqual(clone.specification.furniture[0].dimensions, { widthCm: candidate.widthCm, depthCm: candidate.depthCm, heightCm: candidate.heightCm });
  assert.equal(clone.specification.furniture[0].name, candidate.productTitle);
  assert.equal(clone.specification.furniture[0].material, candidate.normalizedMaterial);
  assert.equal(clone.specification.furniture[0].color, candidate.normalizedColor);
  assert.deepEqual(clone.specification.furniture[1], specification.furniture[1]);
  assert.equal(clone.specification.furniture[0].catalogSelectionKey, null);
  assert.ok(clone.specification.warnings.includes(REPLACEMENT_VISUALIZATION_WARNING));
  const unaffectedObject = Object.fromEntries(
    Object.entries(objects[1]).filter(([key]) => key !== "id" && key !== "created_at"),
  );
  assert.deepEqual(clone.objects[1], { ...unaffectedObject, design_id: "design-new" });
  assert.deepEqual(objects, originalObjects);
  assert.deepEqual(specification, originalSpecification);
  assert.deepEqual(pool, originalPool);

  const withoutAttributes = await buildAttributeAwareCustomerAlternativeMap(
    [current], pool, 3, contexts, undefined, async () => new Map(),
  );
  assert.deepEqual(withoutAttributes, baseline);
});
