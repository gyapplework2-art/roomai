import assert from "node:assert/strict";
import test from "node:test";

import { createRectangleGeometry, createLShapeGeometry } from "@/lib/geometry/templates";
import { isPointInsideOrOnPolygon } from "@/lib/geometry/point-in-polygon";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";
import { selectLivingRoomComposition, type CompositionSelectionInput } from "./composition-selector";
import { generateCompositionRolePlan, resolveLivingRoomComposition } from "./role-plan";
import { normalizeSemanticPlan } from "./semantic-normalize";
import { computeFacesOrientation, resolveSemanticPlan } from "./semantic-resolver";
import { furniturePlanV11Schema } from "./semantic-schema";
import { validateSpatialPlan } from "./spatial-validator";
import { compareSpatialViolations } from "./spatial-validation-report";
import { repairSpatialPlan, type SpatialRepairOptions } from "./spatial-repair";
import { createFurnitureFootprint } from "./footprints";
import type { FurniturePlanV11, FurniturePlanItemV11 } from "./types";
import type { FunctionalZone } from "./zones";

type Scenario = {
  id: string;
  kind: "FULL_PIPELINE" | "REPAIR_BOUNDARY";
  roomType: "living_room";
  geometry: RoomGeometry;
  openings: RoomOpening[];
  zones: FunctionalZone[];
  requirements: CompositionSelectionInput;
  templateId: string;
  intent: FurniturePlanV11;
  plan: FurniturePlanV11;
  options?: SpatialRepairOptions;
};

function fullScenario(id: string, geometry: RoomGeometry, offsetCm: number, mustHaveItems: string[]): Scenario {
  const openings: RoomOpening[] = [{
    id: "entry", openingType: "door", wallSegmentId: "wall-1", offsetCm, widthCm: 100,
    heightCm: 210, sillHeightCm: null, hingeSide: "left", swingDirection: "inward",
  }];
  const requirements = { geometry, mustHaveItems, roomFunctions: ["relaxation"] };
  const selection = selectLivingRoomComposition(requirements);
  const generated = generateCompositionRolePlan(selection, geometry, openings);
  const normalized = normalizeSemanticPlan(generated.plan);
  const resolved = resolveSemanticPlan(normalized, geometry, openings, generated.zones);
  assert.deepEqual(resolveLivingRoomComposition(requirements, openings).plan, resolved, `${id}: public full-pipeline entry point`);
  assert.deepEqual(selectLivingRoomComposition(requirements), selection, `${id}: stable selection`);
  assert.ok(furniturePlanV11Schema.safeParse(resolved).success, `${id}: valid semantic plan schema`);
  for (const member of resolved.items) assert.deepEqual(member.semanticPlacement, normalized.items.find((item) => item.id === member.id)?.semanticPlacement, `${id}: resolution preserves intent ${member.id}`);
  return { id, kind: "FULL_PIPELINE", roomType: "living_room", geometry, openings, zones: generated.zones,
    requirements, templateId: generated.templateId, intent: normalized, plan: resolved };
}

function cleanScenario(id = "E10A-RECT-CLEAN") {
  return fullScenario(id, createRectangleGeometry(800, 500, 250), 650, ["sectional"]);
}

const fullCases = [
  { id: "E10A-RECT-CLEAN", build: () => cleanScenario(), template: "T3", initial: [0, 0], final: [0, 0], status: "UNCHANGED_VALID", attempts: 0, accepted: 0, changed: [] },
  { id: "E10A-SEATING-LARGE", build: () => fullScenario("E10A-SEATING-LARGE", createRectangleGeometry(800, 500, 250), 650, ["sofa", "chair", "chair"]), template: "T1", initial: [1, 0], final: [0, 0], status: "REPAIRED", attempts: 24, accepted: 1, changed: ["chairs-1"] },
  { id: "E10A-SEATING-CONSTRAINED", build: () => fullScenario("E10A-SEATING-CONSTRAINED", createRectangleGeometry(500, 400, 250), 350, ["sofa", "chair", "chair"]), template: "T1", initial: [3, 0], final: [1, 1], status: "PARTIALLY_REPAIRED", attempts: 48, accepted: 1, changed: ["chairs-1"] },
  { id: "E10A-CONCAVE-FULL", build: () => fullScenario("E10A-CONCAVE-FULL", createLShapeGeometry(800, 600, 250), 200, ["sectional"]), template: "T3", initial: [0, 0], final: [0, 0], status: "UNCHANGED_VALID", attempts: 0, accepted: 0, changed: [] },
];

