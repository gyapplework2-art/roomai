import assert from "node:assert/strict";
import test from "node:test";

import { GEOMETRY_EPSILON } from "@/lib/geometry/dimensions";
import { isPointInsideOrOnPolygon } from "@/lib/geometry/point-in-polygon";
import { rectanglesOverlapWithPositiveArea } from "@/lib/geometry/polygons";
import { createRectangleGeometry, createLShapeGeometry, createTShapeGeometry, createUShapeGeometry } from "@/lib/geometry/templates";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";
import { createFurnitureFootprint } from "./footprints";
import { resolveLivingRoomComposition } from "./role-plan";
import { validateSpatialPlan } from "./spatial-validator";
import type { FurniturePlanItem, FurniturePlan, FurniturePlanItemV11 } from "./types";

const room = createRectangleGeometry(500, 400, 250);

function item(id: string, xCm = 200, yCm = 200, widthCm = 100, depthCm = 100, orientation = 0): FurniturePlanItem {
  return {
    id, category: "armchair", subtype: null, priority: "required",
    placement: { preferredZone: null, anchorWallId: null, approximatePosition: { xCm, yCm }, preferredOrientationDegrees: orientation },
    sizeRange: { widthMinCm: widthCm, widthMaxCm: widthCm, depthMinCm: depthCm, depthMaxCm: depthCm, heightMinCm: 50, heightMaxCm: 100 },
    styleHints: [], materialHints: [], colorHints: [], functionalRequirements: [], reasoning: "Spatial validation test",
  };
}

function plan(items: FurniturePlanItem[]): FurniturePlan {
  return { schemaVersion: "1.0", roomIntent: "Validation only", items, notes: [] };
}

function types(items: FurniturePlanItem[], geometry = room, openings: RoomOpening[] = []) {
  return validateSpatialPlan(plan(items), geometry, openings).violations.map((violation) => violation.type);
}

test("a valid whole-room arrangement is unchanged and has no violations", () => {
  const source = plan([item("a", 100, 100), item("b", 300, 200, 80, 40, 30)]);
  const snapshot = structuredClone(source);
  const geometrySnapshot = structuredClone(room);
  assert.deepEqual(validateSpatialPlan(source, room), { valid: true, violations: [] });
  assert.deepEqual(source, snapshot);
  assert.deepEqual(room, geometrySnapshot);
});

test("footprints touching a wall boundary are contained without clearance requirements", () => {
  assert.deepEqual(types([item("touching", 50, 50)]), []);
});

test("a corner outside is reported even with its center inside", () => {
  const source = item("outside", 40, 100);
  assert.ok(source.placement.approximatePosition);
  assert.ok(isPointInsideOrOnPolygon(source.placement.approximatePosition, room.vertices));
  const result = validateSpatialPlan(plan([source]), room);
  assert.equal(result.valid, false);
  assert.deepEqual(result.violations.map((violation) => violation.type), ["OUTSIDE_ROOM"]);
  const violation = result.violations[0];
  assert.equal(violation.type, "OUTSIDE_ROOM");
  if (violation.type === "OUTSIDE_ROOM") assert.deepEqual(violation.details.footprint.corners[0], { xCm: -10, yCm: 50 });
});

test("rotated footprint can leave the room although the center is inside", () => {
  assert.deepEqual(types([item("rotated", 50, 100, 100, 100, 45)]), ["OUTSIDE_ROOM"]);
});

const containmentCases: Array<{ name: string; geometry: RoomGeometry; furniture: FurniturePlanItem; expected: boolean }> = [
  { name: "L-shape interior", geometry: createLShapeGeometry(600, 500, 250), furniture: item("a", 100, 100, 80, 80), expected: true },
  { name: "L-shape notch crossing", geometry: createLShapeGeometry(600, 500, 250), furniture: item("a", 350, 170, 100, 100), expected: false },
  { name: "T-shape interior", geometry: createTShapeGeometry(600, 500, 250), furniture: item("a", 300, 70, 100, 100), expected: true },
  { name: "T-shape boundary crossing", geometry: createTShapeGeometry(600, 500, 250), furniture: item("a", 250, 150, 100, 100), expected: false },
  { name: "U-shape interior", geometry: createUShapeGeometry(600, 500, 250), furniture: item("a", 100, 300, 100, 100), expected: true },
  { name: "U-shape exterior notch", geometry: createUShapeGeometry(600, 500, 250), furniture: item("a", 300, 300, 100, 100), expected: false },
];
for (const { name, geometry, furniture, expected } of containmentCases) {
  test(`complete containment: ${name}`, () => {
    const result = validateSpatialPlan(plan([furniture]), geometry);
    assert.equal(result.valid, expected);
    assert.deepEqual(result.violations.map((violation) => violation.type), expected ? [] : ["OUTSIDE_ROOM"]);
  });
}

