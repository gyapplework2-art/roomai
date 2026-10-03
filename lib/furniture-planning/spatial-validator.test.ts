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
import { doorApproachClearanceRule, seatingCoffeeTableClearanceRule, NORMAL_CIRCULATION_PROFILE } from "./clearance-rules";
import type { CirculationEvaluation } from "./circulation";
import { compareSpatialViolations } from "./spatial-validation-report";

const room = createRectangleGeometry(500, 400, 250);
const noDoorReportFields = {
  schemaVersion: "1.0", status: "NOT_FULLY_EVALUATED",
  summary: { totalViolations: 0, p0Count: 0, p1Count: 0, p2Count: 0, p3Count: 0, hardCount: 0, softCount: 0 },
  evaluation: { footprintsEvaluated: true, physicalEvaluated: true, physicalDoorConflictEvaluated: false, functionalClearanceEvaluated: false, circulationEvaluated: false },
};
const unavailableCirculation: CirculationEvaluation = {
  status: "NOT_EVALUATED", reason: "NO_DOORS", profileId: NORMAL_CIRCULATION_PROFILE.id,
  minimumPassageWidthCm: 75, targetZoneId: null, evaluatedDoorIds: [], successfulDoorIds: [],
  excludedDoors: [], doors: [], gridNodeCount: 0, targetCandidateCount: 0,
};

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
  assert.deepEqual(validateSpatialPlan(source, room), { ...noDoorReportFields, valid: true, physicallyValid: true, functionallyValid: true, violations: [], circulation: unavailableCirculation });
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

