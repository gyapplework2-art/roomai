import assert from "node:assert/strict";
import test from "node:test";

import { createRectangleGeometry, createLShapeGeometry } from "@/lib/geometry/templates";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";
import { deriveFunctionalZones, type FunctionalZone } from "./zones";
import type { FurniturePlanItemV11, FurniturePlanV11 } from "./types";
import { validateSpatialPlan, type SpatialViolation } from "./spatial-validator";
import { compareSpatialViolations, type WholeRoomValidationReport, type ValidationPriority } from "./spatial-validation-report";
import { resolveLivingRoomComposition } from "./role-plan";
import { doorApproachClearanceRule, seatingCoffeeTableClearanceRule, NORMAL_CIRCULATION_PROFILE } from "./clearance-rules";

const room = createRectangleGeometry(600, 500, 250);
const zones = deriveFunctionalZones(room);
const door: RoomOpening = {
  id: "entry", openingType: "door", wallSegmentId: "wall-1", offsetCm: 400, widthCm: 100,
  heightCm: 210, sillHeightCm: null, hingeSide: "left", swingDirection: "inward",
};

function furniture(id: string, role: FurniturePlanItemV11["semanticPlacement"]["role"], xCm: number, yCm: number, width: number, depth: number): FurniturePlanItemV11 {
  return {
    id, category: role === "AREA_RUG" ? "rug" : role === "COFFEE_TABLE" ? "coffee_table" : "sofa",
    subtype: null, priority: "required",
    placement: { preferredZone: zones[0].id, anchorWallId: null, approximatePosition: { xCm, yCm }, preferredOrientationDegrees: 0 },
    semanticPlacement: { role, mode: "FLOATING", alignment: null, zoneId: zones[0].id, targetWallId: null, relationships: [], fallbackModes: [] },
    sizeRange: { widthMinCm: width, widthMaxCm: width, depthMinCm: depth, depthMaxCm: depth, heightMinCm: 1, heightMaxCm: 100 },
    styleHints: [], materialHints: [], colorHints: [], functionalRequirements: [], reasoning: "Canonical runtime scenario",
  };
}

function livingRoom(): FurniturePlanV11 {
  const table = furniture("table", "COFFEE_TABLE", 260, 200, 100, 60);
  table.semanticPlacement.relationships = [{ type: "IN_FRONT_OF", targetItemId: "sofa" }];
  return {
    schemaVersion: "1.1", roomIntent: "Canonical living room", notes: [],
    items: [furniture("sofa", "PRIMARY_SEATING", 260, 85, 200, 90), table, furniture("rug", "AREA_RUG", 260, 190, 260, 260)],
  };
}

test("A: spatially clean living room reports complete VALID evaluation and zero violations", () => {
  const report = validateSpatialPlan(livingRoom(), room, [door], zones);
  assert.equal(report.schemaVersion, "1.0");
  assert.equal(report.status, "VALID");
  assert.equal(report.valid, true);
  assert.equal(report.physicallyValid, true);
  assert.equal(report.functionallyValid, true);
  assert.equal(report.circulation.status, "PASS");
  assert.deepEqual(report.violations, []);
  assert.deepEqual(report.summary, { totalViolations: 0, p0Count: 0, p1Count: 0, p2Count: 0, p3Count: 0, hardCount: 0, softCount: 0 });
  assert.ok(Object.values(report.evaluation).every(Boolean));
});

test("G: missing circulation prerequisites are incomplete, not a fabricated pass or hard failure", () => {
  for (const { openings, suppliedZones, reason } of [
    { openings: [], suppliedZones: zones, reason: "NO_DOORS" },
    { openings: [door], suppliedZones: [], reason: "NO_PRIMARY_ZONE" },
  ]) {
    const report = validateSpatialPlan(livingRoom(), room, openings, suppliedZones);
    assert.equal(report.valid, true);
    assert.equal(report.status, "NOT_FULLY_EVALUATED");
    assert.equal(report.circulation.status, "NOT_EVALUATED");
    assert.equal(report.circulation.reason, reason);
    assert.equal(report.evaluation.circulationEvaluated, false);
    assert.equal(report.evaluation.physicalDoorConflictEvaluated, openings.length > 0);
    assert.deepEqual(report.violations, []);
  }
});