test("all corners and center inside a U-shape are insufficient when an edge bridges its notch", () => {
  const geometry = createUShapeGeometry(600, 500, 250);
  const source = item("bridge", 300, 200, 500, 300);
  const built = createFurnitureFootprint(source);
  assert.ok(built.valid);
  assert.ok(isPointInsideOrOnPolygon(built.footprint.center, geometry.vertices));
  assert.ok(built.footprint.corners.every((corner) => isPointInsideOrOnPolygon(corner, geometry.vertices)));
  assert.deepEqual(types([source], geometry), ["OUTSIDE_ROOM"]);
});

const overlapCases = [
  { name: "identical", second: item("b"), expected: true },
  { name: "partial", second: item("b", 260, 200), expected: true },
  { name: "rotated", second: item("b", 250, 200, 100, 40, -45), expected: true },
  { name: "separated", second: item("b", 350, 200), expected: false },
  { name: "edge touching", second: item("b", 300, 200), expected: false },
  { name: "corner touching", second: item("b", 300, 300), expected: false },
];
for (const { name, second, expected } of overlapCases) {
  test(`oriented overlap: ${name}`, () => {
    const result = validateSpatialPlan(plan([item("a"), second]), room);
    assert.equal(result.valid, !expected);
    assert.deepEqual(result.violations.map((violation) => violation.type), expected ? ["FURNITURE_OVERLAP"] : []);
    if (expected) assert.deepEqual(result.violations[0].itemIds, ["a", "b"]);
  });
}

test("overlapping AABBs do not imply overlapping thin oriented rectangles", () => {
  const first = item("a", 200, 200, 120, 10, 45);
  const second = item("b", 220, 180, 120, 10, 45);
  assert.deepEqual(types([first, second]), []);
});

test("positive projection overlap uses the single documented geometric epsilon", () => {
  assert.deepEqual(types([item("a"), item("b", 300 - GEOMETRY_EPSILON / 2, 200)]), []);
  assert.deepEqual(types([item("a"), item("b", 300 - GEOMETRY_EPSILON * 2, 200)]), ["FURNITURE_OVERLAP"]);
});

for (const category of ["sofa", "coffee_table"]) {
  test(`AREA_RUG floor-layer overlap with ${category} is allowed`, () => {
    const rug = { ...item("rug"), category: "rug" };
    const furniture = { ...item("furniture"), category };
    const first = createFurnitureFootprint(rug);
    const second = createFurnitureFootprint(furniture);
    assert.ok(first.valid && second.valid);
    assert.ok(rectanglesOverlapWithPositiveArea(first.footprint.corners, second.footprint.corners));
    assert.deepEqual(types([rug, furniture]), []);
  });
}

test("two rugs sharing positive area are rejected", () => {
  assert.deepEqual(types([{ ...item("a"), category: "rug" }, { ...item("b"), category: "area_rug" }]), ["FURNITURE_OVERLAP"]);
});

test("no coffee-table/seating layering exception is invented", () => {
  assert.deepEqual(types([{ ...item("a"), category: "coffee_table" }, { ...item("b"), category: "sofa" }]), ["FURNITURE_OVERLAP"]);
});

const door: RoomOpening = {
  id: "door", openingType: "door", wallSegmentId: "wall-1", offsetCm: 100, widthCm: 100,
  heightCm: 210, sillHeightCm: null, hingeSide: "left", swingDirection: "inward",
};

test("footprint contact with the actual door span is a hard doorway conflict", () => {
  const source = item("doorway", 150, 20, 60, 40);
  const result = validateSpatialPlan(plan([source]), room, [door]);
  assert.deepEqual(result.violations.map((violation) => violation.type), ["DOOR_CONFLICT"]);
  const violation = result.violations[0];
  assert.equal(violation.type, "DOOR_CONFLICT");
  if (violation.type === "DOOR_CONFLICT") assert.deepEqual(violation.details, {
    openingId: "door", wallSegmentId: "wall-1", span: { start: { xCm: 100, yCm: 0 }, end: { xCm: 200, yCm: 0 } },
  });
});

test("touching the wall outside the door span is allowed", () => {
  assert.deepEqual(types([item("clear", 50, 20, 40, 40)], room, [door]), []);
});

