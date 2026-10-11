import assert from "node:assert/strict";
import test from "node:test";
import { correctGeneratedDesignPlacement } from "@/lib/designs/placement";
import { createDesignObjectInserts } from "@/lib/designs/persistence";
import type { DesignSpecification } from "@/lib/designs/types";
import type { FurniturePlanV11, FurniturePlanItemV11 } from "@/lib/furniture-planning/types";
import { createRectangleGeometry, createLShapeGeometry } from "@/lib/geometry/templates";
import type { RoomOpening } from "@/lib/geometry/types";
import { detectFloorPlanWarnings, projectFloorPlanObjects } from "@/lib/designs/floor-plan";

function item(id: string, xCm: number, yCm: number, width = 60, depth = 60, role: FurniturePlanItemV11["semanticPlacement"]["role"] = "SECONDARY_SEATING"): FurniturePlanItemV11 {
  return {
    id, category: role === "AREA_RUG" ? "rug" : role === "COFFEE_TABLE" ? "coffee_table" : "sofa", subtype: null, priority: "required",
    placement: { preferredZone: null, anchorWallId: null, approximatePosition: { xCm, yCm }, preferredOrientationDegrees: 0 },
    sizeRange: { widthMinCm: width, widthMaxCm: width, depthMinCm: depth, depthMaxCm: depth, heightMinCm: 40, heightMaxCm: 40 },
    styleHints: [], materialHints: [], colorHints: [], functionalRequirements: [], reasoning: "Test placement",
    semanticPlacement: { role, mode: "FLOATING", alignment: null, targetWallId: null, zoneId: null, relationships: [], fallbackModes: [] },
  };
}

function fixture(items: FurniturePlanItemV11[]) {
  const plan: FurniturePlanV11 = { schemaVersion: "1.1", roomIntent: "Living room", notes: [], items };
  const specification: DesignSpecification = {
    contractVersion: "1.0", designName: "Test", summary: "Test", room: { widthCm: 600, lengthCm: 500, heightCm: 250, roomType: "living_room" },
    palette: { walls: "white", primary: "green", secondary: "black", accent: "red", metal: "brass" },
    surfaces: { walls: "paint", floor: "wood", ceiling: "paint" }, lighting: { ambient: "light", task: "light", accent: "light" },
    furniture: items.map((entry) => ({
      objectId: entry.id, category: entry.category, name: entry.id, description: "Furniture", material: "wood", color: "black",
      dimensions: { widthCm: entry.sizeRange.widthMinCm, depthCm: entry.sizeRange.depthMinCm, heightCm: 40 },
      position: { xCm: 0, yCm: 0, zCm: 0 }, rotationDegrees: 0, required: true, estimatedPrice: 700, catalogSelectionKey: "candidate_1", reasoning: "Test",
    })), decorations: [], budget: { low: 0, high: 3000, currency: "USD" }, advice: [], warnings: [],
  };
  return { plan, specification };
}

test("semantic references correct final AI coordinates before persistence without changing catalog facts", () => {
  for (const geometry of [createRectangleGeometry(600, 500, 250), createLShapeGeometry(600, 500, 250)]) {
    const { plan, specification } = fixture([item("sofa", 150, 300, 120, 60, "PRIMARY_SEATING"), item("chair", 350, 300)]);
    plan.items[1].placement.preferredOrientationDegrees = 90;
    const before = structuredClone({ plan, specification });
    const result = correctGeneratedDesignPlacement(specification, plan, geometry, []);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual({ plan, specification }, before);
    assert.equal(result.specification.furniture[1].rotationDegrees, 90);
    assert.deepEqual(result.specification.furniture[0].position, { xCm: 150, yCm: 300, zCm: 0 });
    assert.deepEqual(result.specification.furniture[0].dimensions, specification.furniture[0].dimensions);
    assert.equal(result.specification.furniture[0].estimatedPrice, 700);
    assert.equal(result.specification.furniture[0].catalogSelectionKey, "candidate_1");
    const inserts = createDesignObjectInserts("design", result.specification, { sofa: { catalogProductId: "product", catalogProductVariantId: "variant" } });
    assert.equal(inserts[0].x_cm, 150);
    assert.equal(inserts[0].catalog_product_variant_id, "variant");
    assert.deepEqual(correctGeneratedDesignPlacement(specification, plan, geometry, []), result);
  }
});

