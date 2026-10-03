import assert from "node:assert/strict";
import test from "node:test";

import { createRectangleGeometry, createLShapeGeometry, createUShapeGeometry } from "@/lib/geometry/templates";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";
import { createFurnitureFootprint } from "./footprints";
import type { FurniturePlanItem } from "./types";
import { deriveFunctionalZones, type FunctionalZone } from "./zones";
import { buildCirculationGrid, evaluateCirculation, isCirculationPointTraversable, isCirculationSegmentTraversable } from "./circulation";
import { validateSpatialPlan } from "./spatial-validator";
import { resolveLivingRoomComposition } from "./role-plan";
import { NORMAL_CIRCULATION_PROFILE } from "./clearance-rules";

const room = createRectangleGeometry(400, 400, 250);
const entrances = [{ id: "door", start: { xCm: 200, yCm: 37.5 }, excludedReason: null }];

function furniture(id: string, xCm: number, yCm: number, width = 100, depth = 100, angle = 0): FurniturePlanItem {
  return {
    id, category: "sofa", subtype: null, priority: "required",
    placement: { preferredZone: null, anchorWallId: null, approximatePosition: { xCm, yCm }, preferredOrientationDegrees: angle },
    sizeRange: { widthMinCm: width, widthMaxCm: width, depthMinCm: depth, depthMaxCm: depth, heightMinCm: 50, heightMaxCm: 100 },
    styleHints: [], materialHints: [], colorHints: [], functionalRequirements: [], reasoning: "Circulation test",
  };
}

function footprint(id: string, xCm: number, yCm: number, width = 100, depth = 100, angle = 0) {
  const result = createFurnitureFootprint(furniture(id, xCm, yCm, width, depth, angle));
  assert.ok(result.valid);
  return result.footprint;
}

test("clearance-aware nodes respect room walls and furniture rather than point occupancy alone", () => {
  assert.equal(isCirculationPointTraversable({ xCm: 200, yCm: 200 }, room, []), true);
  assert.equal(isCirculationPointTraversable({ xCm: 20, yCm: 200 }, room, []), false);
  const obstacle = footprint("sofa", 200, 200);
  assert.equal(isCirculationPointTraversable({ xCm: 260, yCm: 200 }, room, [obstacle]), false);
  assert.equal(isCirculationPointTraversable({ xCm: 290, yCm: 200 }, room, [obstacle]), true);
});

test("open-room grid and fixed-neighbor flood fill are deterministic", () => {
  const grid = buildCirculationGrid(room, []);
  assert.equal(grid.status, "READY");
  if (grid.status === "READY") {
    assert.equal(grid.nodes.length, 1681);
    assert.equal(grid.nodes[0].traversable, false);
    assert.ok(grid.nodes.every((node) => node.point.xCm >= 0 && node.point.xCm <= 400 && node.point.yCm >= 0 && node.point.yCm <= 400));
  }
  assert.deepEqual(buildCirculationGrid(room, []), grid);
  const result = evaluateCirculation(room, deriveFunctionalZones(room), [], entrances);
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.successfulDoorIds, ["door"]);
  assert.deepEqual(evaluateCirculation(room, deriveFunctionalZones(room), [], entrances), result);
});

test("path capsule cannot cross a thin obstacle between free endpoints", () => {
  const obstacle = footprint("thin", 200, 200, 1, 100);
  assert.equal(isCirculationSegmentTraversable({ xCm: 100, yCm: 200 }, { xCm: 300, yCm: 200 }, room, [obstacle]), false);
});

test("narrow furniture-created passage is blocked while a wider passage permits a route", () => {
  const zone = { ...deriveFunctionalZones(room)[0], center: { xCm: 200, yCm: 330 } };
  for (const gap of [70, 90]) {
    const width = (400 - gap) / 2;
    const obstacles = [footprint("left", width / 2, 200, width, 40), footprint("right", 400 - width / 2, 200, width, 40)];
    assert.equal(evaluateCirculation(room, [zone], obstacles, entrances).status, gap < 75 ? "BLOCKED" : "PASS");
  }
});

test("concave bounds are not treated as traversable room space", () => {
  const geometry = createLShapeGeometry(600, 500, 250);
  assert.equal(isCirculationPointTraversable({ xCm: 500, yCm: 100 }, geometry, []), false);
  assert.equal(evaluateCirculation(geometry, deriveFunctionalZones(geometry), [], [{ ...entrances[0], start: { xCm: 100, yCm: 37.5 } }]).status, "PASS");
});