test("nearby furniture not touching the opening creates no approach or swing clearance conflict", () => {
  assert.deepEqual(types([item("nearby", 150, 40, 60, 40)], room, [door]), []);
});

test("ordinary windows are not floor obstacles", () => {
  const window: RoomOpening = { ...door, openingType: "window", hingeSide: null, swingDirection: null, sillHeightCm: 0 };
  assert.deepEqual(types([item("window", 150, 20, 60, 40)], room, [window]), []);
});

test("rotated footprint crossing a doorway reports both opening and room violations", () => {
  assert.deepEqual(types([item("rotated", 150, 20, 60, 40, 45)], room, [door]), ["DOOR_CONFLICT", "OUTSIDE_ROOM"]);
});

test("outside and multiple overlaps are reported together with deterministic pair IDs and ordering", () => {
  const items = [item("z", 20, 200), item("a", 40, 200), item("m", 70, 200)];
  const result = validateSpatialPlan(plan(items), room);
  const overlaps = result.violations.filter((violation) => violation.type === "FURNITURE_OVERLAP");
  assert.deepEqual(overlaps.map((violation) => violation.itemIds), [["a", "m"], ["a", "z"], ["m", "z"]]);
  assert.equal(result.violations.filter((violation) => violation.type === "OUTSIDE_ROOM").length, 2);
  assert.equal(new Set(result.violations.map((violation) => violation.id)).size, result.violations.length);
  assert.deepEqual(result.violations.map((violation) => violation.id), result.violations.map((violation) => violation.id).sort());
  for (const order of [[items[2], items[0], items[1]], [...items].reverse()]) {
    assert.deepEqual(validateSpatialPlan(plan(order), room), result);
  }
  for (const violation of result.violations) {
    assert.equal(violation.priority, "P0");
    assert.equal(violation.classification, "hard");
    assert.ok(violation.message.length > 0);
  }
});

test("invalid item is reported and skipped without suppressing unrelated overlaps or containment", () => {
  const invalid = { ...item("invalid"), placement: { ...item("invalid").placement, approximatePosition: null, preferredOrientationDegrees: null } };
  const source = plan([invalid, item("a", 20, 200), item("b", 40, 200)]);
  const snapshot = structuredClone(source);
  const result = validateSpatialPlan(source, room);
  assert.equal(result.valid, false);
  assert.deepEqual(result.violations.map((violation) => violation.type), ["FURNITURE_OVERLAP", "INVALID_FOOTPRINT", "OUTSIDE_ROOM", "OUTSIDE_ROOM"]);
  const failures = result.violations.filter((violation) => violation.itemIds.includes("invalid"));
  assert.equal(failures.length, 1);
  assert.equal(failures[0].type, "INVALID_FOOTPRINT");
  if (failures[0].type === "INVALID_FOOTPRINT") assert.deepEqual(failures[0].details.reasons, ["MISSING_ORIENTATION", "MISSING_POSITION"]);
  assert.deepEqual(source, snapshot);
});

test("opening input order and item order do not change violation identities", () => {
  const otherDoor = { ...door, id: undefined, offsetCm: 300 };
  const items = [item("right", 350, 20, 60, 40), item("left", 150, 20, 60, 40)];
  const openings = [door, otherDoor];
  const snapshot = structuredClone(openings);
  const result = validateSpatialPlan(plan(items), room, openings);
  assert.equal(result.violations.length, 2);
  assert.deepEqual(validateSpatialPlan(plan([...items].reverse()), room, [...openings].reverse()), result);
  assert.deepEqual(openings, snapshot);
});

test("duplicate item IDs fail safely without overwriting items or preventing unrelated overlap detection", () => {
  const items = [item("duplicate"), item("a"), item("duplicate", 300, 300), item("b")];
  const result = validateSpatialPlan(plan(items), room);
  assert.deepEqual(result.violations.map((violation) => violation.type), ["FURNITURE_OVERLAP", "INVALID_FOOTPRINT"]);
  assert.deepEqual(validateSpatialPlan(plan([...items].reverse()), room), result);
  const invalid = result.violations.find((violation) => violation.type === "INVALID_FOOTPRINT");
  assert.deepEqual(invalid?.details, { reasons: ["DUPLICATE_ITEM_ID"], duplicateCount: 2 });
});