function checkScenario(input: Scenario) {
  const snapshot = structuredClone(input);
  const initial = validateSpatialPlan(input.plan, input.geometry, input.openings, input.zones);
  const result = repairSpatialPlan(input.plan, input.geometry, input.openings, input.zones, input.options);
  assert.deepEqual(result.originalPlan, input.plan, `${input.id}: copied original plan`);
  assert.deepEqual(result.originalReport, initial, `${input.id}: fresh original validation`);
  assert.deepEqual(result.finalReport, validateSpatialPlan(result.repairedPlan, input.geometry, input.openings, input.zones), `${input.id}: final validator authority`);
  assert.deepEqual(result.repairedPlan.items.map((item) => item.id), input.plan.items.map((item) => item.id), `${input.id}: item ordering preserved`);
  assert.equal(result.diagnostics.totalCandidateEvaluations, result.attempts.length);
  assert.ok(result.attempts.length <= result.limits.maxTotalCandidateEvaluations);
  assert.ok(result.diagnostics.iterationsCompleted <= result.limits.maxIterations);
  for (let iteration = 1; iteration <= result.diagnostics.iterationsCompleted; iteration += 1) {
    assert.ok(result.attempts.filter((attempt) => attempt.iteration === iteration).length <= result.limits.maxCandidatesPerIteration);
  }
  for (const attempt of result.attempts) {
    if (attempt.phase === "FUNCTIONAL") assert.equal(attempt.before.hardP0, 0, `${input.id}: functional phase gate`);
    if (!attempt.accepted) continue;
    if (attempt.phase === "PHYSICAL") assert.ok(attempt.after.hardP0 < attempt.before.hardP0, `${input.id}: strict physical improvement`);
    else {
      assert.equal(attempt.after.hardP0, 0, `${input.id}: functional physical invariant`);
      assert.ok(attempt.after.hardP1 < attempt.before.hardP1, `${input.id}: strict functional improvement`);
    }
  }
  const changed: string[] = [];
  for (const repaired of result.repairedPlan.items) {
    const original = input.plan.items.find((item) => item.id === repaired.id);
    assert.ok(original);
    assert.deepEqual({ ...repaired, placement: original.placement }, original, `${input.id}: intent/dimensions/identity ${repaired.id}`);
    assert.equal(repaired.placement.anchorWallId, original.placement.anchorWallId);
    assert.equal(repaired.placement.preferredZone, original.placement.preferredZone);
    const moved = repaired.placement.approximatePosition?.xCm !== original.placement.approximatePosition?.xCm
      || repaired.placement.approximatePosition?.yCm !== original.placement.approximatePosition?.yCm;
    const rotated = repaired.placement.preferredOrientationDegrees !== original.placement.preferredOrientationDegrees;
    if (moved || rotated) changed.push(repaired.id);
    if (rotated) {
      const faces = original.semanticPlacement.relationships.find((relationship) => relationship.type === "FACES");
      assert.ok(faces, `${input.id}: only existing FACES may change orientation`);
      const target = result.repairedPlan.items.find((item) => item.id === faces.targetItemId);
      assert.ok(target?.placement.approximatePosition && repaired.placement.approximatePosition);
      assert.equal(repaired.placement.preferredOrientationDegrees, computeFacesOrientation(repaired.placement.approximatePosition, target.placement.approximatePosition));
    }
    const footprint = createFurnitureFootprint(repaired);
    assert.ok(footprint.valid, `${input.id}: valid final footprint ${repaired.id}`);
    assert.equal(footprint.footprint.corners.length, 4);
    assert.deepEqual(footprint.footprint.polygon, footprint.footprint.corners);
  }
  assert.deepEqual(result.changedItemIds, changed.sort());
  assert.deepEqual(result.finalReport.violations, [...result.finalReport.violations].sort(compareSpatialViolations));
  assert.deepEqual(repairSpatialPlan(input.plan, input.geometry, input.openings, input.zones, input.options), result, `${input.id}: deterministic repeat`);
  for (const value of [result, result.repairedPlan, result.finalReport, result.attempts]) assert.deepEqual(JSON.parse(JSON.stringify(value)), value, `${input.id}: plain-data round trip`);
  assert.deepEqual(input, snapshot, `${input.id}: no nested input mutation`);
  return result;
}