test("grid guard returns unavailable rather than allocating a pathological room", () => {
  const geometry = createRectangleGeometry(100000, 100000, 250);
  assert.equal(buildCirculationGrid(geometry, []).status, "GRID_LIMIT_EXCEEDED");
  const result = evaluateCirculation(geometry, deriveFunctionalZones(geometry), [], entrances);
  assert.equal(result.status, "NOT_EVALUATED");
  assert.equal(result.reason, "GRID_LIMIT_EXCEEDED");
});

const door: RoomOpening = {
  id: "entry", openingType: "door", wallSegmentId: "wall-1", offsetCm: 150, widthCm: 100,
  heightCm: 210, sillHeightCm: null, hingeSide: "left", swingDirection: "inward",
};
const primaryZone = deriveFunctionalZones(room)[0];

function sourcePlan(items: FurniturePlanItem[] = []) {
  return { schemaVersion: "1.0" as const, roomIntent: "Circulation validation", items, notes: [] };
}

function validate(items: FurniturePlanItem[] = [], geometry = room, zones: readonly FunctionalZone[] = [primaryZone], openings: readonly RoomOpening[] = [door]) {
  return validateSpatialPlan(sourcePlan(items), geometry, openings, zones);
}

test("normal-use profile is centralized and makes no legal/accessibility guarantee", () => {
  assert.equal(NORMAL_CIRCULATION_PROFILE.minimumPassageWidthCm, 75);
  assert.equal(NORMAL_CIRCULATION_PROFILE.gridResolutionCm, 10);
  assert.equal(NORMAL_CIRCULATION_PROFILE.maximumGridNodes, 25000);
  assert.equal(NORMAL_CIRCULATION_PROFILE.regulatoryGuarantee, false);
});

test("horizontal door derives an interior start and an open route passes all validity summaries", () => {
  const result = validate();
  assert.equal(result.circulation.status, "PASS");
  assert.deepEqual(result.circulation.doors[0].start, { xCm: 200, yCm: 37.5 });
  assert.ok(result.circulation.doors[0].startCandidateCount > 0);
  assert.ok(result.circulation.targetCandidateCount > 0);
  assert.equal(result.physicallyValid, true);
  assert.equal(result.functionallyValid, true);
  assert.equal(result.valid, true);
  assert.deepEqual(result.violations, []);
});

test("vertical door uses its authoritative inward side", () => {
  const result = validate([], room, [primaryZone], [{ ...door, wallSegmentId: "wall-2" }]);
  assert.equal(result.circulation.status, "PASS");
  assert.deepEqual(result.circulation.doors[0].start, { xCm: 362.5, yCm: 200 });
});

test("reversed wall chain and polygon winding preserve the physical interior start", () => {
  const geometry = {
    ...room,
    vertices: [...room.vertices].reverse(),
    wallSegments: [...room.wallSegments].reverse().map((wall) => ({ ...wall, startVertexId: wall.endVertexId, endVertexId: wall.startVertexId })),
  };
  const result = validate([], geometry, deriveFunctionalZones(geometry));
  assert.equal(result.circulation.status, "PASS");
  assert.deepEqual(result.circulation.doors[0].start, { xCm: 200, yCm: 37.5 });
});

test("narrow source door is not subjected to new door-width certification", () => {
  const result = validate([], room, [primaryZone], [{ ...door, offsetCm: 190, widthCm: 20 }]);
  assert.equal(result.circulation.status, "PASS");
});

test("no doors or windows-only input gives NOT_EVALUATED without invalidating the room", () => {
  const window: RoomOpening = { ...door, openingType: "window", hingeSide: null, swingDirection: null, sillHeightCm: 100 };
  for (const openings of [[], [window]]) {
    const result = validate([], room, [primaryZone], openings);
    assert.equal(result.circulation.status, "NOT_EVALUATED");
    assert.equal(result.circulation.reason, "NO_DOORS");
    assert.deepEqual(result.circulation.evaluatedDoorIds, []);
    assert.equal(result.valid, true);
  }
});

