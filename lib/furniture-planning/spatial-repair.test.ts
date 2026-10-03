import assert from "node:assert/strict";
import test from "node:test";

import { createRectangleGeometry, createLShapeGeometry } from "@/lib/geometry/templates";
import type { RoomOpening } from "@/lib/geometry/types";
import { deriveFunctionalZones } from "./zones";
import type { FurniturePlanItemV11, FurniturePlanV11 } from "./types";
import { validateSpatialPlan } from "./spatial-validator";
import { repairSpatialPlan, SPATIAL_REPAIR_LIMITS, compareRepairScores, getRepairScore, LOCAL_REPAIR_DISTANCES_CM } from "./spatial-repair";
import { resolveLivingRoomComposition } from "./role-plan";
import { computeFacesOrientation } from "./semantic-resolver";

const room = createRectangleGeometry(500, 400, 250);
const zones = deriveFunctionalZones(room);
const door: RoomOpening = { id: "entry", openingType: "door", wallSegmentId: "wall-1", offsetCm: 350, widthCm: 100, heightCm: 210, sillHeightCm: null, hingeSide: "left", swingDirection: "inward" };

function item(id: string, xCm: number, yCm: number, width = 40, depth = 40): FurniturePlanItemV11 {
  return {
    id, category: "storage", subtype: null, priority: "required",
    placement: { preferredZone: zones[0].id, anchorWallId: null, approximatePosition: { xCm, yCm }, preferredOrientationDegrees: 0 },
    semanticPlacement: { role: "STORAGE", mode: "FLOATING", alignment: null, zoneId: zones[0].id, targetWallId: null, relationships: [], fallbackModes: [] },
    sizeRange: { widthMinCm: width, widthMaxCm: width, depthMinCm: depth, depthMaxCm: depth, heightMinCm: 50, heightMaxCm: 100 },
    styleHints: [], materialHints: [], colorHints: [], functionalRequirements: [], reasoning: "Repair test",
  };
}

function plan(items: FurniturePlanItemV11[]): FurniturePlanV11 {
  return { schemaVersion: "1.1", roomIntent: "Repair tests", items, notes: [] };
}