test("bounded repair separates sofa/chair collisions and allows rug-under-seating layering", () => {
  const { plan, specification } = fixture([item("sofa", 200, 250), item("chair", 220, 250), item("rug", 200, 250, 180, 180, "AREA_RUG")]);
  const result = correctGeneratedDesignPlacement(specification, plan, createRectangleGeometry(600, 500, 250), []);
  assert.equal(result.ok, true);
  if (result.ok) assert.notDeepEqual(result.specification.furniture[0].position, result.specification.furniture[1].position);
});

test("coffee-table IN_FRONT_OF intent is re-resolved using actual dimensions and functional spacing", () => {
  const geometry = createRectangleGeometry(600, 600, 250);
  const { plan, specification } = fixture([item("sofa", 300, 300, 160, 80, "PRIMARY_SEATING"), item("table", 300, 300, 100, 60, "COFFEE_TABLE")]);
  plan.items[0].placement.anchorWallId = geometry.wallSegments[0].id;
  plan.items[0].semanticPlacement.mode = "AGAINST_WALL";
  plan.items[0].semanticPlacement.targetWallId = geometry.wallSegments[0].id;
  plan.items[0].semanticPlacement.alignment = "CENTERED";
  plan.items[1].semanticPlacement.relationships = [{ type: "IN_FRONT_OF", targetItemId: "sofa" }];
  const result = correctGeneratedDesignPlacement(specification, plan, geometry, []);
  assert.equal(result.ok, true);
  if (result.ok) assert.notEqual(result.specification.furniture[1].position.yCm, result.specification.furniture[0].position.yCm);
});

test("impossible, omitted and unbound furniture returns diagnostics rather than an accepted design", () => {
  const { plan, specification } = fixture([item("huge", 200, 200, 1000, 1000)]);
  const geometry = createRectangleGeometry(300, 300, 250);
  const result = correctGeneratedDesignPlacement(specification, plan, geometry, []);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "OUTSIDE_ROOM"));
  assert.equal(correctGeneratedDesignPlacement({ ...specification, furniture: [] }, plan, geometry, []).ok, false);
  assert.equal(correctGeneratedDesignPlacement(specification, { ...plan, items: [] }, geometry, []).ok, false);
});

test("door obstruction cannot be silently accepted; repair is revalidated", () => {
  const geometry = createRectangleGeometry(600, 500, 250);
  const { plan, specification } = fixture([item("seating", 80, 0, 140, 100, "PRIMARY_SEATING")]);
  const opening: RoomOpening = { openingType: "door", wallSegmentId: geometry.wallSegments[0].id, offsetCm: 20, widthCm: 100, heightCm: 210, sillHeightCm: null, hingeSide: "left", swingDirection: "inward" };
  const result = correctGeneratedDesignPlacement(specification, plan, geometry, [opening]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.diagnostics.length > 0);
});

test("recoverable boundary violations are corrected without changing actual selected dimensions", () => {
  const { plan, specification } = fixture([item("chair", 25, 250, 40, 60)]);
  specification.furniture[0].dimensions.widthCm = 80;
  const result = correctGeneratedDesignPlacement(specification, plan, createRectangleGeometry(600, 500, 250), []);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.specification.furniture[0].dimensions.widthCm, 80);
    assert.ok(result.specification.furniture[0].position.xCm >= 40);
  }
});

test("valid doorway approach and bounded circulation are allowed", () => {
  const geometry = createRectangleGeometry(600, 500, 250);
  const { plan, specification } = fixture([item("sofa", 300, 350, 140, 70, "PRIMARY_SEATING")]);
  const opening: RoomOpening = { openingType: "door", wallSegmentId: geometry.wallSegments[0].id, offsetCm: 20, widthCm: 100, heightCm: 210, sillHeightCm: null, hingeSide: "left", swingDirection: "inward" };
  assert.equal(correctGeneratedDesignPlacement(specification, plan, geometry, [opening]).ok, true);
});