test("missing, invalid, or ambiguous primary-zone semantics do not create a blocked-route claim", () => {
  for (const { zones, reason } of [
    { zones: [], reason: "NO_PRIMARY_ZONE" },
    { zones: [{ ...primaryZone, center: { xCm: -1, yCm: -1 } }], reason: "INVALID_PRIMARY_ZONE" },
    { zones: [primaryZone, primaryZone], reason: "AMBIGUOUS_PRIMARY_ZONE" },
  ]) {
    const result = validate([], room, zones);
    assert.equal(result.circulation.status, "NOT_EVALUATED");
    assert.equal(result.circulation.reason, reason);
    assert.deepEqual(result.violations, []);
    assert.equal(result.valid, true);
  }
});

test("occupied seating-zone center does not require walking through furniture", () => {
  const obstacle = furniture("center-sofa", 200, 200, 50, 50);
  assert.equal(isCirculationPointTraversable(primaryZone.center, room, [footprint("center-sofa", 200, 200, 50, 50)]), false);
  const result = validate([obstacle]);
  assert.equal(result.circulation.status, "PASS");
  assert.ok(result.circulation.targetCandidateCount > 0);
  assert.equal(result.valid, true);
});

test("rug covering the functional area is not a circulation obstacle", () => {
  const rug = { ...furniture("rug", 200, 200, 300, 300), category: "rug" };
  const result = validate([rug]);
  assert.equal(result.circulation.status, "PASS");
  assert.deepEqual(result.circulation, validate().circulation);
  assert.equal(result.valid, true);
});

test("rotated furniture clearance is geometric, not AABB or center occupancy", () => {
  const obstacle = footprint("diagonal", 200, 200, 160, 20, 45);
  assert.equal(isCirculationPointTraversable({ xCm: 200 - 40 * Math.SQRT1_2, yCm: 200 + 40 * Math.SQRT1_2 }, room, [obstacle]), false);
  assert.equal(isCirculationPointTraversable({ xCm: 200 - 60 * Math.SQRT1_2, yCm: 200 + 60 * Math.SQRT1_2 }, room, [obstacle]), true);
  assert.equal(validate([furniture("diagonal", 200, 200, 160, 20, 45)]).circulation.status, "PASS");
});

test("a route around furniture succeeds even when a direct center-to-target line is blocked", () => {
  const zone = { ...primaryZone, center: { xCm: 200, yCm: 330 } };
  const obstacle = footprint("obstacle", 200, 190, 120, 40);
  assert.equal(isCirculationSegmentTraversable(entrances[0].start, zone.center, room, [obstacle]), false);
  const result = validate([furniture("obstacle", 200, 190, 120, 40)], room, [zone]);
  assert.equal(result.circulation.status, "PASS");
  assert.equal(result.valid, true);
});

test("a wall-to-wall furniture barrier is physically valid but creates a hard P1 circulation failure", () => {
  const zone = { ...primaryZone, center: { xCm: 200, yCm: 330 } };
  const result = validate([furniture("barrier", 200, 200, 400, 40)], room, [zone]);
  assert.equal(result.circulation.status, "BLOCKED");
  assert.equal(result.physicallyValid, true);
  assert.equal(result.functionallyValid, false);
  assert.equal(result.valid, false);
  assert.equal(result.violations.length, 1);
  const violation = result.violations[0];
  assert.equal(violation.type, "BLOCKED_CIRCULATION");
  assert.equal(violation.priority, "P1");
  assert.equal(violation.classification, "hard");
  if (violation.type === "BLOCKED_CIRCULATION") {
    assert.equal(violation.details.profileId, NORMAL_CIRCULATION_PROFILE.id);
    assert.equal(violation.details.targetZoneId, zone.id);
    assert.equal(violation.details.minimumPassageWidthCm, 75);
    assert.deepEqual(violation.details.evaluatedDoorIds, result.circulation.evaluatedDoorIds);
  }
});

test("non-overlapping furniture creates a sub-profile bottleneck without a physical overlap", () => {
  const zone = { ...primaryZone, center: { xCm: 200, yCm: 330 } };
  const result = validate([furniture("left", 80, 200, 160, 40), furniture("right", 315, 200, 170, 40)], room, [zone]);
  assert.equal(result.physicallyValid, true);
  assert.equal(result.circulation.status, "BLOCKED");
  assert.deepEqual(result.violations.map((violation) => violation.type), ["BLOCKED_CIRCULATION"]);
});