type ScenarioInput = { plan: FurniturePlanV11; geometry: RoomGeometry; openings: RoomOpening[]; zones: FunctionalZone[] };

function scenarioInput(plan = livingRoom()): ScenarioInput {
  return { plan, geometry: structuredClone(room), openings: [structuredClone(door)], zones: structuredClone(zones) };
}

function simplePlan(items: FurniturePlanItemV11[]): FurniturePlanV11 {
  return { schemaVersion: "1.1", roomIntent: "Canonical scenario", items, notes: [] };
}

const scenarios: Array<{
  name: string;
  build: () => ScenarioInput;
  status: WholeRoomValidationReport["status"];
  physical: boolean;
  functional: boolean;
  violations: SpatialViolation["type"][];
}> = [
  { name: "A clean living room", build: () => scenarioInput(), status: "VALID", physical: true, functional: true, violations: [] },
  {
    name: "B physical furniture overlap", status: "INVALID", physical: false, functional: true, violations: ["FURNITURE_OVERLAP"],
    build: () => scenarioInput(simplePlan([
      furniture("overlap-a", "STORAGE", 120, 300, 80, 80), furniture("overlap-b", "STORAGE", 150, 300, 80, 80),
    ])),
  },
  {
    name: "C complete footprint outside room", status: "INVALID", physical: false, functional: true, violations: ["OUTSIDE_ROOM"],
    build: () => scenarioInput(simplePlan([furniture("outside", "STORAGE", 20, 400, 80, 80)])),
  },
  {
    name: "D physical doorway obstruction", status: "INVALID", physical: false, functional: true, violations: ["DOOR_CONFLICT"],
    build: () => scenarioInput(simplePlan([furniture("door-blocker", "STORAGE", 450, 20, 60, 40)])),
  },
  {
    name: "E minimum coffee-table functional clearance", status: "INVALID", physical: true, functional: false, violations: ["INSUFFICIENT_FUNCTIONAL_CLEARANCE"],
    build: () => {
      const plan = livingRoom();
      const table = plan.items.find((item) => item.id === "table");
      assert.ok(table?.placement.approximatePosition);
      table.placement.approximatePosition.yCm = 194.9;
      return scenarioInput(plan);
    },
  },
  {
    name: "F physically valid circulation barrier", status: "INVALID", physical: true, functional: false, violations: ["BLOCKED_CIRCULATION"],
    build: () => {
      const input = scenarioInput(simplePlan([furniture("barrier", "STORAGE", 300, 200, 600, 40)]));
      input.zones[0].center = { xCm: 300, yCm: 400 };
      return input;
    },
  },
  {
    name: "G unavailable circulation inputs", status: "NOT_FULLY_EVALUATED", physical: true, functional: true, violations: [],
    build: () => ({ ...scenarioInput(), zones: [] }),
  },
  {
    name: "H independent physical and functional failures", status: "INVALID", physical: false, functional: false,
    violations: ["FURNITURE_OVERLAP", "OUTSIDE_ROOM", "INSUFFICIENT_FUNCTIONAL_CLEARANCE"],
    build: () => {
      const plan = livingRoom();
      const table = plan.items.find((item) => item.id === "table");
      assert.ok(table?.placement.approximatePosition);
      table.placement.approximatePosition.yCm = 194.9;
      plan.items.push(furniture("outside", "STORAGE", 20, 430, 60, 60),
        furniture("overlap-a", "STORAGE", 100, 340, 50, 50), furniture("overlap-b", "STORAGE", 110, 340, 50, 50));
      return scenarioInput(plan);
    },
  },
  {
    name: "I real A.2.3 coincident-chair regression", status: "INVALID", physical: false, functional: true, violations: ["FURNITURE_OVERLAP", "OUTSIDE_ROOM", "OUTSIDE_ROOM"],
    build: () => {
      const geometry = createRectangleGeometry(500, 400, 250);
      const opening = { ...door, offsetCm: 350 };
      const composed = resolveLivingRoomComposition({ geometry, mustHaveItems: ["sofa", "chair", "chair"] }, [opening]);
      return { plan: composed.plan, geometry, openings: [opening], zones: composed.zones };
    },
  },
  {
    name: "J concave room with a legitimate circulation route", status: "VALID", physical: true, functional: true, violations: [],
    build: () => {
      const geometry = createLShapeGeometry(600, 500, 250);
      const table = furniture("table", "COFFEE_TABLE", 150, 200, 80, 40);
      table.semanticPlacement.relationships = [{ type: "IN_FRONT_OF", targetItemId: "sofa" }];
      return {
        plan: simplePlan([furniture("sofa", "PRIMARY_SEATING", 150, 100, 120, 80), table, furniture("rug", "AREA_RUG", 150, 180, 180, 220)]),
        geometry, openings: [{ ...door, offsetCm: 250 }], zones: deriveFunctionalZones(geometry),
      };
    },
  },
];