for (const scenario of fullCases) {
  test(`${scenario.id} FULL_PIPELINE: selection → roles → semantic geometry → validation → repair`, () => {
    const input = scenario.build();
    assert.equal(input.kind, "FULL_PIPELINE");
    assert.equal(input.roomType, "living_room");
    assert.equal(input.geometry.schemaVersion, "1.0");
    assert.equal(input.templateId, scenario.template);
    assert.equal(input.openings.length, 1);
    assert.equal(input.openings[0].openingType, "door");
    assert.deepEqual(input.plan.items.map((item) => item.id), input.intent.items.map((item) => item.id));
    const expectedRoles = [
      ["primary-seating-1", "PRIMARY_SEATING"], ["coffee-table-1", "COFFEE_TABLE"], ["area-rug-1", "AREA_RUG"],
      ...(scenario.template === "T1" ? [["chairs-1", "SECONDARY_SEATING"], ["chairs-2", "SECONDARY_SEATING"]] : []),
    ];
    assert.deepEqual(input.plan.items.map((item) => [item.id, item.semanticPlacement.role]), expectedRoles);
    const primary = input.plan.items.find((item) => item.semanticPlacement.role === "PRIMARY_SEATING");
    assert.ok(primary);
    assert.equal(primary.semanticPlacement.mode, "AGAINST_WALL");
    assert.equal(primary.placement.anchorWallId, primary.semanticPlacement.targetWallId);
    const table = input.plan.items.find((item) => item.semanticPlacement.role === "COFFEE_TABLE");
    const rug = input.plan.items.find((item) => item.semanticPlacement.role === "AREA_RUG");
    assert.ok(table && rug);
    assert.equal(table.semanticPlacement.mode, "FLOATING");
    assert.deepEqual(table.semanticPlacement.relationships, [{ type: "IN_FRONT_OF", targetItemId: primary.id }]);
    assert.equal(rug.semanticPlacement.mode, "CENTERED_IN_ZONE");
    assert.equal(rug.semanticPlacement.zoneId, input.zones[0].id);
    const result = checkScenario(input);
    assert.deepEqual([result.originalReport.summary.p0Count, result.originalReport.summary.p1Count], scenario.initial);
    assert.equal(result.originalReport.status, scenario.initial[0] || scenario.initial[1] ? "INVALID" : "VALID");
    assert.equal(result.status, scenario.status);
    assert.equal(result.attempts.length, scenario.attempts);
    assert.equal(result.attempts.filter((attempt) => attempt.accepted).length, scenario.accepted);
    assert.deepEqual(result.changedItemIds, scenario.changed);
    assert.deepEqual([result.finalReport.summary.p0Count, result.finalReport.summary.p1Count], scenario.final);
    assert.equal(result.finalReport.physicallyValid, scenario.final[0] === 0);
    assert.equal(result.finalReport.functionallyValid, scenario.final[1] === 0);
    assert.deepEqual(result.repairedPlan.items.find((item) => item.id === primary.id), primary);
    if (scenario.status === "PARTIALLY_REPAIRED") {
      assert.equal(result.finalReport.status, "INVALID");
      assert.ok(result.attempts.every((attempt) => attempt.phase === "PHYSICAL"));
      assert.deepEqual(result.finalReport.violations.map((violation) => violation.type), ["OUTSIDE_ROOM", "INSUFFICIENT_FUNCTIONAL_CLEARANCE"]);
      assert.equal(result.finalReport.circulation.status, "NOT_EVALUATED");
    } else {
      assert.equal(result.finalReport.status, "VALID");
      assert.equal(result.finalReport.circulation.status, "PASS");
      assert.deepEqual(result.finalReport.violations, []);
    }
    const members = result.repairedPlan.items.filter((item) => item.semanticPlacement.role === "SECONDARY_SEATING");
    if (members.length === 2) {
      assert.notDeepEqual(members[0].placement.approximatePosition, members[1].placement.approximatePosition);
      for (const member of members) {
        assert.deepEqual(member.semanticPlacement.relationships.map((relationship) => [relationship.type, relationship.targetItemId]), [["ADJACENT_TO", primary.id], ["FACES", primary.id]]);
        assert.ok(member.placement.approximatePosition && primary.placement.approximatePosition);
        assert.equal(member.placement.preferredOrientationDegrees, computeFacesOrientation(member.placement.approximatePosition, primary.placement.approximatePosition));
      }
      assert.equal(result.attempts.find((attempt) => attempt.accepted)?.strategy, "RELATIONSHIP_COORDINATED");
    }
    if (scenario.id === "E10A-SEATING-LARGE") {
      assert.deepEqual(members.map((member) => ({ position: member.placement.approximatePosition, orientation: member.placement.preferredOrientationDegrees })), [
        { position: { xCm: 477.5, yCm: 45 }, orientation: 90 }, { position: { xCm: 157.5, yCm: 45 }, orientation: 270 },
      ]);
    }
    if (scenario.id === "E10A-RECT-CLEAN") {
      assert.deepEqual(result.repairedPlan.items.map((item) => item.placement.approximatePosition), [{ xCm: 317.5, yCm: 80 }, { xCm: 317.5, yCm: 230 }, { xCm: 400, yCm: 250 }]);
      assert.deepEqual(result.repairedPlan, input.plan);
      const footprint = createFurnitureFootprint(primary);
      assert.ok(footprint.valid);
      assert.deepEqual(footprint.footprint.corners, [{ xCm: 172.5, yCm: 0 }, { xCm: 462.5, yCm: 0 }, { xCm: 462.5, yCm: 160 }, { xCm: 172.5, yCm: 160 }]);
    }
    if (input.geometry.shapeType === "l_shape") {
      assert.deepEqual(primary.placement.approximatePosition, { xCm: 400, yCm: 520 });
      assert.equal(primary.placement.preferredOrientationDegrees, 180);
      assert.deepEqual(input.zones[0].polygon, input.geometry.vertices);
    }
  });
}