test("A.2.3 coincident chairs are detected, not moved, while rug/seating layering stays valid", () => {
  const composition = resolveLivingRoomComposition({ geometry: room, mustHaveItems: ["sofa", "chair", "chair"] });
  const snapshot = structuredClone(composition);
  const firstChair = composition.plan.items.find((item) => item.id === "chairs-1");
  const secondChair = composition.plan.items.find((item) => item.id === "chairs-2");
  assert.ok(firstChair && secondChair);
  assert.deepEqual(firstChair.placement.approximatePosition, { xCm: 90, yCm: 45 });
  assert.deepEqual(secondChair.placement.approximatePosition, firstChair.placement.approximatePosition);
  const result = validateSpatialPlan(composition.plan, room);
  assert.equal(result.valid, false);
  assert.deepEqual(result.violations.map((violation) => [violation.type, violation.itemIds]), [["FURNITURE_OVERLAP", ["chairs-1", "chairs-2"]]]);
  const sofa = composition.plan.items.find((item) => item.semanticPlacement.role === "PRIMARY_SEATING");
  const rug = composition.plan.items.find((item) => item.semanticPlacement.role === "AREA_RUG");
  assert.ok(sofa && rug);
  const sofaFootprint = createFurnitureFootprint(sofa);
  const rugFootprint = createFurnitureFootprint(rug);
  assert.ok(sofaFootprint.valid && rugFootprint.valid);
  assert.ok(rectanglesOverlapWithPositiveArea(sofaFootprint.footprint.corners, rugFootprint.footprint.corners));
  assert.deepEqual(composition, snapshot);
  assert.deepEqual(validateSpatialPlan({ ...composition.plan, items: [...composition.plan.items].reverse() }, room), result);
});

test("explicit AREA_RUG role controls floor layering rather than broad category exceptions", () => {
  const source = item("floor");
  const rug: FurniturePlanItemV11 = {
    ...source, category: "custom_floor_piece",
    semanticPlacement: { role: "AREA_RUG", mode: "FLOATING", alignment: null, zoneId: null, targetWallId: null, relationships: [], fallbackModes: [] },
  };
  const furniture: FurniturePlanItemV11 = { ...rug, id: "seating", category: "rug", semanticPlacement: { ...rug.semanticPlacement, role: "PRIMARY_SEATING" } };
  assert.deepEqual(validateSpatialPlan({ schemaVersion: "1.1", roomIntent: "Layering", items: [rug, furniture], notes: [] }, room), { valid: true, violations: [] });
});

test("invalid authoritative geometry and malformed doors are rejected as validation preconditions", () => {
  assert.throws(() => validateSpatialPlan(plan([]), { ...room, vertices: [] }), /SPATIAL_GEOMETRY_INVALID/);
  assert.throws(() => validateSpatialPlan(plan([]), room, [{ ...door, offsetCm: Infinity }]), /SPATIAL_DOOR_INVALID/);
});

test("door endpoint contact is intersection, but wall contact beyond that endpoint is not", () => {
  assert.deepEqual(types([item("endpoint", 80, 20, 40, 40)], room, [door]), ["DOOR_CONFLICT"]);
  assert.deepEqual(types([item("clear", 79, 20, 40, 40)], room, [door]), []);
});

test("a vertical authoritative door span uses wall direction rather than world X assumptions", () => {
  const verticalDoor = { ...door, wallSegmentId: "wall-2", offsetCm: 100 };
  assert.deepEqual(types([item("vertical", 480, 150, 40, 60)], room, [verticalDoor]), ["DOOR_CONFLICT"]);
});

test("rotated rectangles touching along an oriented edge are not positive-area overlap", () => {
  const first = item("first", 200, 200, 100, 40, 45);
  const second = item("second", 200 - 40 * Math.SQRT1_2, 200 + 40 * Math.SQRT1_2, 100, 40, 45);
  assert.deepEqual(types([first, second]), []);
});

for (const { name, geometry, center, diagonal } of [
  { name: "L", geometry: createLShapeGeometry(600, 500, 250), center: { xCm: 350, yCm: 250 }, diagonal: 200 },
  { name: "T", geometry: createTShapeGeometry(600, 500, 250), center: { xCm: 300, yCm: 140 }, diagonal: 120 },
]) {
  test(`rotated ${name}-shape notch crossing is outside despite every corner being contained`, () => {
    const source = item("bridge", center.xCm, center.yCm, diagonal * Math.SQRT2, diagonal * Math.SQRT2, 45);
    const result = createFurnitureFootprint(source);
    assert.ok(result.valid);
    assert.ok(result.footprint.corners.every((corner) => isPointInsideOrOnPolygon(corner, geometry.vertices)));
    assert.ok(isPointInsideOrOnPolygon(result.footprint.center, geometry.vertices));
    assert.deepEqual(types([source], geometry), ["OUTSIDE_ROOM"]);
  });
}