for (const scenario of scenarios) {
  test(`canonical full pipeline: ${scenario.name}`, () => {
    const input = scenario.build();
    const snapshot = structuredClone(input);
    const report = validateSpatialPlan(input.plan, input.geometry, input.openings, input.zones);
    assert.equal(report.status, scenario.status);
    assert.equal(report.physicallyValid, scenario.physical);
    assert.equal(report.functionallyValid, scenario.functional);
    assert.equal(report.valid, scenario.physical && scenario.functional);
    assert.deepEqual(report.violations.map((violation) => violation.type), scenario.violations);
    assert.deepEqual(report.violations, [...report.violations].sort(compareSpatialViolations));
    assert.equal(report.summary.totalViolations, report.violations.length);
    assert.equal(report.summary.p0Count, report.violations.filter((violation) => violation.priority === "P0").length);
    assert.equal(report.summary.p1Count, report.violations.filter((violation) => violation.priority === "P1").length);
    assert.equal(report.summary.hardCount, report.violations.length);
    assert.equal(report.summary.softCount, 0);
    assert.equal(report.summary.p2Count, 0);
    assert.equal(report.summary.p3Count, 0);
    assert.equal(report.evaluation.footprintsEvaluated, true);
    assert.equal(report.evaluation.physicalEvaluated, true);
    assert.equal(report.evaluation.circulationEvaluated, report.circulation.status !== "NOT_EVALUATED");
    for (const violation of report.violations) {
      assert.equal(violation.classification, "hard");
      assert.equal(violation.priority, ["INVALID_FOOTPRINT", "OUTSIDE_ROOM", "FURNITURE_OVERLAP", "DOOR_CONFLICT"].includes(violation.type) ? "P0" : "P1");
      assert.deepEqual(violation.itemIds, [...violation.itemIds].sort());
    }
    if (scenario.status === "VALID") assert.equal(report.circulation.status, "PASS");
    if (scenario.name.startsWith("D")) {
      assert.equal(report.circulation.status, "NOT_EVALUATED");
      assert.equal(report.circulation.reason, "ALL_DOORS_EXCLUDED");
      const violation = report.violations[0];
      assert.equal(violation.type, "DOOR_CONFLICT");
      if (violation.type === "DOOR_CONFLICT") {
        assert.equal(violation.details.openingId, "entry");
        assert.equal(violation.details.wallSegmentId, "wall-1");
        assert.deepEqual(violation.details.span, { start: { xCm: 400, yCm: 0 }, end: { xCm: 500, yCm: 0 } });
      }
    }
    if (scenario.name.startsWith("E")) {
      const violation = report.violations[0];
      assert.equal(violation.type, "INSUFFICIENT_FUNCTIONAL_CLEARANCE");
      if (violation.type === "INSUFFICIENT_FUNCTIONAL_CLEARANCE") {
        assert.equal(violation.details.ruleId, seatingCoffeeTableClearanceRule.id);
        assert.equal(violation.details.requiredMinimumCm, 35);
        assert.ok(Math.abs(violation.details.measuredClearanceCm - 34.9) < 1e-12);
        assert.equal(violation.details.context, "SEATING_COFFEE_TABLE");
      }
    }
    if (scenario.name.startsWith("F")) {
      assert.equal(report.circulation.status, "BLOCKED");
      const violation = report.violations[0];
      assert.equal(violation.type, "BLOCKED_CIRCULATION");
      if (violation.type === "BLOCKED_CIRCULATION") {
        assert.equal(violation.details.targetZoneId, input.zones[0].id);
        assert.equal(violation.details.profileId, NORMAL_CIRCULATION_PROFILE.id);
        assert.deepEqual(violation.details.evaluatedDoorIds, report.circulation.evaluatedDoorIds);
      }
    }
    if (scenario.name.startsWith("H")) assert.deepEqual(report.summary, {
      totalViolations: 3, p0Count: 2, p1Count: 1, p2Count: 0, p3Count: 0, hardCount: 3, softCount: 0,
    });
    if (scenario.name.startsWith("I")) {
      assert.deepEqual(report.violations[0].itemIds, ["chairs-1", "chairs-2"]);
      assert.deepEqual(report.violations.filter((violation) => violation.type === "OUTSIDE_ROOM").map((violation) => violation.itemIds), [["chairs-1"], ["chairs-2"]]);
      assert.deepEqual(report.summary, { totalViolations: 3, p0Count: 3, p1Count: 0, p2Count: 0, p3Count: 0, hardCount: 3, softCount: 0 });
      const firstChair = input.plan.items.find((item) => item.id === "chairs-1");
      const secondChair = input.plan.items.find((item) => item.id === "chairs-2");
      assert.ok(firstChair && secondChair);
      assert.deepEqual(firstChair.placement.approximatePosition, secondChair.placement.approximatePosition);
      assert.ok(report.violations.every((violation) => !violation.itemIds.includes("area-rug-1")));
    }
    assert.deepEqual(validateSpatialPlan(input.plan, input.geometry, input.openings, input.zones), report);
    assert.deepEqual(validateSpatialPlan({ ...input.plan, items: [...input.plan.items].reverse() }, input.geometry, [...input.openings].reverse(), input.zones), report);
    const rotatedItems = [...input.plan.items.slice(1), ...input.plan.items.slice(0, 1)];
    assert.deepEqual(validateSpatialPlan({ ...input.plan, items: rotatedItems }, input.geometry, input.openings, input.zones), report);
    assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
    assert.deepEqual(input, snapshot);
  });
}