test("valid floating relationships retain explicit directional coverage while layer mismatches fail", () => {
  const { plan, specification } = fixture([item("sofa", 300, 300, 160, 80, "PRIMARY_SEATING"), item("table", 300, 150, 100, 60, "COFFEE_TABLE")]);
  plan.items[1].semanticPlacement.relationships = [{ type: "IN_FRONT_OF", targetItemId: "sofa" }];
  specification.furniture.forEach((object, index) => { object.position = { ...plan.items[index].placement.approximatePosition!, zCm: 0 }; });
  const result = correctGeneratedDesignPlacement(specification, plan, createRectangleGeometry(600, 500, 250), []);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.diagnostics[0].code, "RELATIONSHIP_DIRECTION_UNRESOLVED");
    assert.ok(result.specification.warnings.length);
  }
  specification.furniture[0].category = "rug";
  const mismatch = correctGeneratedDesignPlacement(specification, plan, createRectangleGeometry(600, 500, 250), []);
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.ok(mismatch.diagnostics.some((diagnostic) => diagnostic.code === "FURNITURE_TYPE_MISMATCH"));
});

test("actual rug categories alone receive occupancy exemptions shared with the saved floor plan", () => {
  const geometry = createRectangleGeometry(600, 500, 250);
  const { plan, specification } = fixture([item("sofa", 250, 250), item("chair", 250, 250)]);
  plan.items[1].category = "armchair";
  plan.items[1].semanticPlacement.role = "AREA_RUG";
  specification.furniture[1].category = "armchair";
  const rejected = correctGeneratedDesignPlacement(specification, plan, geometry, []);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.ok(rejected.diagnostics.some((diagnostic) => diagnostic.code === "SEMANTIC_OCCUPANCY_MISMATCH"));
  plan.items[1].category = "rug";
  specification.furniture[1].category = "area_rug";
  const accepted = correctGeneratedDesignPlacement(specification, plan, geometry, []);
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    const rows = createDesignObjectInserts("design", accepted.specification).map((row) => ({
      id: row.name!, object_type: row.object_type, category: row.category ?? null, name: row.name ?? null,
      x_cm: row.x_cm ?? null, y_cm: row.y_cm ?? null, width_cm: row.width_cm ?? null, depth_cm: row.depth_cm ?? null,
      rotation_degrees: row.rotation_degrees ?? 0,
    }));
    assert.deepEqual(detectFloorPlanWarnings(projectFloorPlanObjects(rows).objects, geometry, []), []);
  }
  plan.items[1].category = "unrecognized_category";
  specification.furniture[1].category = "unrecognized_category";
  assert.equal(correctGeneratedDesignPlacement(specification, plan, geometry, []).ok, false);
});

test("fully valid final positions and rotations survive unusable semantic references", () => {
  const { plan, specification } = fixture([item("chair", 1200, 1200, 80, 60)]);
  specification.furniture[0].position = { xCm: 300, yCm: 250, zCm: 0 };
  specification.furniture[0].rotationDegrees = 90;
  const result = correctGeneratedDesignPlacement(specification, plan, createRectangleGeometry(600, 500, 250), []);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.specification, specification);
    assert.deepEqual(result.changedItemIds, []);
    assert.deepEqual(result.diagnostics, []);
  }
});

test("invalid floating table spacing fails closed instead of inventing a front direction", () => {
  const { plan, specification } = fixture([item("sofa", 300, 300, 160, 80, "PRIMARY_SEATING"), item("table", 300, 300, 100, 60, "COFFEE_TABLE")]);
  plan.items[1].semanticPlacement.relationships = [{ type: "IN_FRONT_OF", targetItemId: "sofa" }];
  const result = correctGeneratedDesignPlacement(specification, plan, createRectangleGeometry(600, 500, 250), []);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "FURNITURE_OVERLAP"));
});

test("an enforceable wall-front relationship rejects or repairs a table placed behind seating", () => {
  const geometry = createRectangleGeometry(600, 600, 250);
  const { plan, specification } = fixture([item("sofa", 300, 300, 160, 80, "PRIMARY_SEATING"), item("table", 300, 150, 100, 60, "COFFEE_TABLE")]);
  plan.items[0].placement.anchorWallId = geometry.wallSegments[0].id;
  plan.items[0].semanticPlacement.mode = "AGAINST_WALL";
  plan.items[0].semanticPlacement.targetWallId = geometry.wallSegments[0].id;
  plan.items[0].semanticPlacement.alignment = "CENTERED";
  plan.items[1].semanticPlacement.relationships = [{ type: "IN_FRONT_OF", targetItemId: "sofa" }];
  specification.furniture.forEach((object, index) => { object.position = { ...plan.items[index].placement.approximatePosition!, zCm: 0 }; });
  const result = correctGeneratedDesignPlacement(specification, plan, geometry, []);
  assert.equal(result.ok, true);
  if (result.ok) assert.ok(result.specification.furniture[1].position.yCm > result.specification.furniture[0].position.yCm);
});