function bottleneckGeometry(gap: number): RoomGeometry {
  const low = 200 - gap / 2;
  const high = 200 + gap / 2;
  const coordinates = [[0, 0], [400, 0], [400, low], [600, low], [600, 0], [1000, 0], [1000, 400], [600, 400], [600, high], [400, high], [400, 400], [0, 400]];
  const vertices = coordinates.map(([xCm, yCm], index) => ({ id: `v${index}`, xCm, yCm }));
  return { ...room, vertices, wallSegments: vertices.map((vertex, index) => ({ id: `wall-${index + 1}`, startVertexId: vertex.id, endVertexId: vertices[(index + 1) % vertices.length].id })) };
}

for (const gap of [60, 100]) {
  test(`concave connected rooms with ${gap} cm neck are judged by boundary clearance`, () => {
    const geometry = bottleneckGeometry(gap);
    const zone = { ...deriveFunctionalZones(geometry)[0], center: { xCm: 800, yCm: 200 } };
    const result = validate([], geometry, [zone]);
    assert.equal(result.physicallyValid, true);
    assert.equal(result.circulation.status, gap < 75 ? "BLOCKED" : "PASS");
    assert.equal(result.valid, gap >= 75);
  });
}

test("U-shaped room routes around its exterior recess", () => {
  const geometry = createUShapeGeometry(600, 500, 250);
  const zone = { ...deriveFunctionalZones(geometry)[0], center: { xCm: 500, yCm: 350 } };
  const result = validate([], geometry, [zone], [{ ...door, offsetCm: 50 }]);
  assert.equal(result.circulation.status, "PASS");
  assert.equal(result.valid, true);
});

test("P0-blocked entrance is excluded without redundant blocked-circulation noise", () => {
  const result = validate([furniture("blocker", 200, 20, 60, 40)]);
  assert.equal(result.circulation.status, "NOT_EVALUATED");
  assert.equal(result.circulation.reason, "ALL_DOORS_EXCLUDED");
  assert.equal(result.circulation.excludedDoors[0].reason, "PHYSICAL_DOOR_CONFLICT");
  assert.deepEqual(result.violations.map((violation) => violation.type), ["DOOR_CONFLICT"]);
});

test("P1 approach obstruction excludes the entrance and keeps its existing local rule authoritative", () => {
  const result = validate([furniture("approach", 200, 50, 60, 20)]);
  assert.equal(result.circulation.status, "NOT_EVALUATED");
  assert.equal(result.circulation.reason, "ALL_DOORS_EXCLUDED");
  assert.equal(result.circulation.excludedDoors[0].reason, "DOOR_APPROACH_OBSTRUCTION");
  assert.deepEqual(result.violations.map((violation) => violation.type), ["INSUFFICIENT_FUNCTIONAL_CLEARANCE"]);
  assert.equal(result.physicallyValid, true);
  assert.equal(result.valid, false);
});

test("one physically blocked door and one successful door passes circulation only", () => {
  const secondary = { ...door, id: "secondary", wallSegmentId: "wall-3" };
  const result = validate([furniture("blocker", 200, 20, 60, 40)], room, [primaryZone], [door, secondary]);
  assert.equal(result.circulation.status, "PASS");
  assert.equal(result.circulation.successfulDoorIds.length, 1);
  assert.equal(result.circulation.excludedDoors.length, 1);
  assert.equal(result.physicallyValid, false);
  assert.equal(result.valid, false);
});

test("multiple unblocked doors can have distinct route outcomes with deterministic ordering", () => {
  const zone = { ...primaryZone, center: { xCm: 200, yCm: 330 } };
  const openings = [door, { ...door, id: "secondary", wallSegmentId: "wall-3" }];
  const items = [furniture("barrier", 200, 200, 400, 40)];
  const result = validate(items, room, [zone], openings);
  assert.equal(result.circulation.status, "PASS");
  assert.deepEqual(result.circulation.doors.map((entry) => entry.status), ["UNREACHABLE", "REACHABLE"]);
  assert.equal(result.circulation.evaluatedDoorIds.length, 2);
  assert.equal(result.valid, true);
  assert.deepEqual(validate(items, room, [zone], [...openings].reverse()), result);
});