test("canonical reports with multiple doors are invariant under opening and furniture permutations", () => {
  const input = scenarioInput();
  input.openings.push({ ...door, id: "secondary", wallSegmentId: "wall-2", offsetCm: 300 });
  const snapshot = structuredClone(input);
  const report = validateSpatialPlan(input.plan, input.geometry, input.openings, input.zones);
  assert.equal(report.status, "VALID");
  assert.equal(report.circulation.evaluatedDoorIds.length, 2);
  assert.equal(report.circulation.successfulDoorIds.length, 2);
  assert.deepEqual(validateSpatialPlan({ ...input.plan, items: [...input.plan.items].reverse() }, input.geometry, [...input.openings].reverse(), input.zones), report);
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  assert.deepEqual(input, snapshot);
});

test("malformed authoritative geometry/doors remain precondition errors, not false unknown reports", () => {
  assert.throws(() => validateSpatialPlan(livingRoom(), { ...room, vertices: [] }, [door], zones), /SPATIAL_GEOMETRY_INVALID/);
  assert.throws(() => validateSpatialPlan(livingRoom(), room, [{ ...door, offsetCm: Infinity }], zones), /SPATIAL_DOOR_INVALID/);
});

test("invalid footprint has closed reasons and accurately reports incomplete physical evaluation", () => {
  const plan = livingRoom();
  plan.items.push({ ...furniture("invalid", "STORAGE", 400, 300, 40, 40), placement: {
    preferredZone: null, anchorWallId: null, approximatePosition: null, preferredOrientationDegrees: null,
  } });
  const report = validateSpatialPlan(plan, room, [door], zones);
  assert.equal(report.status, "INVALID");
  assert.equal(report.valid, false);
  assert.equal(report.evaluation.footprintsEvaluated, true);
  assert.equal(report.evaluation.physicalEvaluated, false);
  assert.equal(report.evaluation.physicalDoorConflictEvaluated, false);
  assert.equal(report.evaluation.functionalClearanceEvaluated, false);
  assert.equal(report.evaluation.circulationEvaluated, false);
  const violation = report.violations.find((entry) => entry.type === "INVALID_FOOTPRINT");
  assert.ok(violation?.type === "INVALID_FOOTPRINT");
  assert.deepEqual(violation.itemIds, ["invalid"]);
  assert.deepEqual(violation.details.reasons, ["MISSING_ORIENTATION", "MISSING_POSITION"]);
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
});