function boundaryBase(id: string): Scenario {
  return { ...cleanScenario(id), kind: "REPAIR_BOUNDARY" };
}

function storage(input: Scenario, id: string, xCm: number, yCm: number, width = 40, depth = 40): FurniturePlanItemV11 & { identityHint: string } {
  return {
    id, identityHint: `canonical-${id}`, category: "storage", subtype: null, priority: "optional",
    placement: { preferredZone: input.zones[0].id, anchorWallId: null, approximatePosition: { xCm, yCm }, preferredOrientationDegrees: 0 },
    semanticPlacement: { role: "STORAGE", mode: "FLOATING", alignment: null, zoneId: input.zones[0].id, targetWallId: null, relationships: [], fallbackModes: [] },
    sizeRange: { widthMinCm: width, widthMaxCm: width, depthMinCm: depth, depthMaxCm: depth, heightMinCm: 50, heightMaxCm: 100 },
    styleHints: [], materialHints: [], colorHints: [], functionalRequirements: [], reasoning: "Deliberate lower-level boundary after real semantic resolution",
  };
}

function tableTooClose(input: Scenario) {
  const table = input.plan.items.find((item) => item.semanticPlacement.role === "COFFEE_TABLE");
  assert.ok(table?.placement.approximatePosition);
  table.placement.approximatePosition.yCm -= 5.1;
}

function multiFailure(id: string): Scenario {
  const input = boundaryBase(id);
  tableTooClose(input);
  input.plan.items.push(storage(input, "outside-left", 20, 350, 80), storage(input, "outside-right", 780, 350, 80));
  return input;
}

