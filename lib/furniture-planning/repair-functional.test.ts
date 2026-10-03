import assert from "node:assert/strict";
import test from "node:test";
import { createRectangleGeometry } from "@/lib/geometry/templates";
import { deriveFunctionalZones } from "./zones";
import type { FurniturePlanItemV11, FurniturePlanV11 } from "./types";
import { validateSpatialPlan } from "./spatial-validator";
import { generateFunctionalRepairCandidates, isSupportedFunctionalViolation } from "./repair-functional";
import { repairSpatialPlan } from "./spatial-repair";
import { computeFacesOrientation } from "./semantic-resolver";
import { resolveLivingRoomComposition } from "./role-plan";

const geometry = createRectangleGeometry(500, 400, 250);
function item(id: string, role: FurniturePlanItemV11["semanticPlacement"]["role"], xCm: number, yCm: number): FurniturePlanItemV11 {
  return {
    id, category: "furniture", subtype: null, priority: "required",
    placement: { preferredZone: null, anchorWallId: role === "PRIMARY_SEATING" ? "wall-1" : null, approximatePosition: { xCm, yCm }, preferredOrientationDegrees: 0 },
    semanticPlacement: { role, mode: "FLOATING", alignment: null, zoneId: "primary-seating", targetWallId: role === "PRIMARY_SEATING" ? "wall-1" : null,
      relationships: role === "COFFEE_TABLE" ? [{ type: "IN_FRONT_OF", targetItemId: "seat" }] : [], fallbackModes: [] },
    sizeRange: { widthMinCm: 100, widthMaxCm: 100, depthMinCm: 40, depthMaxCm: 40, heightMinCm: 50, heightMaxCm: 100 },
    styleHints: [], materialHints: [], colorHints: [], functionalRequirements: [], reasoning: "Functional fixture",
  };
}
const plan = (items: FurniturePlanItemV11[]): FurniturePlanV11 => ({ schemaVersion: "1.1", roomIntent: "Functional", items, notes: [] });

test("coffee-table candidates extend the current resolved front position by bounded deltas", () => {
  const source = plan([item("seat", "PRIMARY_SEATING", 200, 80), item("table", "COFFEE_TABLE", 200, 154.9)]);
  const snapshot = structuredClone(source);
  const report = validateSpatialPlan(source, geometry);
  const violation = report.violations.find(isSupportedFunctionalViolation);
  assert.ok(violation);
  const candidates = generateFunctionalRepairCandidates(source, geometry, [], report, violation, () => []);
  assert.equal(candidates.length, 6);
  assert.deepEqual(candidates[0].changes[0].position, { xCm: 200, yCm: 159.9 });
  assert.deepEqual(candidates[5].changes[0].position, { xCm: 200, yCm: 199.9 });
  assert.ok(candidates.every((candidate) => candidate.itemId === "table" && candidate.strategy === "FUNCTIONAL_CLEARANCE"));
  assert.deepEqual(source, snapshot);
});

test("door candidate direction comes from room-side wall geometry and delegates wall policy", () => {
  const source = plan([item("obstacle", "STORAGE", 200, 50)]);
  const opening = { id: "door", openingType: "door" as const, wallSegmentId: "wall-1", offsetCm: 150, widthCm: 100, heightCm: 210, sillHeightCm: null, hingeSide: "left" as const, swingDirection: "inward" as const };
  const zones = deriveFunctionalZones(geometry);
  const report = validateSpatialPlan(source, geometry, [opening], zones);
  const violation = report.violations.find(isSupportedFunctionalViolation);
  assert.ok(violation);
  const candidates = generateFunctionalRepairCandidates(source, geometry, zones, report, violation, (entry, preferred) => {
    assert.deepEqual(preferred, { xCm: 200, yCm: 51 });
    return entry.placement.anchorWallId ? [{ xCm: 1, yCm: 0 }, { xCm: -1, yCm: 0 }] : [{ xCm: 0, yCm: 1 }];
  });
  assert.deepEqual(candidates[0].changes[0].position, { xCm: 200, yCm: 60 });
  assert.deepEqual(candidates[5].changes[0].position, { xCm: 200, yCm: 125 });
});