test("nearby furniture has no physical door conflict but occupies the A.3.2 approach region", () => {
  const result = validateSpatialPlan(plan([item("nearby", 150, 40, 60, 40)]), room, [door]);
  assert.deepEqual(result.violations.map((violation) => violation.type), ["INSUFFICIENT_FUNCTIONAL_CLEARANCE"]);
  assert.equal(result.violations[0].priority, "P1");
  assert.equal(result.physicallyValid, true);
  assert.equal(result.functionallyValid, false);
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
  assert.deepEqual(result.violations, [...result.violations].sort(compareSpatialViolations));
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
  assert.deepEqual(validateSpatialPlan({ schemaVersion: "1.1", roomIntent: "Layering", items: [rug, furniture], notes: [] }, room), { ...noDoorReportFields, valid: true, physicallyValid: true, functionallyValid: true, violations: [], circulation: unavailableCirculation });
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

function semanticItem(
  source: FurniturePlanItem,
  role: FurniturePlanItemV11["semanticPlacement"]["role"],
  relationships: FurniturePlanItemV11["semanticPlacement"]["relationships"] = [],
): FurniturePlanItemV11 {
  return { ...source, semanticPlacement: {
    role, mode: "FLOATING", alignment: null, zoneId: null, targetWallId: null, relationships, fallbackModes: [],
  } };
}

function relatedTableItems(gap: number): FurniturePlanItemV11[] {
  return [
    semanticItem(item("seating", 200, 100, 100, 100), "PRIMARY_SEATING"),
    semanticItem(item("table", 200, 170 + gap, 100, 40), "COFFEE_TABLE", [{ type: "IN_FRONT_OF", targetItemId: "seating" }]),
  ];
}

function functionalPlan(items: FurniturePlanItemV11[]) {
  return { schemaVersion: "1.1" as const, roomIntent: "Functional validation", items, notes: [] };
}

test("initial clearance defaults are explicit hard P1 planning rules, not regulatory claims", () => {
  assert.equal(seatingCoffeeTableClearanceRule.minimumCm, 35);
  assert.deepEqual(seatingCoffeeTableClearanceRule.preferredRangeCm, [35, 50]);
  assert.equal(doorApproachClearanceRule.minimumCm, 75);
  for (const rule of [seatingCoffeeTableClearanceRule, doorApproachClearanceRule]) {
    assert.equal(rule.priority, "P1");
    assert.equal(rule.classification, "hard");
    assert.equal(rule.regulatoryGuarantee, false);
  }
});

for (const gap of [40, 35, 100]) {
  test(`explicit seating/coffee-table boundary gap ${gap} cm passes minimum-only validation`, () => {
    assert.deepEqual(validateSpatialPlan(functionalPlan(relatedTableItems(gap)), room), {
      ...noDoorReportFields,
      evaluation: { ...noDoorReportFields.evaluation, functionalClearanceEvaluated: true },
      valid: true, physicallyValid: true, functionallyValid: true, violations: [],
      circulation: unavailableCirculation,
    });
  });
}

test("34.9 cm related coffee-table gap creates a structured P1-only violation", () => {
  const result = validateSpatialPlan(functionalPlan(relatedTableItems(34.9)), room);
  assert.equal(result.valid, false);
  assert.equal(result.physicallyValid, true);
  assert.equal(result.functionallyValid, false);
  assert.equal(result.violations.length, 1);
  const violation = result.violations[0];
  assert.equal(violation.type, "INSUFFICIENT_FUNCTIONAL_CLEARANCE");
  assert.equal(violation.priority, "P1");
  assert.equal(violation.classification, "hard");
  assert.deepEqual(violation.itemIds, ["seating", "table"]);
  if (violation.type === "INSUFFICIENT_FUNCTIONAL_CLEARANCE") {
    assert.equal(violation.details.context, "SEATING_COFFEE_TABLE");
    assert.equal(violation.details.ruleId, seatingCoffeeTableClearanceRule.id);
    assert.equal(violation.details.requiredMinimumCm, 35);
    assert.ok(Math.abs(violation.details.measuredClearanceCm - 34.9) < 1e-12);
    if (violation.details.context === "SEATING_COFFEE_TABLE") assert.deepEqual(violation.details.relationship, {
      type: "IN_FRONT_OF", sourceItemId: "table", targetItemId: "seating",
    });
  }
});

test("physical seating/table overlap suppresses only the same pair's redundant P1", () => {
  const result = validateSpatialPlan(functionalPlan(relatedTableItems(-10)), room);
  assert.deepEqual(result.violations.map((violation) => [violation.type, violation.priority]), [["FURNITURE_OVERLAP", "P0"]]);
  assert.equal(result.physicallyValid, false);
  assert.equal(result.functionallyValid, true);
  assert.equal(result.valid, false);
});

test("edge touching is physically valid but fails explicit coffee-table functional spacing", () => {
  const result = validateSpatialPlan(functionalPlan(relatedTableItems(0)), room);
  assert.equal(result.physicallyValid, true);
  assert.deepEqual(result.violations.map((violation) => violation.type), ["INSUFFICIENT_FUNCTIONAL_CLEARANCE"]);
  const violation = result.violations[0];
  if (violation.type === "INSUFFICIENT_FUNCTIONAL_CLEARANCE") assert.equal(violation.details.measuredClearanceCm, 0);
});

for (const relationship of [null, "FACES", "ADJACENT_TO"] as const) {
  test(`${relationship ?? "unrelated"} coffee-table placement is not an implicit minimum-gap rule`, () => {
    const items = relatedTableItems(10);
    items[1] = { ...items[1], semanticPlacement: { ...items[1].semanticPlacement, relationships: relationship ? [{ type: relationship, targetItemId: "seating" }] : [] } };
    assert.equal(validateSpatialPlan(functionalPlan(items), room).valid, true);
  });
}

test("only explicitly associated seating is checked, not every nearby chair", () => {
  const items = relatedTableItems(40);
  items.push(semanticItem(item("unrelated-chair", 100, 200, 50, 40), "SECONDARY_SEATING"));
  assert.equal(validateSpatialPlan(functionalPlan(items), room).valid, true);
});

test("rotated related footprints use true boundary distance and preserve stable semantic IDs", () => {
  const seating = semanticItem(item("stable-seat", 200, 200, 100, 40, 45), "SECONDARY_SEATING");
  const table = semanticItem(item("stable-table", 200 - 74.9 * Math.SQRT1_2, 200 + 74.9 * Math.SQRT1_2, 100, 40, 45), "COFFEE_TABLE", [{ type: "IN_FRONT_OF", targetItemId: seating.id }]);
  const result = validateSpatialPlan(functionalPlan([table, seating]), room);
  assert.equal(result.physicallyValid, true);
  assert.equal(result.violations.length, 1);
  const violation = result.violations[0];
  assert.deepEqual(violation.itemIds, [seating.id, table.id]);
  assert.equal(violation.type, "INSUFFICIENT_FUNCTIONAL_CLEARANCE");
  if (violation.type === "INSUFFICIENT_FUNCTIONAL_CLEARANCE") assert.ok(Math.abs(violation.details.measuredClearanceCm - 34.9) < 1e-12);
});

test("duplicate relationship declarations do not duplicate functional diagnostics", () => {
  const items = relatedTableItems(10);
  items[1].semanticPlacement.relationships.push({ type: "IN_FRONT_OF", targetItemId: "seating" });
  assert.equal(validateSpatialPlan(functionalPlan(items), room).violations.length, 1);
});

test("missing/invalid relationship targets are skipped without fabricating geometry", () => {
  const items = relatedTableItems(10);
  const seating = { ...items[0], placement: { ...items[0].placement, approximatePosition: null } };
  const result = validateSpatialPlan(functionalPlan([seating, items[1]]), room);
  assert.deepEqual(result.violations.map((violation) => violation.type), ["INVALID_FOOTPRINT"]);
  assert.equal(validateSpatialPlan(functionalPlan([items[1]]), room).violations.length, 0);
});

test("floor rugs receive neither furniture relationship-clearance nor door-approach violations", () => {
  const items = relatedTableItems(10);
  items[0] = { ...items[0], semanticPlacement: { ...items[0].semanticPlacement, role: "AREA_RUG" } };
  assert.equal(validateSpatialPlan(functionalPlan(items), room).valid, true);
  const rug = semanticItem(item("rug", 150, 50, 40, 20), "AREA_RUG");
  assert.equal(validateSpatialPlan(functionalPlan([rug]), room, [door]).valid, true);
});

for (const { centerY, expected } of [{ centerY: 50, expected: false }, { centerY: 85, expected: true }, { centerY: 85.1, expected: true }]) {
  test(`horizontal door approach with nearest footprint depth ${centerY - 10} cm`, () => {
    const result = validateSpatialPlan(plan([item("obstacle", 150, centerY, 40, 20)]), room, [door]);
    assert.equal(result.physicallyValid, true);
    assert.equal(result.valid, expected);
    assert.equal(result.functionallyValid, expected);
    assert.deepEqual(result.violations.map((violation) => violation.type), expected ? [] : ["INSUFFICIENT_FUNCTIONAL_CLEARANCE"]);
    const violation = result.violations[0];
    if (violation?.type === "INSUFFICIENT_FUNCTIONAL_CLEARANCE") {
      assert.equal(violation.details.ruleId, doorApproachClearanceRule.id);
      assert.equal(violation.details.requiredMinimumCm, 75);
      assert.equal(violation.details.measuredClearanceCm, 40);
      if (violation.details.context === "DOOR_APPROACH") assert.deepEqual(violation.details.approachPolygon, [
        { xCm: 100, yCm: 0 }, { xCm: 200, yCm: 0 }, { xCm: 200, yCm: 75 }, { xCm: 100, yCm: 75 },
      ]);
    }
  });
}

test("door approach has physical opening width without lateral padding", () => {
  assert.equal(validateSpatialPlan(plan([item("beside", 70, 50, 40, 20)]), room, [door]).valid, true);
});

test("vertical door approach works and boundary-only contact is allowed", () => {
  const opening = { ...door, wallSegmentId: "wall-2" };
  const blocked = validateSpatialPlan(plan([item("vertical", 480, 150, 20, 20)]), room, [opening]);
  assert.equal(blocked.physicallyValid, true);
  assert.deepEqual(blocked.violations.map((violation) => violation.type), ["INSUFFICIENT_FUNCTIONAL_CLEARANCE"]);
  assert.equal(validateSpatialPlan(plan([item("clear", 415, 150, 20, 20)]), room, [opening]).valid, true);
});

test("rotated authoritative wall and door construct the approach inward without assuming winding", () => {
  const diagonal = Math.SQRT1_2;
  const geometry: RoomGeometry = { ...room, vertices: room.vertices.map((vertex) => ({
    ...vertex, xCm: 300 + (vertex.xCm - vertex.yCm) * diagonal, yCm: 300 + (vertex.xCm + vertex.yCm) * diagonal,
  })) };
  const obstacle = item("rotated", 300 + (150 - 50) * diagonal, 300 + (150 + 50) * diagonal, 40, 20, 45);
  const result = validateSpatialPlan(plan([obstacle]), geometry, [door]);
  assert.equal(result.physicallyValid, true);
  assert.deepEqual(result.violations.map((violation) => violation.type), ["INSUFFICIENT_FUNCTIONAL_CLEARANCE"]);
  const violation = result.violations[0];
  if (violation.type === "INSUFFICIENT_FUNCTIONAL_CLEARANCE") assert.ok(Math.abs(violation.details.measuredClearanceCm - 40) < 1e-12);
  assert.deepEqual(validateSpatialPlan(plan([obstacle]), { ...geometry, vertices: [...geometry.vertices].reverse() }, [door]), result);
});

test("physical door conflict remains P0 and suppresses the exact same door's redundant P1", () => {
  const result = validateSpatialPlan(plan([item("blocker", 150, 20, 40, 40)]), room, [door]);
  assert.deepEqual(result.violations.map((violation) => [violation.type, violation.priority]), [["DOOR_CONFLICT", "P0"]]);
  assert.equal(result.physicallyValid, false);
  assert.equal(result.valid, false);
});

test("window spans create neither physical doorway nor functional approach regions", () => {
  const window: RoomOpening = { ...door, openingType: "window", hingeSide: null, swingDirection: null, sillHeightCm: 0 };
  assert.equal(validateSpatialPlan(plan([item("near-window", 150, 50, 40, 20)]), room, [window]).valid, true);
});

test("no generic use-side or wall clearance is inferred from AGAINST_WALL", () => {
  const furniture = semanticItem(item("wall-item", 50, 200, 100, 100), "PRIMARY_SEATING");
  furniture.semanticPlacement.mode = "AGAINST_WALL";
  furniture.semanticPlacement.targetWallId = "wall-4";
  assert.equal(validateSpatialPlan(functionalPlan([furniture]), room).valid, true);
});

test("mixed P0/P1 violations retain stable IDs/order, exact inputs and validity summaries", () => {
  const items = [...relatedTableItems(34.9), semanticItem(item("outside", 20, 300), "STORAGE")];
  const source = functionalPlan(items);
  const snapshot = structuredClone(source);
  const result = validateSpatialPlan(source, room);
  assert.deepEqual(result.violations.map((violation) => [violation.type, violation.priority]), [["OUTSIDE_ROOM", "P0"], ["INSUFFICIENT_FUNCTIONAL_CLEARANCE", "P1"]]);
  assert.equal(result.valid, false);
  assert.equal(result.physicallyValid, false);
  assert.equal(result.functionallyValid, false);
  assert.deepEqual(validateSpatialPlan(source, room), result);
  assert.deepEqual(validateSpatialPlan({ ...source, items: [...source.items].reverse() }, room), result);
  assert.deepEqual(result.violations, [...result.violations].sort(compareSpatialViolations));
  assert.deepEqual(source, snapshot);
});

test("unrelated P0 overlap does not suppress a coffee-table clearance violation", () => {
  const items = [...relatedTableItems(10), semanticItem(item("other-a", 400, 300, 40, 40), "STORAGE"), semanticItem(item("other-b", 400, 300, 40, 40), "STORAGE")];
  const result = validateSpatialPlan(functionalPlan(items), room);
  assert.deepEqual(result.violations.map((violation) => violation.type), ["FURNITURE_OVERLAP", "INSUFFICIENT_FUNCTIONAL_CLEARANCE"]);
});

test("door approach ordering and identities are stable across door and item permutations", () => {
  const openings = [door, { ...door, id: "other-door", offsetCm: 300 }];
  const items = [item("left", 150, 50, 40, 20), item("right", 350, 50, 40, 20)];
  const snapshot = structuredClone([openings, items]);
  const result = validateSpatialPlan(plan(items), room, openings);
  assert.equal(result.violations.length, 2);
  assert.equal(new Set(result.violations.map((violation) => violation.id)).size, 2);
  assert.ok(result.violations.every((violation) => violation.priority === "P1"));
  assert.deepEqual(validateSpatialPlan(plan([...items].reverse()), room, [...openings].reverse()), result);
  assert.deepEqual([openings, items], snapshot);
});

test("A.2.3 chairs remain a P0 overlap and coffee-table semantic spacing is checked without repairs", () => {
  const composition = resolveLivingRoomComposition({ geometry: room, mustHaveItems: ["sofa", "chair", "chair"] });
  const snapshot = structuredClone(composition);
  const result = validateSpatialPlan(composition.plan, room);
  assert.deepEqual(result.violations.map((violation) => [violation.type, violation.itemIds]), [["FURNITURE_OVERLAP", ["chairs-1", "chairs-2"]]]);
  assert.equal(result.functionallyValid, true);
  const table = composition.plan.items.find((entry) => entry.semanticPlacement.role === "COFFEE_TABLE");
  assert.ok(table?.placement.approximatePosition);
  const modified = structuredClone(composition.plan);
  const closer = modified.items.find((entry) => entry.id === table.id);
  assert.ok(closer?.placement.approximatePosition);
  closer.placement.approximatePosition.yCm -= 10;
  const closerSnapshot = structuredClone(modified);
  const failures = validateSpatialPlan(modified, room);
  assert.equal(failures.violations.filter((violation) => violation.type === "INSUFFICIENT_FUNCTIONAL_CLEARANCE").length, 1);
  assert.ok(failures.violations.every((violation) => !violation.itemIds.includes("area-rug-1")));
  assert.deepEqual(composition, snapshot);
  assert.deepEqual(modified, closerSnapshot);
});