const boundaries: Array<{
  id: string;
  build: () => Scenario;
  initial: [number, number];
  final: [number, number];
  status: string;
  reportStatus: string;
  accepted: number;
  attempts: number;
  changed: string[];
}> = [
  {
    id: "E10A-OUTSIDE-LOCAL", initial: [1, 0], final: [0, 0], status: "REPAIRED", reportStatus: "VALID", accepted: 1, attempts: 40, changed: ["outside-storage"],
    build: () => { const input = boundaryBase("E10A-OUTSIDE-LOCAL"); input.plan.items.push(storage(input, "outside-storage", 20, 350, 80)); return input; },
  },
  {
    id: "E10A-OVERLAP-LOCAL", initial: [1, 0], final: [0, 0], status: "REPAIRED", reportStatus: "VALID", accepted: 1, attempts: 40, changed: ["storage-b"],
    build: () => { const input = boundaryBase("E10A-OVERLAP-LOCAL"); input.plan.items.push(storage(input, "storage-a", 550, 350), storage(input, "storage-b", 575, 350)); return input; },
  },
  {
    id: "E10A-COFFEE-CLEARANCE", initial: [0, 1], final: [0, 0], status: "REPAIRED", reportStatus: "VALID", accepted: 1, attempts: 6, changed: ["coffee-table-1"],
    build: () => { const input = boundaryBase("E10A-COFFEE-CLEARANCE"); tableTooClose(input); return input; },
  },
  {
    id: "E10A-DOOR-APPROACH", initial: [0, 1], final: [0, 0], status: "REPAIRED", reportStatus: "VALID", accepted: 1, attempts: 40, changed: ["approach-storage"],
    build: () => { const input = boundaryBase("E10A-DOOR-APPROACH"); input.plan.items.push(storage(input, "approach-storage", 700, 50, 40, 20)); return input; },
  },
  {
    id: "E10A-PHYSICAL-DOOR", initial: [1, 0], final: [1, 0], status: "NOT_REPAIRABLE", reportStatus: "INVALID", accepted: 0, attempts: 0, changed: [],
    build: () => { const input = boundaryBase("E10A-PHYSICAL-DOOR"); input.plan.items.push(storage(input, "door-blocker", 700, 20, 40, 40)); return input; },
  },
  {
    id: "E10A-CIRCULATION-REPAIR", initial: [0, 1], final: [0, 0], status: "REPAIRED", reportStatus: "VALID", accepted: 1, attempts: 30, changed: ["circulation-barrier"],
    build: () => {
      const input = { ...fullScenario("E10A-CIRCULATION-REPAIR", createRectangleGeometry(800, 800, 250), 650, ["sectional"]), kind: "REPAIR_BOUNDARY" as const };
      input.plan.items.push(storage(input, "circulation-barrier", 400, 310, 700, 40));
      return input;
    },
  },
  {
    id: "E10A-UNREPAIRABLE", initial: [1, 0], final: [1, 0], status: "UNREPAIRABLE", reportStatus: "INVALID", accepted: 0, attempts: 40, changed: [],
    build: () => { const input = boundaryBase("E10A-UNREPAIRABLE"); input.plan.items.push(storage(input, "far-outside", -200, 350)); return input; },
  },
  {
    id: "E10A-MISSING-DOOR", initial: [0, 0], final: [0, 0], status: "NOT_REPAIRABLE", reportStatus: "NOT_FULLY_EVALUATED", accepted: 0, attempts: 0, changed: [],
    build: () => ({ ...boundaryBase("E10A-MISSING-DOOR"), openings: [] }),
  },
  {
    id: "E10A-MISSING-ZONE", initial: [0, 0], final: [0, 0], status: "NOT_REPAIRABLE", reportStatus: "NOT_FULLY_EVALUATED", accepted: 0, attempts: 0, changed: [],
    build: () => ({ ...boundaryBase("E10A-MISSING-ZONE"), zones: [] }),
  },
  {
    id: "E10A-CONCAVE-NOTCH-REPAIR", initial: [1, 0], final: [0, 0], status: "REPAIRED", reportStatus: "VALID", accepted: 1, attempts: 40, changed: ["notch-storage"],
    build: () => {
      const input = { ...fullScenario("E10A-CONCAVE-NOTCH-REPAIR", createLShapeGeometry(800, 600, 250), 200, ["sectional"]), kind: "REPAIR_BOUNDARY" as const };
      input.plan.items.push(storage(input, "notch-storage", 510, 200, 30, 30));
      return input;
    },
  },
  {
    id: "E10A-WALL-TANGENT", initial: [1, 0], final: [0, 0], status: "REPAIRED", reportStatus: "VALID", accepted: 1, attempts: 10, changed: ["wall-storage"],
    build: () => {
      const input = boundaryBase("E10A-WALL-TANGENT");
      const wall = storage(input, "wall-storage", 20, 20, 80, 40);
      wall.placement.anchorWallId = "wall-1"; wall.semanticPlacement.mode = "AGAINST_WALL"; wall.semanticPlacement.targetWallId = "wall-1";
      input.plan.items.push(wall); return input;
    },
  },
  {
    id: "E10A-WALL-REFUSAL", initial: [1, 0], final: [1, 0], status: "UNREPAIRABLE", reportStatus: "INVALID", accepted: 0, attempts: 10, changed: [],
    build: () => {
      const input = boundaryBase("E10A-WALL-REFUSAL");
      const wall = storage(input, "wall-storage", 100, 5, 80, 40);
      wall.placement.anchorWallId = "wall-1"; wall.semanticPlacement.mode = "AGAINST_WALL"; wall.semanticPlacement.targetWallId = "wall-1";
      input.plan.items.push(wall); return input;
    },
  },
  {
    id: "E10A-RUG-RUG", initial: [1, 0], final: [1, 0], status: "UNREPAIRABLE", reportStatus: "INVALID", accepted: 0, attempts: 40, changed: [],
    build: () => {
      const input = boundaryBase("E10A-RUG-RUG");
      const rug = input.plan.items.find((item) => item.semanticPlacement.role === "AREA_RUG");
      assert.ok(rug);
      input.plan.items.push({ ...structuredClone(rug), id: "layered-rug" }); return input;
    },
  },
  {
    id: "E10A-RUG-OUTSIDE", initial: [1, 0], final: [0, 0], status: "REPAIRED", reportStatus: "VALID", accepted: 1, attempts: 40, changed: ["area-rug-1"],
    build: () => {
      const input = boundaryBase("E10A-RUG-OUTSIDE");
      const rug = input.plan.items.find((item) => item.semanticPlacement.role === "AREA_RUG");
      assert.ok(rug); rug.placement.approximatePosition = { xCm: 95, yCm: 250 }; return input;
    },
  },
  {
    id: "E10A-MULTI-PHASE", initial: [2, 1], final: [0, 0], status: "REPAIRED", reportStatus: "VALID", accepted: 3, attempts: 86, changed: ["coffee-table-1", "outside-left", "outside-right"],
    build: () => multiFailure("E10A-MULTI-PHASE"),
  },
  {
    id: "E10A-SHARED-BUDGET", initial: [2, 1], final: [0, 1], status: "PARTIALLY_REPAIRED", reportStatus: "INVALID", accepted: 2, attempts: 80, changed: ["outside-left", "outside-right"],
    build: () => ({ ...multiFailure("E10A-SHARED-BUDGET"), options: { limits: { maxTotalCandidateEvaluations: 80 } } }),
  },
];