test("invalid footprint prevents certification without fabricating its circulation geometry", () => {
  const invalid = { ...furniture("invalid", 200, 200), placement: { ...furniture("invalid", 200, 200).placement, approximatePosition: null } };
  const result = validate([invalid]);
  assert.equal(result.circulation.status, "NOT_EVALUATED");
  assert.equal(result.circulation.reason, "INVALID_FOOTPRINTS");
  assert.deepEqual(result.violations.map((violation) => violation.type), ["INVALID_FOOTPRINT"]);
});

test("integrated grid limit is explicit unavailable rather than silently passing circulation", () => {
  const geometry = createRectangleGeometry(100000, 100000, 250);
  const result = validate([], geometry, deriveFunctionalZones(geometry));
  assert.equal(result.circulation.status, "NOT_EVALUATED");
  assert.equal(result.circulation.reason, "GRID_LIMIT_EXCEEDED");
  assert.deepEqual(result.violations, []);
});

test("grid, targets, BFS results, violation IDs and inputs are invariant under furniture permutation", () => {
  const items = [furniture("left", 80, 200, 160, 40), furniture("right", 315, 200, 170, 40)];
  const zones = [{ ...primaryZone, center: { xCm: 200, yCm: 330 } }];
  const openings = [door];
  const plan = sourcePlan(items);
  const snapshot = structuredClone({ plan, room, zones, openings });
  const result = validateSpatialPlan(plan, room, openings, zones);
  assert.deepEqual(validateSpatialPlan(plan, room, openings, zones), result);
  assert.deepEqual(validateSpatialPlan({ ...plan, items: [...items].reverse() }, room, [...openings].reverse(), zones), result);
  const obstacles = items.map((item) => {
    const built = createFurnitureFootprint(item);
    assert.ok(built.valid);
    return built.footprint;
  });
  assert.deepEqual(buildCirculationGrid(room, obstacles), buildCirculationGrid(room, [...obstacles].reverse()));
  assert.deepEqual({ plan, room, zones, openings }, snapshot);
});

test("mixed physical and circulation failures retain stable priority and identity ordering", () => {
  const items = [furniture("barrier", 200, 200, 400, 40), furniture("outside", 20, 320, 60, 40)];
  const result = validate(items, room, [{ ...primaryZone, center: { xCm: 200, yCm: 330 } }]);
  assert.equal(result.circulation.status, "BLOCKED");
  assert.deepEqual(result.violations.map((violation) => [violation.type, violation.priority]), [["OUTSIDE_ROOM", "P0"], ["BLOCKED_CIRCULATION", "P1"]]);
  assert.deepEqual(validate([...items].reverse(), room, [{ ...primaryZone, center: { xCm: 200, yCm: 330 } }]), result);
});

test("A.2.3 coincident chairs, rug layering, and local coffee spacing remain independent of circulation", () => {
  const geometry = createRectangleGeometry(500, 400, 250);
  const opening = { ...door, offsetCm: 350 };
  const composition = resolveLivingRoomComposition({ geometry, mustHaveItems: ["sofa", "chair", "chair"] }, [opening]);
  const snapshot = structuredClone(composition);
  const result = validateSpatialPlan(composition.plan, geometry, [opening], composition.zones);
  assert.equal(result.circulation.status, "PASS");
  assert.ok(result.violations.some((violation) => violation.type === "FURNITURE_OVERLAP" && violation.itemIds.includes("chairs-1") && violation.itemIds.includes("chairs-2")));
  assert.ok(result.violations.every((violation) => !violation.itemIds.includes("area-rug-1")));
  const closer = structuredClone(composition.plan);
  const table = closer.items.find((item) => item.id === "coffee-table-1");
  assert.ok(table?.placement.approximatePosition);
  table.placement.approximatePosition.yCm -= 10;
  const modifiedSnapshot = structuredClone(closer);
  const checked = validateSpatialPlan(closer, geometry, [opening], composition.zones);
  assert.equal(checked.circulation.status, "PASS");
  assert.ok(checked.violations.some((violation) => violation.type === "INSUFFICIENT_FUNCTIONAL_CLEARANCE" && violation.details.context === "SEATING_COFFEE_TABLE"));
  assert.deepEqual(closer, modifiedSnapshot);
  assert.deepEqual(composition, snapshot);
});