test("missing explicit functional target is coverage unknown, not fabricated clearance success", () => {
  const plan = livingRoom();
  const table = plan.items.find((item) => item.id === "table");
  assert.ok(table);
  table.semanticPlacement.relationships = [{ type: "IN_FRONT_OF", targetItemId: "missing" }];
  const report = validateSpatialPlan(plan, room, [door], zones);
  assert.equal(report.valid, true);
  assert.equal(report.status, "NOT_FULLY_EVALUATED");
  assert.equal(report.circulation.status, "PASS");
  assert.equal(report.evaluation.functionalClearanceEvaluated, false);
  assert.deepEqual(report.violations, []);
});

test("ordering policy handles future priorities and softness without creating aesthetic violations", () => {
  const entries: Array<{ id: string; type: string; priority: ValidationPriority; classification: "hard" | "soft" }> = [
    { id: "p3", type: "TEST", priority: "P3", classification: "hard" },
    { id: "soft", type: "A", priority: "P0", classification: "soft" },
    { id: "type-b", type: "B", priority: "P0", classification: "hard" },
    { id: "id-z", type: "A", priority: "P0", classification: "hard" },
    { id: "id-a", type: "A", priority: "P0", classification: "hard" },
    { id: "p2", type: "TEST", priority: "P2", classification: "hard" },
    { id: "p1", type: "TEST", priority: "P1", classification: "hard" },
  ];
  assert.deepEqual([...entries].sort(compareSpatialViolations).map((entry) => entry.id), ["id-a", "id-z", "type-b", "soft", "p1", "p2", "p3"]);
  assert.deepEqual([...entries].reverse().sort(compareSpatialViolations), [...entries].sort(compareSpatialViolations));
});

test("spatial policy constants are unchanged by report consolidation", () => {
  assert.equal(seatingCoffeeTableClearanceRule.minimumCm, 35);
  assert.equal(doorApproachClearanceRule.minimumCm, 75);
  assert.equal(NORMAL_CIRCULATION_PROFILE.minimumPassageWidthCm, 75);
  assert.equal(NORMAL_CIRCULATION_PROFILE.minimumPassageWidthCm / 2, 37.5);
  assert.equal(NORMAL_CIRCULATION_PROFILE.gridResolutionCm, 10);
  assert.equal(NORMAL_CIRCULATION_PROFILE.maximumGridNodes, 25000);
});