for (const scenario of boundaries) {
  test(`${scenario.id} REPAIR_BOUNDARY: resolved semantic plan → deliberate boundary → validation/repair`, () => {
    const input = scenario.build();
    assert.equal(input.kind, "REPAIR_BOUNDARY");
    const result = checkScenario(input);
    assert.deepEqual([result.originalReport.summary.p0Count, result.originalReport.summary.p1Count], scenario.initial, `${scenario.id}: initial counts`);
    assert.deepEqual([result.finalReport.summary.p0Count, result.finalReport.summary.p1Count], scenario.final, `${scenario.id}: final counts`);
    assert.equal(result.status, scenario.status);
    assert.equal(result.finalReport.status, scenario.reportStatus);
    assert.equal(result.attempts.length, scenario.attempts);
    assert.equal(result.attempts.filter((attempt) => attempt.accepted).length, scenario.accepted);
    assert.deepEqual(result.changedItemIds, scenario.changed);
    assert.equal(result.finalReport.physicallyValid, scenario.final[0] === 0);
    assert.equal(result.finalReport.functionallyValid, scenario.final[1] === 0);
    if (scenario.reportStatus === "VALID") {
      assert.equal(result.finalReport.circulation.status, "PASS");
      assert.deepEqual(result.finalReport.violations, []);
    }
    if (scenario.id === "E10A-OUTSIDE-LOCAL") {
      assert.equal(result.originalReport.violations[0].type, "OUTSIDE_ROOM");
      assert.deepEqual(result.repairedPlan.items.find((item) => item.id === "outside-storage")?.placement.approximatePosition, { xCm: 40, yCm: 350 });
    }
    if (scenario.id === "E10A-OVERLAP-LOCAL") {
      assert.equal(result.originalReport.violations[0].type, "FURNITURE_OVERLAP");
      assert.deepEqual(result.repairedPlan.items.find((item) => item.id === "storage-b")?.placement.approximatePosition, { xCm: 595, yCm: 350 });
    }
    if (scenario.id === "E10A-COFFEE-CLEARANCE") {
      assert.equal(result.attempts.find((attempt) => attempt.accepted)?.strategy, "FUNCTIONAL_CLEARANCE");
      assert.equal(result.attempts.find((attempt) => attempt.accepted)?.movementCostCm, 5);
      assert.deepEqual(result.repairedPlan.items.find((item) => item.semanticPlacement.role === "COFFEE_TABLE")?.placement.approximatePosition, { xCm: 317.5, yCm: 229.9 });
    }
    if (scenario.id === "E10A-DOOR-APPROACH") {
      assert.equal(result.originalReport.violations[0].type, "INSUFFICIENT_FUNCTIONAL_CLEARANCE");
      assert.equal(result.attempts.find((attempt) => attempt.accepted)?.strategy, "DOOR_APPROACH");
      assert.deepEqual(result.repairedPlan.items.find((item) => item.id === "approach-storage")?.placement.approximatePosition, { xCm: 700, yCm: 95 });
    }
    if (scenario.id === "E10A-PHYSICAL-DOOR") {
      assert.deepEqual(result.finalReport.violations.map((violation) => violation.type), ["DOOR_CONFLICT"]);
      assert.equal(result.finalReport.circulation.status, "NOT_EVALUATED");
      assert.equal(result.finalReport.circulation.reason, "ALL_DOORS_EXCLUDED");
      assert.deepEqual(result.repairedPlan, input.plan);
    }
    if (scenario.id === "E10A-CIRCULATION-REPAIR") {
      assert.equal(result.originalReport.circulation.status, "BLOCKED");
      assert.equal(result.originalReport.violations[0].type, "BLOCKED_CIRCULATION");
      assert.equal(result.attempts.find((attempt) => attempt.accepted)?.strategy, "CIRCULATION");
      assert.ok(result.attempts.every((attempt) => attempt.itemId !== "area-rug-1"));
    }
    if (scenario.id.startsWith("E10A-MISSING")) {
      assert.equal(result.finalReport.valid, true);
      assert.equal(result.finalReport.circulation.status, "NOT_EVALUATED");
      assert.equal(result.finalReport.evaluation.circulationEvaluated, false);
      assert.equal(result.finalReport.circulation.reason, scenario.id === "E10A-MISSING-DOOR" ? "NO_DOORS" : "NO_PRIMARY_ZONE");
    }
    if (scenario.id === "E10A-CONCAVE-NOTCH-REPAIR") {
      assert.deepEqual(result.repairedPlan.items.find((item) => item.id === "notch-storage")?.placement.approximatePosition, { xCm: 480, yCm: 200 });
      assert.ok(isPointInsideOrOnPolygon({ xCm: 510, yCm: 230 }, input.geometry.vertices));
      const centerOnlyCandidate = result.attempts.find((attempt) => attempt.offset.dxCm === 0 && attempt.offset.dyCm === 30);
      assert.ok(centerOnlyCandidate);
      assert.equal(centerOnlyCandidate.accepted, false);
      assert.equal(centerOnlyCandidate.after.hardP0, 1);
    }
    if (scenario.id.startsWith("E10A-WALL")) {
      assert.ok(result.attempts.every((attempt) => attempt.offset.dyCm === 0));
      assert.ok(result.attempts.every((attempt) => !Object.is(attempt.offset.dxCm, -0) && !Object.is(attempt.offset.dyCm, -0)));
      assert.equal(result.repairedPlan.items.find((item) => item.id === "wall-storage")?.placement.anchorWallId, "wall-1");
      if (scenario.id === "E10A-WALL-TANGENT") assert.deepEqual(result.repairedPlan.items.find((item) => item.id === "wall-storage")?.placement.approximatePosition, { xCm: 40, yCm: 20 });
    }
    if (scenario.id === "E10A-RUG-RUG") assert.deepEqual(result.finalReport.violations[0].itemIds, ["area-rug-1", "layered-rug"]);
    if (scenario.id === "E10A-RUG-OUTSIDE") assert.deepEqual(result.repairedPlan.items.find((item) => item.id === "area-rug-1")?.placement.approximatePosition, { xCm: 105, yCm: 250 });
    if (scenario.id === "E10A-MULTI-PHASE") {
      const accepted = result.attempts.filter((attempt) => attempt.accepted);
      assert.deepEqual(accepted.map((attempt) => attempt.phase), ["PHYSICAL", "PHYSICAL", "FUNCTIONAL"]);
      assert.deepEqual(accepted.map((attempt) => [attempt.before.hardP0, attempt.after.hardP0]), [[2, 1], [1, 0], [0, 0]]);
      assert.deepEqual(accepted.map((attempt) => [attempt.before.hardP1, attempt.after.hardP1]), [[1, 1], [1, 1], [1, 0]]);
    }
    if (scenario.id === "E10A-SHARED-BUDGET") {
      assert.equal(result.diagnostics.terminationReason, "MAX_TOTAL_CANDIDATE_EVALUATIONS");
      assert.ok(result.diagnostics.exhaustedLimits.includes("maxTotalCandidateEvaluations"));
      assert.ok(result.attempts.every((attempt) => attempt.phase === "PHYSICAL"));
      assert.deepEqual(result.repairedPlan.items.find((item) => item.id === "coffee-table-1"), input.plan.items.find((item) => item.id === "coffee-table-1"));
    }
    if (scenario.status === "UNREPAIRABLE") {
      assert.equal(result.diagnostics.terminationReason, "NO_STRICT_IMPROVEMENT");
      assert.ok(result.attempts.every((attempt) => !attempt.accepted));
      assert.deepEqual(result.repairedPlan, input.plan);
      assert.deepEqual(result.finalReport, result.originalReport);
    }
  });
}