test("fully valid input is a structural no-op with zero candidate evaluations", () => {
  const source = plan([item("valid", 200, 200)]);
  const snapshot = structuredClone({ source, room, door, zones });
  const result = repairSpatialPlan(source, room, [door], zones);
  assert.equal(result.originalReport.status, "VALID");
  assert.equal(result.status, "UNCHANGED_VALID");
  assert.deepEqual(result.attempts, []);
  assert.deepEqual(result.changedItemIds, []);
  assert.equal(result.diagnostics.totalCandidateEvaluations, 0);
  assert.deepEqual(result.repairedPlan, source);
  assert.deepEqual(result.limits, SPATIAL_REPAIR_LIMITS);
  assert.deepEqual({ source, room, door, zones }, snapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test("slightly outside floating footprint repairs inward only after authoritative P0 improvement", () => {
  const source = plan([item("outside", 20, 150, 80, 40)]);
  const snapshot = structuredClone(source);
  const result = repairSpatialPlan(source, room, [door], zones);
  assert.equal(result.status, "REPAIRED");
  assert.equal(result.originalReport.summary.p0Count, 1);
  assert.equal(result.finalReport.summary.p0Count, 0);
  assert.deepEqual(result.changedItemIds, ["outside"]);
  assert.deepEqual(result.finalReport, validateSpatialPlan(result.repairedPlan, room, [door], zones));
  const accepted = result.attempts.filter((attempt) => attempt.accepted);
  assert.equal(accepted.length, 1);
  assert.ok(accepted.every((attempt) => attempt.after.hardP0 < attempt.before.hardP0));
  assert.deepEqual(result.repairedPlan.items[0].semanticPlacement, source.items[0].semanticPlacement);
  assert.equal(result.repairedPlan.items[0].placement.preferredOrientationDegrees, 0);
  assert.deepEqual(source, snapshot);
});

test("ordinary overlap moves the lexically larger equal-protection item by the smaller improving ring", () => {
  const source = plan([item("a", 200, 200), item("b", 225, 200)]);
  const result = repairSpatialPlan(source, room, [door], zones);
  assert.equal(result.status, "REPAIRED");
  assert.deepEqual(result.changedItemIds, ["b"]);
  assert.deepEqual(result.repairedPlan.items[0], source.items[0]);
  assert.deepEqual(result.repairedPlan.items[1].placement.approximatePosition, { xCm: 245, yCm: 200 });
  assert.equal(result.attempts.find((attempt) => attempt.accepted)?.movementDistanceCm, 20);
  assert.deepEqual(repairSpatialPlan(source, room, [door], zones), result);
});

test("a far-outside item terminates unchanged with no fabricated success", () => {
  const source = plan([item("far", -200, 200)]);
  const result = repairSpatialPlan(source, room, [door], zones);
  assert.equal(result.status, "UNREPAIRABLE");
  assert.equal(result.diagnostics.terminationReason, "NO_STRICT_IMPROVEMENT");
  assert.deepEqual(result.repairedPlan, source);
  assert.deepEqual(result.finalReport, result.originalReport);
  assert.equal(result.attempts.length, 40);
  assert.ok(result.attempts.every((attempt) => !attempt.accepted));
});

test("structural copies preserve semantic intent, relationships, sizes, orientation and opaque identity", () => {
  const target = item("target", 250, 300);
  const moving = { ...item("outside", 20, 150, 80, 40), catalogIdentity: "opaque-existing-identity" };
  moving.placement.preferredOrientationDegrees = 37;
  moving.semanticPlacement.mode = "CENTERED_IN_ZONE";
  moving.semanticPlacement.fallbackModes = ["FLOATING"];
  moving.semanticPlacement.relationships = [{ type: "FACES", targetItemId: "target" }];
  const source = plan([moving, target]);
  const snapshot = structuredClone({ source, room, door, zones });
  const result = repairSpatialPlan(source, room, [door], zones, { relationshipRepairs: false });
  assert.equal(result.status, "REPAIRED");
  const repaired = result.repairedPlan.items.find((entry) => entry.id === moving.id);
  assert.ok(repaired);
  assert.deepEqual({ ...repaired, placement: moving.placement }, moving);
  assert.equal(repaired.placement.preferredOrientationDegrees, 37);
  assert.equal(result.finalReport.summary.p0Count, 0);
  assert.deepEqual({ source, room, door, zones }, snapshot);
  assert.notStrictEqual(result.originalPlan.items[0].placement, moving.placement);
  assert.notStrictEqual(result.repairedPlan.items[0].sizeRange, moving.sizeRange);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test("legacy v1.0 plans are copied and repaired without inventing semantic fields", () => {
  const { semanticPlacement, ...legacyItem } = item("legacy", 20, 150, 80, 40);
  assert.equal(semanticPlacement.mode, "FLOATING");
  const source = { schemaVersion: "1.0" as const, roomIntent: "Legacy", items: [legacyItem], notes: [] };
  const result = repairSpatialPlan(source, room, [door], zones);
  assert.equal(result.status, "REPAIRED");
  assert.equal(result.repairedPlan.schemaVersion, "1.0");
  assert.equal("semanticPlacement" in result.repairedPlan.items[0], false);
  assert.deepEqual(source.items[0], legacyItem);
});

test("concave outside repair is certified by full-footprint validation, not center containment", () => {
  const geometry = createLShapeGeometry(600, 500, 250);
  const source = plan([item("notch", 385, 150, 30, 30)]);
  const result = repairSpatialPlan(source, geometry);
  assert.equal(result.status, "PARTIALLY_REPAIRED");
  assert.equal(result.finalReport.status, "NOT_FULLY_EVALUATED");
  assert.equal(result.finalReport.summary.p0Count, 0);
  assert.deepEqual(result.repairedPlan.items[0].placement.approximatePosition, { xCm: 355, yCm: 150 });
  assert.deepEqual(result.finalReport, validateSpatialPlan(result.repairedPlan, geometry));
});

test("wall-anchored overlap protects the wall item and translates floating furniture", () => {
  const anchor = item("wall-anchor", 200, 20, 100, 40);
  anchor.semanticPlacement.role = "PRIMARY_SEATING";
  anchor.semanticPlacement.mode = "AGAINST_WALL";
  anchor.semanticPlacement.targetWallId = "wall-1";
  anchor.placement.anchorWallId = "wall-1";
  const source = plan([anchor, item("floating", 200, 30, 40, 40)]);
  const result = repairSpatialPlan(source, room, [door], zones);
  assert.deepEqual(result.changedItemIds, ["floating"]);
  assert.deepEqual(result.repairedPlan.items.find((entry) => entry.id === anchor.id), anchor);
  assert.equal(result.finalReport.summary.p0Count, 0);
});

test("primary seating stays fixed when an overlapping dependent is less protected", () => {
  const primary = item("z-primary", 200, 200, 40, 40);
  primary.semanticPlacement.role = "PRIMARY_SEATING";
  const dependent = item("a-dependent", 225, 200, 40, 40);
  dependent.semanticPlacement.role = "SECONDARY_SEATING";
  dependent.semanticPlacement.relationships = [{ type: "FACES", targetItemId: primary.id }];
  const source = plan([primary, dependent]);
  const result = repairSpatialPlan(source, room, [door], zones);
  assert.deepEqual(result.changedItemIds, [dependent.id]);
  assert.deepEqual(result.repairedPlan.items[0], primary);
  assert.deepEqual(result.repairedPlan.items[1].semanticPlacement, dependent.semanticPlacement);
});

test("rug layering does not generate a repair target", () => {
  const rug = item("rug", 200, 200, 100, 100);
  rug.semanticPlacement.role = "AREA_RUG";
  const result = repairSpatialPlan(plan([rug, item("seating", 200, 200)]), room, [door], zones);
  assert.equal(result.status, "UNCHANGED_VALID");
  assert.deepEqual(result.attempts, []);
});

function anchoredOutside() {
  const wall = item("wall", 20, 20, 80, 40);
  wall.placement.anchorWallId = "wall-1";
  wall.semanticPlacement.mode = "AGAINST_WALL";
  wall.semanticPlacement.targetWallId = "wall-1";
  return wall;
}

test("wall outside repair moves only along the tangent and preserves depth, target, and orientation", () => {
  const wall = anchoredOutside();
  const result = repairSpatialPlan(plan([wall]), room, [door], zones);
  assert.equal(result.status, "REPAIRED");
  assert.deepEqual(result.changedItemIds, ["wall"]);
  assert.ok(result.attempts.every((attempt) => attempt.offset.dyCm === 0));
  assert.equal(result.repairedPlan.items[0].placement.approximatePosition?.yCm, 20);
  assert.deepEqual(result.repairedPlan.items[0].semanticPlacement, wall.semanticPlacement);
  assert.equal(result.repairedPlan.items[0].placement.anchorWallId, "wall-1");
  assert.equal(result.repairedPlan.items[0].placement.preferredOrientationDegrees, 0);
});

test("vertical wall movement preserves its wall-normal x coordinate", () => {
  const wall = item("vertical", 20, 20, 40, 80);
  wall.placement.anchorWallId = "wall-4";
  wall.semanticPlacement.mode = "AGAINST_WALL";
  wall.semanticPlacement.targetWallId = "wall-4";
  const result = repairSpatialPlan(plan([wall]), room, [door], zones);
  assert.equal(result.status, "REPAIRED");
  assert.ok(result.attempts.every((attempt) => attempt.offset.dxCm === 0));
  assert.equal(result.repairedPlan.items[0].placement.approximatePosition?.xCm, 20);
  assert.equal(result.finalReport.summary.p0Count, 0);
});

test("wall-relative depth cannot be repaired by leaving the anchor wall", () => {
  const wall = anchoredOutside();
  wall.placement.approximatePosition = { xCm: 200, yCm: 5 };
  const source = plan([wall]);
  const result = repairSpatialPlan(source, room, [door], zones);
  assert.equal(result.status, "UNREPAIRABLE");
  assert.deepEqual(result.repairedPlan, source);
  assert.ok(result.attempts.every((attempt) => attempt.offset.dyCm === 0 && !attempt.accepted));
});

test("unsafe or unresolved wall anchors are protected rather than freely translated", () => {
  for (const anchorId of [null, "missing-wall"]) {
    const wall = anchoredOutside();
    wall.placement.anchorWallId = anchorId;
    const source = plan([wall]);
    const result = repairSpatialPlan(source, room, [door], zones);
    assert.equal(result.status, "NOT_REPAIRABLE");
    assert.equal(result.diagnostics.terminationReason, "NO_MOVABLE_TARGET");
    assert.deepEqual(result.repairedPlan, source);
    assert.deepEqual(result.attempts, []);
  }
});

test("finite wall span prevents an implicit wall switch even if a tangent endpoint is inside another wing", () => {
  const geometry = createLShapeGeometry(600, 500, 250);
  const wall = item("wall-span", 370, 210, 40, 40);
  wall.placement.anchorWallId = "wall-1";
  wall.semanticPlacement.mode = "NEAR_WALL";
  wall.semanticPlacement.targetWallId = "wall-1";
  const blocker = item("blocker", 370, 210, 40, 40);
  blocker.placement.anchorWallId = "wall-1";
  blocker.semanticPlacement.mode = "NEAR_WALL";
  blocker.semanticPlacement.targetWallId = "wall-1";
  blocker.semanticPlacement.role = "PRIMARY_SEATING";
  const source = plan([blocker, wall]);
  const result = repairSpatialPlan(source, geometry);
  assert.ok(result.attempts.some((attempt) => attempt.offset.dxCm > 0 && attempt.reason === "WALL_SPAN_CONSTRAINT" && !attempt.accepted));
  assert.ok(result.attempts.filter((attempt) => attempt.accepted).every((attempt) => attempt.offset.dxCm < 0));
  assert.equal(result.repairedPlan.items[1].placement.anchorWallId, "wall-1");
});

test("equal-P0 overlap-to-outside trades are rejected even when the overlap identity disappears", () => {
  const source = plan([item("a", 460, 200, 40, 40), item("b", 475, 200, 40, 40)]);
  const result = repairSpatialPlan(source, room, [door], zones);
  const trade = result.attempts.find((attempt) => attempt.offset.dxCm === 30 && attempt.offset.dyCm === 0);
  assert.ok(trade);
  assert.equal(trade.before.hardP0, 1);
  assert.equal(trade.after.hardP0, 1);
  assert.equal(trade.accepted, false);
  assert.ok(result.attempts.filter((attempt) => attempt.accepted).every((attempt) => attempt.after.hardP0 < attempt.before.hardP0));
  assert.equal(result.finalReport.summary.p0Count, 0);
});

test("overlap-to-overlap P0 trades are rejected, not accepted by changed violation identity", () => {
  const protectedA = item("a", 200, 200, 40, 40);
  protectedA.semanticPlacement.role = "PRIMARY_SEATING";
  const protectedC = item("c", 285, 200, 40, 40);
  protectedC.semanticPlacement.role = "PRIMARY_SEATING";
  const source = plan([protectedA, item("b", 225, 200, 40, 40), protectedC]);
  const result = repairSpatialPlan(source, room, [door], zones);
  const trade = result.attempts.find((attempt) => attempt.offset.dxCm === 45 && attempt.offset.dyCm === 0);
  assert.ok(trade);
  assert.equal(trade.before.hardP0, trade.after.hardP0);
  assert.equal(trade.accepted, false);
  assert.deepEqual(result.repairedPlan.items[0], protectedA);
  assert.deepEqual(result.repairedPlan.items[2], protectedC);
});

test("repair comparator is lexicographic with physical correctness first", () => {
  const report = validateSpatialPlan(plan([item("a", 200, 200), item("b", 225, 200), item("outside", 20, 100, 80, 40)]), room, [door], zones);
  const score = getRepairScore(report);
  assert.deepEqual(score, { hardP0: 2, hardP1: 0, totalHard: 2, totalViolations: 2 });
  assert.ok(compareRepairScores({ hardP0: 1, hardP1: 10, totalHard: 11, totalViolations: 11 }, score) < 0);
  assert.ok(compareRepairScores({ ...score, hardP1: 1 }, score) > 0);
  assert.equal(compareRepairScores(score, { ...score }), 0);
});

test("P0 repair stops at zero and leaves unrelated P1 for later repair milestones", () => {
  const primary = item("seat", 200, 100, 100, 100);
  primary.semanticPlacement.role = "PRIMARY_SEATING";
  const table = item("table", 200, 170, 100, 40);
  table.semanticPlacement.role = "COFFEE_TABLE";
  table.semanticPlacement.relationships = [{ type: "IN_FRONT_OF", targetItemId: primary.id }];
  const source = plan([item("outside", 20, 100, 80, 40), primary, table]);
  const result = repairSpatialPlan(source, room, [door], zones);
  assert.equal(result.originalReport.summary.p1Count, 1);
  assert.equal(result.originalReport.circulation.status, "PASS");
  assert.equal(result.status, "PARTIALLY_REPAIRED");
  assert.equal(result.finalReport.summary.p0Count, 0);
  assert.equal(result.finalReport.summary.p1Count, 1);
  assert.equal(result.finalReport.status, "INVALID");
  assert.deepEqual(result.changedItemIds, ["outside"]);
  assert.deepEqual(result.repairedPlan.items[1], primary);
  assert.deepEqual(result.repairedPlan.items[2], table);
});

test("P1-only and incomplete-but-physically-clean plans are not labeled repaired", () => {
  const approach = plan([item("approach", 400, 50, 40, 20)]);
  const local = repairSpatialPlan(approach, room, [door], zones);
  assert.equal(local.originalReport.summary.p0Count, 0);
  assert.equal(local.originalReport.summary.p1Count, 1);
  assert.equal(local.status, "NOT_REPAIRABLE");
  assert.deepEqual(local.attempts, []);
  const incomplete = repairSpatialPlan(plan([item("clean", 200, 200)]), room);
  assert.equal(incomplete.originalReport.status, "NOT_FULLY_EVALUATED");
  assert.equal(incomplete.status, "NOT_REPAIRABLE");
  assert.deepEqual(incomplete.changedItemIds, []);
});

test("DOOR_CONFLICT alone is not a dedicated A.4.1 strategy", () => {
  const source = plan([item("door-blocker", 400, 20, 40, 40)]);
  const result = repairSpatialPlan(source, room, [door], zones);
  assert.deepEqual(result.originalReport.violations.map((violation) => violation.type), ["DOOR_CONFLICT"]);
  assert.equal(result.status, "NOT_REPAIRABLE");
  assert.deepEqual(result.attempts, []);
  assert.deepEqual(result.repairedPlan, source);
});

test("two independent failures improve across iterations using the accepted plan as the next input", () => {
  const source = plan([item("left", 20, 100, 80, 40), item("right", 480, 280, 80, 40)]);
  const result = repairSpatialPlan(source, room, [door], zones);
  assert.equal(result.status, "REPAIRED");
  assert.deepEqual(result.changedItemIds, ["left", "right"]);
  const accepted = result.attempts.filter((attempt) => attempt.accepted);
  assert.equal(accepted.length, 2);
  assert.deepEqual(accepted.map((attempt) => [attempt.before.hardP0, attempt.after.hardP0]), [[2, 1], [1, 0]]);
  assert.deepEqual(result.finalReport, validateSpatialPlan(result.repairedPlan, room, [door], zones));
  assert.ok(result.diagnostics.iterationsCompleted <= result.limits.maxIterations);
});

test("iteration-bound exhaustion is explicit and retains the best accepted partial repair", () => {
  const source = plan([item("left", 20, 100, 80, 40), item("right", 480, 280, 80, 40)]);
  const result = repairSpatialPlan(source, room, [door], zones, { limits: { maxIterations: 1 } });
  assert.equal(result.status, "PARTIALLY_REPAIRED");
  assert.equal(result.finalReport.summary.p0Count, 1);
  assert.equal(result.diagnostics.terminationReason, "MAX_ITERATIONS");
  assert.deepEqual(result.diagnostics.exhaustedLimits, ["maxIterations"]);
  assert.equal(result.attempts.filter((attempt) => attempt.accepted).length, 1);
});

test("total candidate bound prevents further evaluation or degradation", () => {
  const source = plan([item("left", 20, 100, 80, 40), item("right", 480, 280, 80, 40)]);
  const result = repairSpatialPlan(source, room, [door], zones, { limits: { maxTotalCandidateEvaluations: 40 } });
  assert.equal(result.status, "PARTIALLY_REPAIRED");
  assert.equal(result.attempts.length, 40);
  assert.equal(result.diagnostics.totalCandidateEvaluations, 40);
  assert.equal(result.diagnostics.terminationReason, "MAX_TOTAL_CANDIDATE_EVALUATIONS");
  assert.ok(result.diagnostics.exhaustedLimits.includes("maxTotalCandidateEvaluations"));
  assert.equal(result.finalReport.summary.p0Count, 1);
});

test("per-iteration bound with no strict improvement terminates unchanged and records exhaustion", () => {
  const source = plan([item("far", -200, 200)]);
  const result = repairSpatialPlan(source, room, [door], zones, { limits: { maxCandidatesPerIteration: 1 } });
  assert.equal(result.status, "UNREPAIRABLE");
  assert.equal(result.attempts.length, 1);
  assert.equal(result.diagnostics.terminationReason, "MAX_CANDIDATES_PER_ITERATION");
  assert.deepEqual(result.repairedPlan, source);
});

test("ring magnitudes, candidate order, repeated results, and stable ID choice are deterministic", () => {
  const source = plan([item("a", 200, 200), item("b", 225, 200)]);
  const result = repairSpatialPlan(source, room, [door], zones);
  assert.equal(result.attempts.length, 40);
  assert.deepEqual(result.attempts.slice(0, 4).map((attempt) => attempt.offset), [
    { dxCm: 10, dyCm: 0 }, { dxCm: -10, dyCm: 0 }, { dxCm: 0, dyCm: 10 }, { dxCm: 0, dyCm: -10 },
  ]);
  for (const attempt of result.attempts) {
    assert.ok(LOCAL_REPAIR_DISTANCES_CM.some((distance) => distance === attempt.movementDistanceCm));
    assert.ok(Math.abs(Math.hypot(attempt.offset.dxCm, attempt.offset.dyCm) - attempt.movementDistanceCm) < 1e-12);
    if (attempt.accepted) assert.ok(attempt.after.hardP0 < attempt.before.hardP0);
  }
  const reversed = repairSpatialPlan({ ...source, items: [...source.items].reverse() }, room, [door], zones);
  assert.deepEqual(reversed.attempts, result.attempts);
  assert.deepEqual(reversed.changedItemIds, result.changedItemIds);
  assert.deepEqual(reversed.finalReport, result.finalReport);
  assert.deepEqual(reversed.repairedPlan.items.map((entry) => entry.id), ["b", "a"]);
});

test("supplied stale report cannot bypass fresh authoritative validation", () => {
  const stale = validateSpatialPlan(plan([item("valid", 200, 200)]), room, [door], zones);
  const source = plan([item("outside", 20, 150, 80, 40)]);
  const result = repairSpatialPlan(source, room, [door], zones, { report: stale });
  assert.equal(result.diagnostics.suppliedReportRevalidated, true);
  assert.equal(result.originalReport.status, "INVALID");
  assert.equal(result.originalReport.summary.p0Count, 1);
  assert.equal(result.status, "REPAIRED");
});

test("repair limits cannot be enlarged into unbounded local search", () => {
  const source = plan([]);
  assert.throws(() => repairSpatialPlan(source, room, [], [], { limits: { maxIterations: 9 } }), /INVALID_REPAIR_LIMITS/);
  assert.throws(() => repairSpatialPlan(source, room, [], [], { limits: { maxTotalCandidateEvaluations: Infinity } }), /INVALID_REPAIR_LIMITS/);
});

test("A.4.1 compatibility mode still safely refuses the real A.2.3 chair fixture", () => {
  const composition = resolveLivingRoomComposition({ geometry: room, mustHaveItems: ["sofa", "chair", "chair"] }, [door]);
  const snapshot = structuredClone({ composition, room, door });
  const original = validateSpatialPlan(composition.plan, room, [door], composition.zones);
  assert.equal(original.summary.p0Count, 3);
  const result = repairSpatialPlan(composition.plan, room, [door], composition.zones, { report: original, relationshipRepairs: false });
  assert.equal(result.status, "UNREPAIRABLE");
  assert.equal(result.diagnostics.terminationReason, "NO_STRICT_IMPROVEMENT");
  assert.equal(result.attempts.length, 40);
  assert.equal(result.finalReport.summary.p0Count, 3);
  assert.deepEqual(result.changedItemIds, []);
  assert.deepEqual(result.repairedPlan, composition.plan);
  assert.ok(result.attempts.every((attempt) => !attempt.accepted && attempt.after.hardP0 >= attempt.before.hardP0));
  assert.ok(result.attempts.length > 0);
  assert.ok(result.diagnostics.totalCandidateEvaluations <= result.limits.maxTotalCandidateEvaluations);
  assert.ok(result.finalReport.summary.p0Count <= original.summary.p0Count);
  for (const attempt of result.attempts.filter((entry) => entry.accepted)) assert.ok(attempt.after.hardP0 < attempt.before.hardP0);
  for (const repaired of result.repairedPlan.items) {
    const before = composition.plan.items.find((entry) => entry.id === repaired.id);
    assert.ok(before);
    assert.deepEqual({ ...repaired, placement: before.placement }, before);
    assert.equal(repaired.placement.preferredOrientationDegrees, before.placement.preferredOrientationDegrees);
    assert.equal(repaired.placement.anchorWallId, before.placement.anchorWallId);
  }
  assert.deepEqual(result.finalReport, validateSpatialPlan(result.repairedPlan, room, [door], composition.zones));
  assert.deepEqual(repairSpatialPlan(composition.plan, room, [door], composition.zones, { report: original, relationshipRepairs: false }), result);
  assert.deepEqual({ composition, room, door }, snapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test("canonical A.3 violation order, not item array order or a new repair priority, selects the first target", () => {
  const source = plan([item("outside", 20, 100, 80, 40), item("a", 200, 200), item("b", 225, 200)]);
  const result = repairSpatialPlan(source, room, [door], zones);
  assert.equal(result.originalReport.violations[0].type, "FURNITURE_OVERLAP");
  assert.equal(result.attempts[0].violationId, result.originalReport.violations[0].id);
  assert.equal(result.attempts[0].violationType, "FURNITURE_OVERLAP");
  assert.equal(result.attempts[0].itemId, "b");
  assert.equal(result.status, "REPAIRED");
});

test("nonrepairable first violations are skipped while remaining dedicated door failure is left untouched", () => {
  const blocker = item("door-blocker", 400, 20, 40, 40);
  const source = plan([blocker, item("outside", 20, 150, 80, 40)]);
  const result = repairSpatialPlan(source, room, [door], zones);
  assert.equal(result.originalReport.violations[0].type, "DOOR_CONFLICT");
  assert.equal(result.attempts[0].violationType, "OUTSIDE_ROOM");
  assert.deepEqual(result.changedItemIds, ["outside"]);
  assert.deepEqual(result.repairedPlan.items[0], blocker);
  assert.equal(result.status, "PARTIALLY_REPAIRED");
  assert.equal(result.diagnostics.terminationReason, "NO_REPAIRABLE_P0");
});

test("default total cap limits six independently repairable failures to at most 200 candidate evaluations", () => {
  const geometry = createRectangleGeometry(500, 1000, 250);
  const items = Array.from({ length: 6 }, (_, index) => item(`outside-${index}`, index % 2 === 0 ? 20 : 480, 100 + index * 150, 80, 40));
  const source = plan(items);
  const result = repairSpatialPlan(source, geometry);
  assert.equal(result.attempts.length, 200);
  assert.equal(result.status, "PARTIALLY_REPAIRED");
  assert.equal(result.finalReport.summary.p0Count, 1);
  assert.equal(result.diagnostics.terminationReason, "MAX_TOTAL_CANDIDATE_EVALUATIONS");
  assert.ok(result.diagnostics.exhaustedLimits.includes("maxTotalCandidateEvaluations"));
  assert.equal(result.changedItemIds.length, 5);
  assert.equal(new Set(result.changedItemIds).size, result.changedItemIds.length);
  assert.ok(result.diagnostics.iterationsCompleted <= 8);
  for (let iteration = 1; iteration <= result.diagnostics.iterationsCompleted; iteration += 1) {
    assert.ok(result.attempts.filter((attempt) => attempt.iteration === iteration).length <= 40);
  }
});

test("returned structural copies cannot alter original semantic arrays or item metadata", () => {
  const source = plan([item("valid", 200, 200)]);
  const snapshot = structuredClone(source);
  const result = repairSpatialPlan(source, room, [door], zones);
  result.repairedPlan.items[0].styleHints.push("changed result only");
  result.repairedPlan.items[0].semanticPlacement.fallbackModes.push("CENTERED_IN_ZONE");
  result.repairedPlan.items[0].sizeRange.widthMaxCm = 1000;
  assert.deepEqual(source, snapshot);
  assert.deepEqual(result.originalPlan, snapshot);
});

function relationshipFixture() {
  const anchor = item("semantic-anchor", 250, 45, 220, 90);
  anchor.semanticPlacement.role = "PRIMARY_SEATING";
  anchor.semanticPlacement.mode = "AGAINST_WALL";
  anchor.semanticPlacement.targetWallId = "wall-1";
  anchor.placement.anchorWallId = "wall-1";
  const members = ["dependent-a", "dependent-b"].map((id) => {
    const dependent = item(id, 90, 45, 80, 80);
    dependent.placement.preferredOrientationDegrees = 270;
    dependent.semanticPlacement.role = "SECONDARY_SEATING";
    dependent.semanticPlacement.relationships = [{ type: "ADJACENT_TO", targetItemId: anchor.id }, { type: "FACES", targetItemId: anchor.id }];
    return dependent;
  });
  return plan([anchor, ...members]);
}

const topDoor = { ...door, wallSegmentId: "wall-3", offsetCm: 50 };

test("coordinated opposite-side repair preserves the anchor and atomically re-establishes FACES", () => {
  const source = relationshipFixture();
  const snapshot = structuredClone({ source, room, zones, topDoor });
  const result = repairSpatialPlan(source, room, [topDoor], zones);
  assert.equal(result.status, "REPAIRED");
  assert.equal(result.originalReport.summary.p0Count, 1);
  assert.equal(result.finalReport.summary.p0Count, 0);
  const accepted = result.attempts.find((attempt) => attempt.accepted);
  assert.ok(accepted);
  assert.equal(accepted.strategy, "RELATIONSHIP_COORDINATED");
  assert.deepEqual(result.repairedPlan.items[0], source.items[0]);
  assert.deepEqual(result.repairedPlan.items[1].placement.approximatePosition, { xCm: 410, yCm: 45 });
  assert.deepEqual(result.repairedPlan.items[2].placement.approximatePosition, { xCm: 90, yCm: 45 });
  assert.equal(result.repairedPlan.items[1].placement.preferredOrientationDegrees, 90);
  assert.equal(result.repairedPlan.items[2].placement.preferredOrientationDegrees, 270);
  assert.deepEqual(result.changedItemIds, ["dependent-a"]);
  assert.deepEqual(accepted.changedItemIds, result.changedItemIds);
  assert.equal(accepted.movementCostCm, 320);
  assert.ok(accepted.movements.some((movement) => movement.orientationChange?.after === 90));
  for (const member of result.repairedPlan.items) {
    const original = source.items.find((item) => item.id === member.id);
    assert.ok(original);
    assert.deepEqual(member.semanticPlacement, original.semanticPlacement);
    assert.deepEqual(member.sizeRange, original.sizeRange);
  }
  assert.deepEqual(result.finalReport, validateSpatialPlan(result.repairedPlan, room, [topDoor], zones));
  assert.deepEqual(repairSpatialPlan(source, room, [topDoor], zones), result);
  const reversed = repairSpatialPlan({ ...source, items: [...source.items].reverse() }, room, [topDoor], zones);
  assert.deepEqual(reversed.finalReport, result.finalReport);
  assert.deepEqual(reversed.attempts, result.attempts);
  assert.deepEqual(reversed.changedItemIds, result.changedItemIds);
  assert.deepEqual({ source, room, zones, topDoor }, snapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test("two dependent positions and orientations are applied in one authoritative candidate", () => {
  const source = relationshipFixture();
  source.items[1].placement.approximatePosition = { xCm: 250, yCm: 45 };
  source.items[2].placement.approximatePosition = { xCm: 250, yCm: 45 };
  const result = repairSpatialPlan(source, room, [topDoor], zones);
  const accepted = result.attempts.find((attempt) => attempt.accepted);
  assert.ok(accepted);
  assert.equal(accepted.strategy, "RELATIONSHIP_COORDINATED");
  assert.deepEqual(accepted.changedItemIds, ["dependent-a", "dependent-b"]);
  assert.equal(accepted.before.hardP0, 3);
  assert.equal(accepted.after.hardP0, 0);
  assert.equal(result.attempts.filter((attempt) => attempt.accepted).length, 1);
  assert.deepEqual(result.changedItemIds, ["dependent-a", "dependent-b"]);
});

test("single positional dependent repair uses relative geometry, not arbitrary world translations", () => {
  const source = relationshipFixture();
  source.items = source.items.filter((item) => item.id !== "dependent-a");
  source.items[1].placement.approximatePosition = { xCm: 250, yCm: 45 };
  const result = repairSpatialPlan(source, room, [topDoor], zones);
  assert.equal(result.status, "REPAIRED");
  assert.ok(result.attempts.every((attempt) => attempt.strategy === "RELATIONSHIP_SINGLE"));
  assert.deepEqual(result.repairedPlan.items[1].placement.approximatePosition, { xCm: 410, yCm: 45 });
  assert.deepEqual(result.repairedPlan.items[0], source.items[0]);
});

test("FACES-only local movement can update orientation while preserving all intent fields", () => {
  const target = item("target", 250, 300);
  const moving = item("outside-faces", 20, 150, 80, 40);
  moving.placement.preferredOrientationDegrees = 37;
  moving.semanticPlacement.relationships = [{ type: "FACES", targetItemId: target.id }];
  const source = plan([moving, target]);
  const result = repairSpatialPlan(source, room, [topDoor], zones);
  assert.equal(result.finalReport.summary.p0Count, 0);
  const repaired = result.repairedPlan.items[0];
  assert.ok(repaired.placement.approximatePosition && target.placement.approximatePosition);
  assert.equal(repaired.placement.preferredOrientationDegrees, computeFacesOrientation(repaired.placement.approximatePosition, target.placement.approximatePosition));
  assert.deepEqual(repaired.semanticPlacement, moving.semanticPlacement);
  assert.ok(result.attempts.find((attempt) => attempt.accepted)?.movements[0].orientationChange);
});

test("IN_FRONT_OF repairs preserve wall-derived inward geometry and stop without targeting P1", () => {
  const anchor = relationshipFixture().items[0];
  const table = item("table-front", 250, 70, 100, 60);
  table.semanticPlacement.role = "COFFEE_TABLE";
  table.semanticPlacement.relationships = [{ type: "IN_FRONT_OF", targetItemId: anchor.id }];
  const source = plan([anchor, table]);
  const result = repairSpatialPlan(source, room, [topDoor], zones);
  assert.equal(result.finalReport.summary.p0Count, 0);
  assert.equal(result.originalReport.summary.p0Count, 1);
  assert.deepEqual(result.repairedPlan.items[0], anchor);
  assert.deepEqual(result.repairedPlan.items[1].placement.approximatePosition, { xCm: 250, yCm: 160 });
  assert.equal(result.repairedPlan.items[1].placement.preferredOrientationDegrees, table.placement.preferredOrientationDegrees);
  assert.deepEqual(result.repairedPlan.items[1].semanticPlacement, table.semanticPlacement);
  assert.equal(result.attempts.filter((attempt) => attempt.accepted).length, 1);
});

test("invalid references and positional cycles fail safely without world-space semantic drift", () => {
  const first = item("a", 200, 200);
  const second = item("b", 200, 200);
  first.semanticPlacement.relationships = [{ type: "ADJACENT_TO", targetItemId: "b" }];
  second.semanticPlacement.relationships = [{ type: "ADJACENT_TO", targetItemId: "a" }];
  const source = plan([first, second]);
  const result = repairSpatialPlan(source, room, [topDoor], zones);
  assert.deepEqual(result.repairedPlan, source);
  assert.deepEqual(result.attempts, []);
  assert.equal(result.status, "NOT_REPAIRABLE");
  const missing = item("missing-target", 20, 150, 80, 40);
  missing.semanticPlacement.relationships = [{ type: "ADJACENT_TO", targetItemId: "missing" }];
  assert.deepEqual(repairSpatialPlan(plan([missing]), room, [topDoor], zones).repairedPlan, plan([missing]));
});

test("relationship candidate budgets share the existing total/per-iteration limits", () => {
  const source = relationshipFixture();
  source.items[1].placement.approximatePosition = { xCm: 250, yCm: 45 };
  source.items[2].placement.approximatePosition = { xCm: 250, yCm: 45 };
  const result = repairSpatialPlan(source, room, [topDoor], zones, { limits: { maxCandidatesPerIteration: 1, maxTotalCandidateEvaluations: 1 } });
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].strategy, "RELATIONSHIP_COORDINATED");
  assert.equal(result.diagnostics.totalCandidateEvaluations, 1);
  assert.ok(result.attempts.every((attempt) => attempt.after.hardP0 < attempt.before.hardP0 || !attempt.accepted));
});

test("rejected coordinated P0 trades never leak changed positions or orientations", () => {
  const geometry = createRectangleGeometry(150, 150, 250);
  const anchor = item("anchor", 75, 75, 100, 100);
  anchor.semanticPlacement.role = "PRIMARY_SEATING";
  const first = item("a", 75, 75, 100, 100);
  const second = item("b", 75, 75, 100, 100);
  for (const member of [first, second]) member.semanticPlacement.relationships = [{ type: "ADJACENT_TO", targetItemId: anchor.id }, { type: "FACES", targetItemId: anchor.id }];
  const source = plan([anchor, first, second]);
  const result = repairSpatialPlan(source, geometry);
  assert.equal(result.status, "UNREPAIRABLE");
  assert.ok(result.attempts.some((attempt) => attempt.strategy === "RELATIONSHIP_COORDINATED"));
  assert.ok(result.attempts.every((attempt) => !attempt.accepted));
  assert.deepEqual(result.repairedPlan, source);
  assert.deepEqual(result.changedItemIds, []);
});

test("real A.2.3 coordinated repair improves where A.4.1 could not, without moving sofa or changing chair semantics", () => {
  const composition = resolveLivingRoomComposition({ geometry: room, mustHaveItems: ["sofa", "chair", "chair"] }, [door]);
  const snapshot = structuredClone({ composition, room, door });
  const legacy = repairSpatialPlan(composition.plan, room, [door], composition.zones, { relationshipRepairs: false });
  assert.equal(legacy.originalReport.summary.p0Count, 3);
  assert.equal(legacy.status, "UNREPAIRABLE");
  const result = repairSpatialPlan(composition.plan, room, [door], composition.zones);
  assert.equal(result.finalReport.summary.p0Count, 1);
  assert.equal(result.finalReport.summary.p1Count, 1);
  assert.ok(result.finalReport.summary.p0Count < 3);
  assert.equal(result.status, "PARTIALLY_REPAIRED");
  const accepted = result.attempts.find((attempt) => attempt.accepted);
  assert.equal(accepted?.strategy, "RELATIONSHIP_COORDINATED");
  for (const id of ["chairs-1", "chairs-2"]) {
    const original = composition.plan.items.find((member) => member.id === id);
    const repaired = result.repairedPlan.items.find((member) => member.id === id);
    const anchor = result.repairedPlan.items.find((member) => member.id === "primary-seating-1");
    assert.ok(original && repaired?.placement.approximatePosition && anchor?.placement.approximatePosition);
    assert.deepEqual(repaired.semanticPlacement, original.semanticPlacement);
    assert.deepEqual(repaired.sizeRange, original.sizeRange);
    assert.equal(repaired.placement.preferredOrientationDegrees, computeFacesOrientation(repaired.placement.approximatePosition, anchor.placement.approximatePosition));
  }
  assert.deepEqual(result.repairedPlan.items.find((member) => member.id === "primary-seating-1"), composition.plan.items.find((member) => member.id === "primary-seating-1"));
  assert.notDeepEqual(result.repairedPlan.items.find((member) => member.id === "chairs-1")?.placement.approximatePosition, result.repairedPlan.items.find((member) => member.id === "chairs-2")?.placement.approximatePosition);
  assert.deepEqual(result.finalReport, validateSpatialPlan(result.repairedPlan, room, [door], composition.zones));
  assert.deepEqual(repairSpatialPlan(composition.plan, room, [door], composition.zones), result);
  const reversed = repairSpatialPlan({ ...composition.plan, items: [...composition.plan.items].reverse() }, room, [door], composition.zones);
  assert.deepEqual(reversed.attempts, result.attempts);
  assert.deepEqual(reversed.changedItemIds, result.changedItemIds);
  assert.deepEqual(reversed.finalReport, result.finalReport);
  assert.deepEqual({ composition, room, door }, snapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test("IN_FRONT_OF P0 repair can leave functional clearance invalid and must stop rather than target P1", () => {
  const anchor = relationshipFixture().items[0];
  const table = item("rotated-table", 250, 70, 100, 60);
  table.placement.preferredOrientationDegrees = 37;
  table.semanticPlacement.role = "COFFEE_TABLE";
  table.semanticPlacement.relationships = [{ type: "IN_FRONT_OF", targetItemId: anchor.id }];
  const result = repairSpatialPlan(plan([anchor, table]), room, [topDoor], zones, { limits: { maxCandidatesPerIteration: 1, maxTotalCandidateEvaluations: 1 } });
  assert.equal(result.status, "PARTIALLY_REPAIRED");
  assert.equal(result.finalReport.summary.p0Count, 0);
  assert.equal(result.finalReport.summary.p1Count, 1);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].strategy, "RELATIONSHIP_SINGLE");
  assert.equal(result.repairedPlan.items[1].placement.preferredOrientationDegrees, 37);
  assert.equal(result.diagnostics.terminationReason, "PHYSICAL_FAILURES_RESOLVED");
});

test("a front-positioned secondary anchor carries its adjacent descendant in one accepted plan", () => {
  const anchor = relationshipFixture().items[0];
  const table = item("table", 250, 70, 100, 60);
  table.semanticPlacement.role = "COFFEE_TABLE";
  table.semanticPlacement.relationships = [{ type: "IN_FRONT_OF", targetItemId: anchor.id }];
  const child = item("dependent", 100, 70, 40, 40);
  child.semanticPlacement.relationships = [{ type: "ADJACENT_TO", targetItemId: table.id }, { type: "FACES", targetItemId: table.id }];
  const source = plan([child, table, anchor]);
  const result = repairSpatialPlan(source, room, [topDoor], zones);
  assert.equal(result.finalReport.summary.p0Count, 0);
  const accepted = result.attempts.find((attempt) => attempt.accepted);
  assert.equal(accepted?.strategy, "RELATIONSHIP_COORDINATED");
  assert.deepEqual(accepted?.changedItemIds, ["dependent", "table"]);
  assert.deepEqual(result.repairedPlan.items.find((member) => member.id === "table")?.placement.approximatePosition, { xCm: 250, yCm: 160 });
  assert.deepEqual(result.repairedPlan.items.find((member) => member.id === "dependent")?.placement.approximatePosition, { xCm: 170, yCm: 160 });
  assert.deepEqual(result.repairedPlan.items.find((member) => member.id === anchor.id), anchor);
  assert.deepEqual(result.finalReport, validateSpatialPlan(result.repairedPlan, room, [topDoor], zones));
});

test("changedItemIds includes an orientation-only FACES descendant, not unchanged participants", () => {
  const anchor = relationshipFixture().items[0];
  const table = item("table", 250, 70, 100, 60);
  table.semanticPlacement.role = "COFFEE_TABLE";
  table.semanticPlacement.relationships = [{ type: "IN_FRONT_OF", targetItemId: anchor.id }];
  const observer = item("observer", 450, 200, 40, 40);
  observer.placement.preferredOrientationDegrees = 37;
  observer.semanticPlacement.relationships = [{ type: "FACES", targetItemId: table.id }];
  const source = plan([anchor, table, observer]);
  const result = repairSpatialPlan(source, room, [topDoor], zones);
  assert.equal(result.finalReport.summary.p0Count, 0);
  assert.deepEqual(result.changedItemIds, ["observer", "table"]);
  const repairedObserver = result.repairedPlan.items.find((member) => member.id === observer.id);
  assert.ok(repairedObserver);
  assert.deepEqual(repairedObserver.placement.approximatePosition, observer.placement.approximatePosition);
  assert.notEqual(repairedObserver.placement.preferredOrientationDegrees, 37);
  assert.deepEqual(repairedObserver.semanticPlacement, observer.semanticPlacement);
  const accepted = result.attempts.find((attempt) => attempt.accepted);
  const movement = accepted?.movements.find((member) => member.itemId === observer.id);
  assert.deepEqual(movement?.offset, { dxCm: 0, dyCm: 0 });
  assert.ok(movement?.orientationChange);
  assert.equal(accepted?.movementCostCm, 90);
});