test("window height and unknown sill height remain enforceable failures", () => {
  const geometry = createRectangleGeometry(600, 500, 250);
  const { plan, specification } = fixture([item("chair", 200, 30, 80, 60)]);
  specification.furniture[0].position = { xCm: 200, yCm: 30, zCm: 0 };
  for (const sillHeightCm of [100, 20, null]) {
    const opening: RoomOpening = { openingType: "window", wallSegmentId: geometry.wallSegments[0].id, offsetCm: 160, widthCm: 80, heightCm: 100, sillHeightCm, hingeSide: null, swingDirection: null };
    const result = correctGeneratedDesignPlacement(specification, plan, geometry, [opening]);
    assert.equal(result.ok, sillHeightCm === 100);
    if (!result.ok) assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "WINDOW_OBSTRUCTION"));
  }
});

test("omitted optional targets cannot silently remove a retained required relationship", () => {
  const { plan, specification } = fixture([item("sofa", 300, 300), item("optional", 100, 100)]);
  plan.items[1].priority = "optional";
  plan.items[0].semanticPlacement.relationships = [{ type: "ADJACENT_TO", targetItemId: "optional" }];
  specification.furniture.pop();
  const result = correctGeneratedDesignPlacement(specification, plan, createRectangleGeometry(600, 500, 250), []);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.diagnostics[0].code, "RELATIONSHIP_TARGET_MISSING");
  plan.items[0].semanticPlacement.relationships = [];
  assert.equal(correctGeneratedDesignPlacement(specification, plan, createRectangleGeometry(600, 500, 250), []).ok, true);
});

test("centered-zone correction supplies derived zones and rejects unknown zone identifiers", () => {
  const { plan, specification } = fixture([item("chair", -200, -200)]);
  plan.items[0].semanticPlacement.mode = "CENTERED_IN_ZONE";
  plan.items[0].semanticPlacement.zoneId = "primary-seating";
  const geometry = createRectangleGeometry(600, 500, 250);
  const result = correctGeneratedDesignPlacement(specification, plan, geometry, []);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.specification.furniture[0].position, { xCm: 300, yCm: 250, zCm: 0 });
  plan.items[0].semanticPlacement.zoneId = "missing-zone";
  const missing = correctGeneratedDesignPlacement(specification, plan, geometry, []);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.ok(missing.diagnostics.some((diagnostic) => diagnostic.code === "ZONE_CONTEXT_UNRESOLVED"));
});

test("functional door-approach repair revalidates circulation and preserves identity inputs", () => {
  const geometry = createRectangleGeometry(600, 500, 250);
  const { plan, specification } = fixture([item("sofa", 300, 350, 140, 70, "PRIMARY_SEATING"), item("chair", 70, 70, 60, 60)]);
  specification.furniture.forEach((object, index) => { object.position = { ...plan.items[index].placement.approximatePosition!, zCm: 0 }; });
  const opening: RoomOpening = { openingType: "door", wallSegmentId: geometry.wallSegments[0].id, offsetCm: 20, widthCm: 100, heightCm: 210, sillHeightCm: null, hingeSide: "left", swingDirection: "inward" };
  const result = correctGeneratedDesignPlacement(specification, plan, geometry, [opening]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.notDeepEqual(result.specification.furniture[1].position, specification.furniture[1].position);
    const rows = createDesignObjectInserts("design", result.specification, { chair: { catalogProductId: "product", catalogProductVariantId: "variant" } });
    assert.equal(rows[1].catalog_product_variant_id, "variant");
    assert.equal(result.specification.furniture[1].estimatedPrice, 700);
    assert.deepEqual(correctGeneratedDesignPlacement(specification, plan, geometry, [opening]), result);
  }
});