function canonicalOutcome(result: ReturnType<typeof repairSpatialPlan<FurniturePlanV11>>) {
  return {
    status: result.status, originalReport: result.originalReport, finalReport: result.finalReport,
    attempts: result.attempts, changedItemIds: result.changedItemIds, diagnostics: result.diagnostics,
    finalItems: [...result.repairedPlan.items].sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0).map((item) => ({
      id: item.id, position: item.placement.approximatePosition, orientation: item.placement.preferredOrientationDegrees,
      semanticPlacement: { ...item.semanticPlacement, relationships: [...item.semanticPlacement.relationships].sort((first, second) => {
        const firstKey = `${first.type}:${first.targetItemId}`;
        const secondKey = `${second.type}:${second.targetItemId}`;
        return firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0;
      }) },
      sizeRange: item.sizeRange,
    })),
  };
}

for (const build of [
  () => fullScenario("E10A-EQUIVALENT-FULL", createRectangleGeometry(800, 500, 250), 650, ["sofa", "chair", "chair"]),
  () => multiFailure("E10A-EQUIVALENT-MULTI"),
]) {
  const label = build().id;
  test(`${label}: items/openings/relationship declarations preserve canonical outcomes`, () => {
    const input = build();
    input.openings.push({ ...input.openings[0], id: "secondary", wallSegmentId: "wall-2", offsetCm: 350 });
    if (input.kind === "FULL_PIPELINE") {
      const selected = selectLivingRoomComposition(input.requirements);
      input.intent = generateCompositionRolePlan(selected, input.geometry, input.openings).plan;
      input.plan = resolveLivingRoomComposition({ ...input.requirements, geometry: input.geometry }, input.openings).plan;
    }
    const snapshot = structuredClone(input);
    const result = repairSpatialPlan(input.plan, input.geometry, input.openings, input.zones);
    assert.equal(result.finalReport.status, "VALID");
    assert.equal(result.finalReport.circulation.evaluatedDoorIds.length, 2);
    const reversedPlan: FurniturePlanV11 = { ...input.plan, items: [...input.plan.items].reverse().map((item) => ({
      ...item, semanticPlacement: { ...item.semanticPlacement, relationships: [...item.semanticPlacement.relationships].reverse() },
    })) };
    const equivalent = repairSpatialPlan(reversedPlan, input.geometry, [...input.openings].reverse(), input.zones);
    assert.deepEqual(canonicalOutcome(equivalent), canonicalOutcome(result));
    assert.deepEqual(equivalent.finalReport, validateSpatialPlan(equivalent.repairedPlan, input.geometry, [...input.openings].reverse(), input.zones));
    assert.deepEqual(resolveSemanticPlan(normalizeSemanticPlan(input.intent), input.geometry, [...input.openings].reverse(), input.zones).items.map((item) => item.id), input.intent.items.map((item) => item.id));
    assert.deepEqual(input, snapshot);
    assert.deepEqual(JSON.parse(JSON.stringify(equivalent)), equivalent);
  });
}