const zones = [{ ...deriveFunctionalZones(geometry)[0], center: { xCm: 350, yCm: 250 } }];
const opening = { id: "door", openingType: "door" as const, wallSegmentId: "wall-1", offsetCm: 350, widthCm: 100, heightCm: 210, sillHeightCm: null, hingeSide: "left" as const, swingDirection: "inward" as const };
function coffeePlan(gap = 34.9) {
  return plan([item("seat", "PRIMARY_SEATING", 200, 80), item("table", "COFFEE_TABLE", 200, 120 + gap)]);
}

test("34.9 cm coffee clearance repairs with the smallest front delta and preserves anchor/semantics/identity", () => {
  const source = coffeePlan();
  const table = { ...source.items[1], catalogIdentity: "unchanged-opaque-identity" };
  source.items[1] = table;
  const snapshot = structuredClone({ source, geometry, zones, opening });
  const result = repairSpatialPlan(source, geometry, [opening], zones);
  assert.equal(result.originalReport.summary.p0Count, 0);
  assert.equal(result.originalReport.summary.p1Count, 1);
  assert.equal(result.status, "REPAIRED");
  assert.equal(result.finalReport.status, "VALID");
  assert.deepEqual(result.changedItemIds, ["table"]);
  assert.deepEqual(result.repairedPlan.items[0], source.items[0]);
  assert.deepEqual(result.repairedPlan.items[1].placement.approximatePosition, { xCm: 200, yCm: 159.9 });
  assert.deepEqual({ ...result.repairedPlan.items[1], placement: table.placement }, table);
  const accepted = result.attempts.find((attempt) => attempt.accepted);
  assert.equal(accepted?.phase, "FUNCTIONAL");
  assert.equal(accepted?.strategy, "FUNCTIONAL_CLEARANCE");
  assert.equal(accepted?.movementCostCm, 5);
  assert.ok(result.attempts.filter((attempt) => attempt.accepted).every((attempt) => attempt.before.hardP0 === 0 && attempt.after.hardP0 === 0 && attempt.after.hardP1 < attempt.before.hardP1));
  assert.deepEqual(result.finalReport, validateSpatialPlan(result.repairedPlan, geometry, [opening], zones));
  assert.deepEqual(repairSpatialPlan(source, geometry, [opening], zones), result);
  const reversed = repairSpatialPlan({ ...source, items: [...source.items].reverse() }, geometry, [opening], zones);
  assert.deepEqual(reversed.attempts, result.attempts);
  assert.deepEqual(reversed.finalReport, result.finalReport);
  assert.deepEqual(reversed.changedItemIds, result.changedItemIds);
  assert.deepEqual({ source, geometry, zones, opening }, snapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test("rotated wall-derived sofa front moves table inward, not along arbitrary world Y", () => {
  const seat = item("seat", "PRIMARY_SEATING", 450, 200);
  seat.placement.preferredOrientationDegrees = 90;
  seat.placement.anchorWallId = "wall-2";
  seat.semanticPlacement.targetWallId = "wall-2";
  const table = item("table", "COFFEE_TABLE", 375.1, 200);
  table.placement.preferredOrientationDegrees = 90;
  const source = plan([seat, table]);
  const result = repairSpatialPlan(source, geometry, [opening], zones);
  assert.equal(result.originalReport.summary.p1Count, 1);
  assert.equal(result.finalReport.summary.p1Count, 0);
  assert.deepEqual(result.repairedPlan.items[0], seat);
  assert.deepEqual(result.repairedPlan.items[1].placement.approximatePosition, { xCm: 370.1, yCm: 200 });
  assert.deepEqual(result.repairedPlan.items[1].semanticPlacement, table.semanticPlacement);
});

test("coffee-table FACES and adjacent descendants propagate atomically with no retargeting", () => {
  const source = coffeePlan();
  source.items[1].semanticPlacement.relationships.push({ type: "FACES", targetItemId: "seat" });
  const child = item("child", "SECONDARY_SEATING", 350, 154.9);
  child.sizeRange = { ...child.sizeRange, widthMinCm: 40, widthMaxCm: 40 };
  child.semanticPlacement.relationships = [{ type: "ADJACENT_TO", targetItemId: "table" }, { type: "FACES", targetItemId: "table" }];
  source.items.push(child);
  const result = repairSpatialPlan(source, geometry, [opening], zones);
  assert.equal(result.finalReport.summary.p0Count, 0);
  assert.equal(result.finalReport.summary.p1Count, 0);
  const accepted = result.attempts.find((attempt) => attempt.accepted);
  assert.ok(accepted?.changedItemIds.includes("child"));
  const repaired = result.repairedPlan.items.find((entry) => entry.id === "child");
  const table = result.repairedPlan.items.find((entry) => entry.id === "table");
  assert.ok(repaired?.placement.approximatePosition && table?.placement.approximatePosition);
  assert.deepEqual(repaired.semanticPlacement, child.semanticPlacement);
  assert.equal(repaired.placement.preferredOrientationDegrees, computeFacesOrientation(repaired.placement.approximatePosition, table.placement.approximatePosition));
});

test("functional candidates introducing overlap are rejected and never become current", () => {
  const source = coffeePlan();
  source.items.push(item("blocking-storage", "STORAGE", 200, 197));
  const snapshot = structuredClone(source);
  const result = repairSpatialPlan(source, geometry, [opening], zones);
  assert.equal(result.originalReport.summary.p0Count, 0);
  assert.equal(result.originalReport.summary.p1Count, 1);
  assert.equal(result.status, "UNREPAIRABLE");
  assert.ok(result.attempts.every((attempt) => attempt.phase === "FUNCTIONAL" && attempt.after.hardP0 > 0 && !attempt.accepted));
  assert.deepEqual(result.repairedPlan, source);
  assert.deepEqual(result.finalReport, result.originalReport);
  assert.deepEqual(source, snapshot);
});

test("out-of-room functional candidates are rejected even if their table gap improves", () => {
  const room = createRectangleGeometry(500, 150, 250);
  const seat = item("seat", "PRIMARY_SEATING", 200, 45);
  const table = item("table", "COFFEE_TABLE", 200, 119.9);
  const result = repairSpatialPlan(plan([seat, table]), room);
  assert.equal(result.finalReport.summary.p0Count, 0);
  assert.equal(result.finalReport.summary.p1Count, 0);
  assert.equal(result.status, "PARTIALLY_REPAIRED");
  assert.equal(result.finalReport.status, "NOT_FULLY_EVALUATED");
  assert.ok(result.attempts.some((attempt) => attempt.after.hardP0 > 0 && !attempt.accepted));
});

test("equal P1 table-clearance to door-approach trades are rejected by count, not violation identity", () => {
  const seat = item("seat", "PRIMARY_SEATING", 450, 35);
  seat.sizeRange = { ...seat.sizeRange, widthMinCm: 40, widthMaxCm: 40 };
  const table = item("table", "COFFEE_TABLE", 450, 109.9);
  table.sizeRange = { ...table.sizeRange, widthMinCm: 40, widthMaxCm: 40 };
  const source = plan([seat, table]);
  const sideDoor = { ...opening, wallSegmentId: "wall-2", offsetCm: 130 };
  const result = repairSpatialPlan(source, geometry, [sideDoor], zones);
  assert.equal(result.originalReport.summary.p0Count, 0);
  assert.equal(result.originalReport.summary.p1Count, 1);
  assert.equal(result.status, "UNREPAIRABLE");
  assert.ok(result.attempts.every((attempt) => attempt.after.hardP0 === 0 && attempt.after.hardP1 === attempt.before.hardP1 && !attempt.accepted));
  assert.deepEqual(result.repairedPlan, source);
  assert.deepEqual(result.changedItemIds, []);
});

test("door-approach obstruction repairs inward without moving the authoritative door", () => {
  const obstacle = item("obstacle", "STORAGE", 400, 50);
  obstacle.sizeRange = { ...obstacle.sizeRange, widthMinCm: 40, widthMaxCm: 40, depthMinCm: 20, depthMaxCm: 20 };
  const source = plan([obstacle]);
  const snapshot = structuredClone({ source, geometry, opening, zones });
  const result = repairSpatialPlan(source, geometry, [opening], zones);
  assert.equal(result.originalReport.summary.p0Count, 0);
  assert.equal(result.status, "REPAIRED");
  assert.equal(result.finalReport.circulation.status, "PASS");
  assert.deepEqual(result.repairedPlan.items[0].placement.approximatePosition, { xCm: 400, yCm: 95 });
  assert.equal(result.attempts.find((attempt) => attempt.accepted)?.strategy, "DOOR_APPROACH");
  assert.deepEqual({ source, geometry, opening, zones }, snapshot);
});

test("wall-anchored approach obstruction only moves along the tangent", () => {
  const obstacle = item("wall-storage", "STORAGE", 400, 50);
  obstacle.placement.anchorWallId = "wall-1";
  obstacle.semanticPlacement.mode = "NEAR_WALL";
  obstacle.semanticPlacement.targetWallId = "wall-1";
  obstacle.sizeRange = { ...obstacle.sizeRange, widthMinCm: 40, widthMaxCm: 40, depthMinCm: 20, depthMaxCm: 20 };
  const result = repairSpatialPlan(plan([obstacle]), geometry, [opening], zones);
  assert.equal(result.status, "REPAIRED");
  assert.ok(result.attempts.every((attempt) => attempt.offset.dyCm === 0));
  assert.equal(result.repairedPlan.items[0].placement.approximatePosition?.yCm, 50);
  assert.equal(result.repairedPlan.items[0].placement.anchorWallId, "wall-1");
  assert.deepEqual(result.repairedPlan.items[0].semanticPlacement, obstacle.semanticPlacement);
});

test("door approach protects a primary anchor instead of freely destroying its composition intent", () => {
  const primary = item("primary", "PRIMARY_SEATING", 400, 50);
  primary.sizeRange = { ...primary.sizeRange, depthMinCm: 20, depthMaxCm: 20 };
  const source = plan([primary]);
  const result = repairSpatialPlan(source, geometry, [opening], zones);
  assert.equal(result.originalReport.summary.p0Count, 0);
  assert.equal(result.status, "NOT_REPAIRABLE");
  assert.deepEqual(result.attempts, []);
  assert.deepEqual(result.repairedPlan, source);
});

test("physical doorway conflict cannot enter the functional approach phase", () => {
  const obstacle = item("physical-door", "STORAGE", 400, 20);
  const result = repairSpatialPlan(plan([obstacle]), geometry, [opening], zones);
  assert.equal(result.originalReport.violations[0].type, "DOOR_CONFLICT");
  assert.equal(result.status, "NOT_REPAIRABLE");
  assert.deepEqual(result.attempts, []);
});

test("two independent P1 failures improve monotonically across canonical iterations", () => {
  const source = coffeePlan();
  source.items[0].id = "a-seat";
  source.items[1].id = "b-table";
  source.items[1].semanticPlacement.relationships[0].targetItemId = "a-seat";
  const obstacle = item("z-obstacle", "STORAGE", 400, 50);
  obstacle.sizeRange = { ...obstacle.sizeRange, widthMinCm: 40, widthMaxCm: 40, depthMinCm: 20, depthMaxCm: 20 };
  source.items.push(obstacle);
  const result = repairSpatialPlan(source, geometry, [opening], zones);
  assert.equal(result.originalReport.summary.p1Count, 2);
  assert.equal(result.status, "REPAIRED");
  const accepted = result.attempts.filter((attempt) => attempt.accepted);
  assert.deepEqual(accepted.map((attempt) => [attempt.before.hardP1, attempt.after.hardP1]), [[2, 1], [1, 0]]);
  assert.ok(accepted.every((attempt) => attempt.phase === "FUNCTIONAL" && attempt.after.hardP0 === 0));
  assert.deepEqual(result.changedItemIds, ["b-table", "z-obstacle"]);
});

test("physical repair reaches zero before functional repair and shares the original budget", () => {
  const source = coffeePlan();
  const outside = item("outside", "STORAGE", 20, 300);
  outside.sizeRange = { ...outside.sizeRange, widthMinCm: 80, widthMaxCm: 80 };
  source.items.push(outside);
  const result = repairSpatialPlan(source, geometry, [opening], zones);
  assert.equal(result.status, "REPAIRED");
  const accepted = result.attempts.filter((attempt) => attempt.accepted);
  assert.deepEqual(accepted.map((attempt) => attempt.phase), ["PHYSICAL", "FUNCTIONAL"]);
  assert.equal(accepted[1].before.hardP0, 0);
  const capped = repairSpatialPlan(source, geometry, [opening], zones, { limits: { maxTotalCandidateEvaluations: 40 } });
  assert.equal(capped.status, "PARTIALLY_REPAIRED");
  assert.equal(capped.attempts.length, 40);
  assert.ok(capped.attempts.every((attempt) => attempt.phase === "PHYSICAL"));
  assert.equal(capped.finalReport.summary.p0Count, 0);
  assert.equal(capped.finalReport.summary.p1Count, 1);
  assert.equal(capped.diagnostics.terminationReason, "MAX_TOTAL_CANDIDATE_EVALUATIONS");
});

test("partial functional improvement keeps a remaining protected P1 failure explicit", () => {
  const source = coffeePlan();
  const primary = item("protected-primary", "PRIMARY_SEATING", 400, 50);
  primary.sizeRange = { ...primary.sizeRange, depthMinCm: 20, depthMaxCm: 20 };
  source.items.push(primary);
  const result = repairSpatialPlan(source, geometry, [opening], zones);
  assert.equal(result.originalReport.summary.p1Count, 2);
  assert.equal(result.status, "PARTIALLY_REPAIRED");
  assert.equal(result.finalReport.summary.p0Count, 0);
  assert.equal(result.finalReport.summary.p1Count, 1);
  assert.deepEqual(result.repairedPlan.items[2], primary);
});

test("a physically valid circulation barrier opens only when the existing A.3 route validator confirms it", () => {
  const room = createRectangleGeometry(400, 400, 250);
  const targetZones = [{ ...deriveFunctionalZones(room)[0], center: { xCm: 200, yCm: 330 } }];
  const entry = { ...opening, offsetCm: 150 };
  const barrier = item("floating-barrier", "STORAGE", 200, 200);
  barrier.sizeRange = { ...barrier.sizeRange, widthMinCm: 300, widthMaxCm: 300 };
  const rug = item("floor-rug", "AREA_RUG", 200, 200);
  rug.sizeRange = { ...rug.sizeRange, widthMinCm: 360, widthMaxCm: 360, depthMinCm: 360, depthMaxCm: 360 };
  const source = plan([barrier, rug]);
  const result = repairSpatialPlan(source, room, [entry], targetZones);
  assert.equal(result.originalReport.summary.p0Count, 0);
  assert.equal(result.originalReport.circulation.status, "BLOCKED");
  assert.equal(result.status, "REPAIRED");
  assert.equal(result.finalReport.circulation.status, "PASS");
  assert.deepEqual(result.changedItemIds, ["floating-barrier"]);
  assert.ok(result.attempts.every((attempt) => attempt.itemId !== "floor-rug"));
  assert.ok(result.attempts.some((attempt) => !attempt.accepted && attempt.after.hardP1 === attempt.before.hardP1));
  assert.ok(result.attempts.some((attempt) => !attempt.accepted && attempt.after.hardP0 > 0));
  assert.deepEqual(result.finalReport, validateSpatialPlan(result.repairedPlan, room, [entry], targetZones));
});

test("circulation obstacle ranking prefers ordinary floating furniture over primary seating", () => {
  const room = createRectangleGeometry(400, 400, 250);
  const targetZones = [{ ...deriveFunctionalZones(room)[0], center: { xCm: 200, yCm: 330 } }];
  const entry = { ...opening, offsetCm: 150 };
  const barrier = item("ordinary", "STORAGE", 200, 200);
  barrier.sizeRange = { ...barrier.sizeRange, widthMinCm: 300, widthMaxCm: 300 };
  const primary = item("primary", "PRIMARY_SEATING", 330, 320);
  primary.placement.anchorWallId = null;
  primary.sizeRange = { ...primary.sizeRange, widthMinCm: 40, widthMaxCm: 40, depthMinCm: 40, depthMaxCm: 40 };
  const result = repairSpatialPlan(plan([primary, barrier]), room, [entry], targetZones);
  assert.equal(result.finalReport.circulation.status, "PASS");
  assert.ok(result.attempts.every((attempt) => attempt.itemId !== "primary"));
  assert.deepEqual(result.repairedPlan.items[0], primary);
});

test("functional iteration bound stops after a strict partial improvement without a second budget", () => {
  const source = coffeePlan();
  source.items[0].id = "a-seat";
  source.items[1].semanticPlacement.relationships[0].targetItemId = "a-seat";
  const obstacle = item("z-obstacle", "STORAGE", 400, 50);
  obstacle.sizeRange = { ...obstacle.sizeRange, widthMinCm: 40, widthMaxCm: 40, depthMinCm: 20, depthMaxCm: 20 };
  source.items.push(obstacle);
  const result = repairSpatialPlan(source, geometry, [opening], zones, { limits: { maxIterations: 1 } });
  assert.equal(result.status, "PARTIALLY_REPAIRED");
  assert.equal(result.finalReport.summary.p1Count, 1);
  assert.equal(result.diagnostics.terminationReason, "MAX_ITERATIONS");
  assert.ok(result.diagnostics.exhaustedLimits.includes("maxIterations"));
});

test("missing circulation prerequisites cannot be repaired into a false VALID report", () => {
  const result = repairSpatialPlan(plan([item("clean", "STORAGE", 200, 200)]), geometry);
  assert.equal(result.status, "NOT_REPAIRABLE");
  assert.equal(result.finalReport.status, "NOT_FULLY_EVALUATED");
  assert.equal(result.finalReport.circulation.status, "NOT_EVALUATED");
  assert.deepEqual(result.attempts, []);
});

test("canonical A.2.3 result still has one P0, so it never enters the functional phase", () => {
  const room = createRectangleGeometry(500, 400, 250);
  const entry = { ...opening, id: "entry" };
  const composed = resolveLivingRoomComposition({ geometry: room, mustHaveItems: ["sofa", "chair", "chair"] }, [entry]);
  const snapshot = structuredClone(composed);
  const result = repairSpatialPlan(composed.plan, room, [entry], composed.zones);
  assert.equal(result.originalReport.summary.p0Count, 3);
  assert.equal(result.finalReport.summary.p0Count, 1);
  assert.equal(result.finalReport.summary.p1Count, 1);
  assert.equal(result.status, "PARTIALLY_REPAIRED");
  assert.ok(result.attempts.every((attempt) => attempt.phase === "PHYSICAL"));
  assert.deepEqual(composed, snapshot);
});

test("clearance beyond 50 cm remains valid and performs no aesthetic repair", () => {
  const source = coffeePlan(60);
  const result = repairSpatialPlan(source, geometry, [opening], zones);
  assert.equal(result.status, "UNCHANGED_VALID");
  assert.deepEqual(result.attempts, []);
  assert.deepEqual(result.repairedPlan, source);
});

test("vertical door approach movement follows its inward normal", () => {
  const obstacle = item("vertical-obstacle", "STORAGE", 450, 200);
  obstacle.sizeRange = { ...obstacle.sizeRange, widthMinCm: 20, widthMaxCm: 20, depthMinCm: 40, depthMaxCm: 40 };
  const sideDoor = { ...opening, wallSegmentId: "wall-2", offsetCm: 150 };
  const result = repairSpatialPlan(plan([obstacle]), geometry, [sideDoor], zones);
  assert.equal(result.status, "REPAIRED");
  assert.deepEqual(result.repairedPlan.items[0].placement.approximatePosition, { xCm: 405, yCm: 200 });
  assert.equal(result.attempts.find((attempt) => attempt.accepted)?.strategy, "DOOR_APPROACH");
});

test("relational door obstruction uses anchor-relative sides and retains FACES", () => {
  const seat = item("seat", "PRIMARY_SEATING", 100, 50);
  seat.sizeRange = { ...seat.sizeRange, widthMinCm: 80, widthMaxCm: 80 };
  const dependent = item("dependent", "SECONDARY_SEATING", 400, 50);
  dependent.sizeRange = { ...dependent.sizeRange, widthMinCm: 40, widthMaxCm: 40, depthMinCm: 20, depthMaxCm: 20 };
  dependent.semanticPlacement.relationships = [{ type: "ADJACENT_TO", targetItemId: seat.id }, { type: "FACES", targetItemId: seat.id }];
  const result = repairSpatialPlan(plan([seat, dependent]), geometry, [opening], zones);
  assert.equal(result.status, "REPAIRED");
  assert.deepEqual(result.repairedPlan.items[0], seat);
  assert.deepEqual(result.repairedPlan.items[1].placement.approximatePosition, { xCm: 230, yCm: 50 });
  assert.equal(result.repairedPlan.items[1].placement.preferredOrientationDegrees, 90);
  assert.deepEqual(result.repairedPlan.items[1].semanticPlacement, dependent.semanticPlacement);
});

test("door repair rejects overlap-producing moves while retaining a valid alternative", () => {
  const obstacle = item("obstacle", "STORAGE", 400, 50);
  const blocker = item("nearby-storage", "STORAGE", 400, 95);
  for (const entry of [obstacle, blocker]) entry.sizeRange = { ...entry.sizeRange, widthMinCm: 40, widthMaxCm: 40, depthMinCm: 20, depthMaxCm: 20 };
  const result = repairSpatialPlan(plan([obstacle, blocker]), geometry, [opening], zones);
  assert.equal(result.originalReport.summary.p0Count, 0);
  assert.equal(result.status, "REPAIRED");
  assert.ok(result.attempts.some((attempt) => attempt.strategy === "DOOR_APPROACH" && attempt.after.hardP0 > 0 && !attempt.accepted));
  assert.ok(result.attempts.filter((attempt) => attempt.accepted).every((attempt) => attempt.after.hardP0 === 0));
});

test("circulation obstacle ties and candidate order use stable IDs independent of input order", () => {
  const room = createRectangleGeometry(400, 400, 250);
  const targetZones = [{ ...deriveFunctionalZones(room)[0], center: { xCm: 200, yCm: 330 } }];
  const entry = { ...opening, offsetCm: 150 };
  const first = item("a", "STORAGE", 200, 160);
  const second = item("b", "STORAGE", 200, 240);
  for (const obstacle of [first, second]) obstacle.sizeRange = { ...obstacle.sizeRange, widthMinCm: 300, widthMaxCm: 300 };
  const source = plan([second, first]);
  const result = repairSpatialPlan(source, room, [entry], targetZones);
  assert.equal(result.status, "UNREPAIRABLE");
  assert.deepEqual(result.repairedPlan, source);
  assert.ok(result.attempts.every((attempt) => !attempt.accepted));
  assert.ok(result.attempts.some((attempt) => attempt.after.hardP0 === 0 && attempt.after.hardP1 === attempt.before.hardP1));
  assert.deepEqual(result.attempts.slice(0, 2).map((attempt) => attempt.itemId), ["a", "b"]);
  assert.ok(result.attempts.every((attempt) => attempt.strategy === "CIRCULATION"));
  const reversed = repairSpatialPlan({ ...source, items: [...source.items].reverse() }, room, [entry], targetZones);
  assert.deepEqual(reversed.attempts, result.attempts);
  assert.deepEqual(reversed.finalReport, result.finalReport);
});

test("functional repairs exhaust the same total cap rather than receiving a hidden second budget", () => {
  const source = coffeePlan();
  const obstacle = item("z-obstacle", "STORAGE", 400, 50);
  obstacle.sizeRange = { ...obstacle.sizeRange, widthMinCm: 40, widthMaxCm: 40, depthMinCm: 20, depthMaxCm: 20 };
  source.items.push(obstacle);
  const result = repairSpatialPlan(source, geometry, [opening], zones, { limits: { maxTotalCandidateEvaluations: 1 } });
  assert.equal(result.status, "PARTIALLY_REPAIRED");
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].phase, "FUNCTIONAL");
  assert.equal(result.finalReport.summary.p0Count, 0);
  assert.equal(result.finalReport.summary.p1Count, 1);
  assert.equal(result.diagnostics.terminationReason, "MAX_TOTAL_CANDIDATE_EVALUATIONS");
});

test("opening permutations preserve reports and functional attempt ordering without mutating inputs", () => {
  const source = coffeePlan();
  const openings = [opening, { ...opening, id: "secondary", wallSegmentId: "wall-3" }];
  const snapshot = structuredClone({ source, openings, zones, geometry });
  const result = repairSpatialPlan(source, geometry, openings, zones);
  assert.deepEqual(repairSpatialPlan(source, geometry, [...openings].reverse(), zones), result);
  assert.deepEqual({ source, openings, zones, geometry }, snapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});