test("E10A-DONE: named canonical evidence covers all twenty completion requirements", () => {
  const registered = new Set([...fullCases, ...boundaries].map((scenario) => scenario.id));
  assert.equal(registered.size, fullCases.length + boundaries.length);
  const evidence = {
    semanticIntent: ["E10A-RECT-CLEAN"],
    wallResolution: ["E10A-CONCAVE-FULL"],
    relationshipResolution: ["E10A-SEATING-LARGE"],
    zonesAndComposition: ["E10A-RECT-CLEAN", "E10A-CONCAVE-FULL"],
    exactFootprints: ["E10A-RECT-CLEAN"],
    physicalValidation: ["E10A-OUTSIDE-LOCAL", "E10A-OVERLAP-LOCAL", "E10A-PHYSICAL-DOOR"],
    functionalValidation: ["E10A-COFFEE-CLEARANCE", "E10A-DOOR-APPROACH"],
    circulation: ["E10A-CIRCULATION-REPAIR"],
    authoritativeStatus: ["E10A-RECT-CLEAN", "E10A-UNREPAIRABLE", "E10A-MISSING-DOOR", "E10A-MISSING-ZONE"],
    localPhysicalRepair: ["E10A-OUTSIDE-LOCAL", "E10A-OVERLAP-LOCAL"],
    coordinatedRepair: ["E10A-SEATING-LARGE"],
    functionalRepair: ["E10A-COFFEE-CLEARANCE", "E10A-DOOR-APPROACH"],
    authoritativeCirculationRepair: ["E10A-CIRCULATION-REPAIR"],
    phaseGating: ["E10A-SEATING-CONSTRAINED", "E10A-MULTI-PHASE"],
    monotonicAcceptance: ["E10A-MULTI-PHASE"],
    safePartialAndRefusal: ["E10A-SEATING-CONSTRAINED", "E10A-UNREPAIRABLE", "E10A-SHARED-BUDGET"],
    concavity: ["E10A-CONCAVE-FULL", "E10A-CONCAVE-NOTCH-REPAIR"],
    wallConstraints: ["E10A-WALL-TANGENT", "E10A-WALL-REFUSAL"],
    floorLayer: ["E10A-RECT-CLEAN", "E10A-RUG-RUG", "E10A-RUG-OUTSIDE", "E10A-CIRCULATION-REPAIR"],
    deterministicImmutableSerializable: ["E10A-RECT-CLEAN", "E10A-SEATING-LARGE", "E10A-MULTI-PHASE"],
  };
  assert.equal(Object.keys(evidence).length, 20);
  for (const [requirement, ids] of Object.entries(evidence)) {
    assert.ok(ids.length > 0, `${requirement}: named evidence exists`);
    for (const id of ids) assert.ok(registered.has(id), `${requirement}: ${id} is an executed canonical scenario`);
  }
});