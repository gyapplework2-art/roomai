import { GEOMETRY_EPSILON, getWallEndpoints, getWallLengthCm } from "@/lib/geometry/dimensions";
import { isPointInsideOrOnPolygon } from "@/lib/geometry/point-in-polygon";
import type { Point } from "@/lib/geometry/polygons";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";
import { validateSpatialPlan, type SpatialViolation } from "./spatial-validator";
import type { WholeRoomValidationReport } from "./spatial-validation-report";
import type { AnyFurniturePlan, AnyFurniturePlanItem, FurniturePlanItemV1 } from "./types";
import { deriveFunctionalZones, type FunctionalZone } from "./zones";
import { buildRepairRelationshipView, completeRelationshipChanges, generateRelationshipRepairCandidates, type RelationshipChange, type RelationshipCandidate } from "./repair-relationships";

export const SPATIAL_REPAIR_LIMITS = { maxIterations: 8, maxCandidatesPerIteration: 40, maxTotalCandidateEvaluations: 200 } as const;
export const LOCAL_REPAIR_DISTANCES_CM = [10, 20, 30, 45, 60] as const;
export type RepairLimits = { maxIterations: number; maxCandidatesPerIteration: number; maxTotalCandidateEvaluations: number };
export type RepairScore = { hardP0: number; hardP1: number; totalHard: number; totalViolations: number };
type RepairableViolation = Extract<SpatialViolation, { type: "FURNITURE_OVERLAP" | "OUTSIDE_ROOM" }>;
type Offset = { dxCm: number; dyCm: number };
type WallConstraint = { tangent: Point; start: Point; lengthCm: number };
export type SpatialRepairAttempt = {
  strategy: "LOCAL_TRANSLATION" | RelationshipCandidate["strategy"];
  changedItemIds: string[];
  relationshipContext: RelationshipCandidate["context"];
  movements: Array<{ itemId: string; offset: Offset; orientationChange: { before: number | null; after: number | null } | null }>;
  movementCostCm: number;
  iteration: number;
  violationId: string;
  violationType: RepairableViolation["type"];
  itemId: string;
  candidateIndex: number;
  movementDistanceCm: number;
  offset: Offset;
  accepted: boolean;
  reason: "ACCEPTED" | "NO_P0_IMPROVEMENT" | "CENTER_OUTSIDE_ROOM" | "WALL_SPAN_CONSTRAINT" | "NOT_SELECTED";
  before: RepairScore;
  after: RepairScore;
};

export type SpatialRepairResult<Plan extends AnyFurniturePlan = AnyFurniturePlan> = {
  status: "UNCHANGED_VALID" | "REPAIRED" | "PARTIALLY_REPAIRED" | "UNREPAIRABLE" | "NOT_REPAIRABLE";
  originalPlan: Plan;
  repairedPlan: Plan;
  originalReport: WholeRoomValidationReport;
  finalReport: WholeRoomValidationReport;
  attempts: SpatialRepairAttempt[];
  changedItemIds: string[];
  limits: RepairLimits;
  diagnostics: {
    terminationReason: "ALREADY_VALID" | "NO_REPAIRABLE_P0" | "NO_MOVABLE_TARGET" | "NO_STRICT_IMPROVEMENT" | "PHYSICAL_FAILURES_RESOLVED" | "MAX_ITERATIONS" | "MAX_CANDIDATES_PER_ITERATION" | "MAX_TOTAL_CANDIDATE_EVALUATIONS";
    iterationsCompleted: number;
    totalCandidateEvaluations: number;
    exhaustedLimits: Array<keyof RepairLimits>;
    suppliedReportRevalidated: boolean;
  };
};

export type SpatialRepairOptions = { report?: WholeRoomValidationReport; limits?: Partial<RepairLimits>; relationshipRepairs?: boolean };

export function getRepairScore(report: WholeRoomValidationReport): RepairScore {
  return {
    hardP0: report.violations.filter((violation) => violation.priority === "P0" && violation.classification === "hard").length,
    hardP1: report.violations.filter((violation) => violation.priority === "P1" && violation.classification === "hard").length,
    totalHard: report.summary.hardCount,
    totalViolations: report.summary.totalViolations,
  };
}

export function compareRepairScores(first: RepairScore, second: RepairScore): number {
  return first.hardP0 - second.hardP0 || first.hardP1 - second.hardP1
    || first.totalHard - second.totalHard || first.totalViolations - second.totalViolations;
}

function copyItem<Item extends FurniturePlanItemV1>(item: Item): Item {
  return {
    ...item,
    placement: { ...item.placement, approximatePosition: item.placement.approximatePosition ? { ...item.placement.approximatePosition } : null },
    sizeRange: { ...item.sizeRange },
    styleHints: [...item.styleHints], materialHints: [...item.materialHints], colorHints: [...item.colorHints],
    functionalRequirements: [...item.functionalRequirements],
  };
}

function copyPlan<Plan extends AnyFurniturePlan>(plan: Plan): Plan {
  if (plan.schemaVersion === "1.1") return {
    ...plan, notes: [...plan.notes], items: plan.items.map((item) => ({
      ...copyItem(item), semanticPlacement: {
        ...item.semanticPlacement,
        relationships: item.semanticPlacement.relationships.map((relationship) => ({ ...relationship })),
        fallbackModes: [...item.semanticPlacement.fallbackModes],
      },
    })),
  };
  return { ...plan, notes: [...plan.notes], items: plan.items.map(copyItem) };
}

/** Smaller rank is more protected; equal protection preserves the lexically smaller plan ID. */
function protectionRank(item: AnyFurniturePlanItem): number {
  const role = "semanticPlacement" in item ? item.semanticPlacement.role : null;
  if (item.placement.anchorWallId && role === "PRIMARY_SEATING") return 0;
  if (role === "PRIMARY_SEATING") return 1;
  if (item.placement.anchorWallId) return 2;
  if (role === "COFFEE_TABLE" || role === "AREA_RUG") return 3;
  if ("semanticPlacement" in item && item.semanticPlacement.relationships.length > 0) return 4;
  return 5;
}

function wallConstraint(item: AnyFurniturePlanItem, geometry: RoomGeometry): WallConstraint | null | "PROTECTED" {
  const anchor = item.placement.anchorWallId;
  const semantic = "semanticPlacement" in item ? item.semanticPlacement : null;
  const wallMode = semantic && ["AGAINST_WALL", "NEAR_WALL", "CORNER_PLACEMENT"].includes(semantic.mode);
  if (!anchor) return wallMode ? "PROTECTED" : null;
  if (semantic?.targetWallId && semantic.targetWallId !== anchor) return "PROTECTED";
  const wall = geometry.wallSegments.find((candidate) => candidate.id === anchor);
  if (!wall) return "PROTECTED";
  const endpoints = getWallEndpoints(geometry, wall);
  const length = getWallLengthCm(geometry, wall);
  if (!endpoints || !length || !Number.isFinite(length) || length <= GEOMETRY_EPSILON) return "PROTECTED";
  return {
    tangent: { xCm: (endpoints.end.xCm - endpoints.start.xCm) / length, yCm: (endpoints.end.yCm - endpoints.start.yCm) / length },
    start: { xCm: endpoints.start.xCm, yCm: endpoints.start.yCm }, lengthCm: length,
  };
}

function selectTarget(plan: AnyFurniturePlan, report: WholeRoomValidationReport, geometry: RoomGeometry) {
  for (const violation of report.violations) {
    if (violation.type !== "OUTSIDE_ROOM" && violation.type !== "FURNITURE_OVERLAP") continue;
    const involved: AnyFurniturePlanItem[] = plan.items.filter((item) => violation.itemIds.includes(item.id));
    involved.sort((first, second) => protectionRank(second) - protectionRank(first)
      || (first.id < second.id ? 1 : first.id > second.id ? -1 : 0));
    for (const item of involved) {
      const position = item.placement.approximatePosition;
      if (!position || !Number.isFinite(position.xCm) || !Number.isFinite(position.yCm)) continue;
      const wall = wallConstraint(item, geometry);
      if (wall === "PROTECTED") continue;
      if (wall === null && "semanticPlacement" in item && !["FLOATING", "CENTERED_IN_ZONE"].includes(item.semanticPlacement.mode)) continue;
      return { item, violation, wall, other: involved.find((candidate) => candidate.id !== item.id) };
    }
  }
  return null;
}

const standardDirections: readonly Point[] = [
  { xCm: 1, yCm: 0 }, { xCm: -1, yCm: 0 }, { xCm: 0, yCm: 1 }, { xCm: 0, yCm: -1 },
  { xCm: Math.SQRT1_2, yCm: Math.SQRT1_2 }, { xCm: Math.SQRT1_2, yCm: -Math.SQRT1_2 },
  { xCm: -Math.SQRT1_2, yCm: Math.SQRT1_2 }, { xCm: -Math.SQRT1_2, yCm: -Math.SQRT1_2 },
];

function localDirections(position: Point, preferred: Point | undefined, tangent: Point | null): Point[] {
  if (tangent) return [tangent, { xCm: -tangent.xCm, yCm: -tangent.yCm }];
  const directions: Point[] = [];
  if (preferred) {
    const deltaX = preferred.xCm - position.xCm;
    const deltaY = preferred.yCm - position.yCm;
    const length = Math.hypot(deltaX, deltaY);
    if (length > GEOMETRY_EPSILON) directions.push({ xCm: deltaX / length, yCm: deltaY / length });
  }
  for (const direction of standardDirections) {
    if (!directions.some((existing) => Math.hypot(existing.xCm - direction.xCm, existing.yCm - direction.yCm) <= GEOMETRY_EPSILON)) directions.push(direction);
  }
  return directions.slice(0, standardDirections.length);
}

/** Positional relationships use coordinated then single candidates; ordinary local movement remains unchanged.
 * Existing FACES alone permits orientation updates; every complete candidate is certified only by A.3.
 * relationshipRepairs:false is the A.4.1 compatibility mode, not a separate engine.
 */
export function repairSpatialPlan<Plan extends AnyFurniturePlan>(
  plan: Plan,
  geometry: RoomGeometry,
  openings: readonly RoomOpening[] = [],
  zones: readonly FunctionalZone[] = [],
  options: SpatialRepairOptions = {},
): SpatialRepairResult<Plan> {
  const limits: RepairLimits = { ...SPATIAL_REPAIR_LIMITS, ...options.limits };
  for (const key of ["maxIterations", "maxCandidatesPerIteration", "maxTotalCandidateEvaluations"] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > SPATIAL_REPAIR_LIMITS[key]) throw new Error("INVALID_REPAIR_LIMITS");
  }
  const originalPlan = copyPlan(plan);
  const originalReport = validateSpatialPlan(originalPlan, geometry, openings, zones);
  let currentPlan = copyPlan(originalPlan);
  let currentReport = originalReport;
  const attempts: SpatialRepairAttempt[] = [];
  const changed = new Set<string>();
  const exhausted = new Set<keyof RepairLimits>();
  let acceptedCount = 0;
  let iterationsCompleted = 0;
  let terminationReason: SpatialRepairResult["diagnostics"]["terminationReason"] = "ALREADY_VALID";
  const interiorReference = originalReport.status === "VALID" ? undefined : deriveFunctionalZones(geometry)[0]?.center;

  if (originalReport.status !== "VALID") {
    terminationReason = "MAX_ITERATIONS";
    for (let iteration = 1; iteration <= limits.maxIterations; iteration += 1) {
      if (getRepairScore(currentReport).hardP0 === 0) { terminationReason = acceptedCount > 0 ? "PHYSICAL_FAILURES_RESOLVED" : "NO_REPAIRABLE_P0"; break; }
      if (attempts.length >= limits.maxTotalCandidateEvaluations) { exhausted.add("maxTotalCandidateEvaluations"); terminationReason = "MAX_TOTAL_CANDIDATE_EVALUATIONS"; break; }
      if (!currentReport.violations.some((violation) => violation.type === "OUTSIDE_ROOM" || violation.type === "FURNITURE_OVERLAP")) {
        terminationReason = "NO_REPAIRABLE_P0";
        break;
      }
      const target = selectTarget(currentPlan, currentReport, geometry);
      if (!target) { terminationReason = "NO_MOVABLE_TARGET"; break; }
      const position = target.item.placement.approximatePosition;
      if (!position) break;
      const otherPosition = target.other?.placement.approximatePosition;
      const preferred = target.violation.type === "OUTSIDE_ROOM" ? interiorReference : otherPosition ? {
        xCm: position.xCm * 2 - otherPosition.xCm, yCm: position.yCm * 2 - otherPosition.yCm,
      } : undefined;
      const relationshipView = options.relationshipRepairs === false ? null : buildRepairRelationshipView(currentPlan);
      const relationshipNode = relationshipView?.nodes.find((node) => node.itemId === target.item.id);
      const semantic = "semanticPlacement" in target.item ? target.item.semanticPlacement : null;
      const hasPositionalIntent = semantic && !target.wall && semantic.relationships.some((relationship) => relationship.type === "IN_FRONT_OF" || relationship.type === "ADJACENT_TO");
      const candidates: Array<{ strategy: SpatialRepairAttempt["strategy"]; distance: number; offset: Offset; changes: RelationshipChange[]; context: RelationshipCandidate["context"] }> = [];
      if (options.relationshipRepairs !== false && hasPositionalIntent) {
        for (const candidate of generateRelationshipRepairCandidates(currentPlan, target.item.id, geometry)) {
          const change = candidate.changes.find((member) => member.itemId === target.item.id);
          if (!change) continue;
          const offset = { dxCm: change.position.xCm - position.xCm, dyCm: change.position.yCm - position.yCm };
          candidates.push({ ...candidate, distance: Math.hypot(offset.dxCm, offset.dyCm), offset });
        }
      } else if (options.relationshipRepairs === false || !semantic?.relationships.length || relationshipNode?.status === "READY") {
        for (const distance of LOCAL_REPAIR_DISTANCES_CM) for (const direction of localDirections(position, preferred, target.wall?.tangent ?? null)) {
          const offset = { dxCm: direction.xCm * distance, dyCm: direction.yCm * distance };
          const seed = { itemId: target.item.id, position: { xCm: position.xCm + offset.dxCm, yCm: position.yCm + offset.dyCm }, orientationDegrees: target.item.placement.preferredOrientationDegrees };
          const changes = options.relationshipRepairs === false ? [seed] : completeRelationshipChanges(currentPlan, [seed], geometry);
          if (!changes) continue;
          const context = changes.flatMap((change) => {
            const node = relationshipView?.nodes.find((member) => member.itemId === change.itemId);
            return [node?.positional, node?.faces].flatMap((relationship) => relationship ? [{ itemId: change.itemId, type: relationship.type, targetItemId: relationship.targetItemId }] : []);
          });
          candidates.push({ strategy: changes.length > 1 ? "RELATIONSHIP_COORDINATED" : context.length ? "RELATIONSHIP_SINGLE" : "LOCAL_TRANSLATION", distance, offset, changes, context });
        }
      }
      const before = getRepairScore(currentReport);
      let best: { plan: Plan; report: WholeRoomValidationReport; score: RepairScore; attempt: SpatialRepairAttempt } | null = null;
      const budget = Math.min(limits.maxCandidatesPerIteration, limits.maxTotalCandidateEvaluations - attempts.length);
      iterationsCompleted = iteration;
      if (budget < candidates.length) exhausted.add(budget < limits.maxCandidatesPerIteration ? "maxTotalCandidateEvaluations" : "maxCandidatesPerIteration");
      for (const [index, candidate] of candidates.slice(0, budget).entries()) {
        const candidatePlan = copyPlan(currentPlan);
        const movements: SpatialRepairAttempt["movements"] = [];
        for (const change of candidate.changes) {
          const moving = candidatePlan.items.find((item) => item.id === change.itemId);
          const original = currentPlan.items.find((item) => item.id === change.itemId);
          const originalPosition = original?.placement.approximatePosition;
          if (!moving || !original || !originalPosition) continue;
          const offset = { dxCm: change.position.xCm - originalPosition.xCm, dyCm: change.position.yCm - originalPosition.yCm };
          const orientationChange = change.orientationDegrees === original.placement.preferredOrientationDegrees ? null : {
            before: original.placement.preferredOrientationDegrees, after: change.orientationDegrees,
          };
          moving.placement.approximatePosition = { ...change.position };
          moving.placement.preferredOrientationDegrees = change.orientationDegrees;
          if (offset.dxCm !== 0 || offset.dyCm !== 0 || orientationChange) movements.push({ itemId: change.itemId, offset, orientationChange });
        }
        const report = validateSpatialPlan(candidatePlan, geometry, openings, zones);
        const after = getRepairScore(report);
        const centerInside = candidate.changes.every((change) => isPointInsideOrOnPolygon(change.position, geometry.vertices));
        const wallSpanAllowed = candidate.changes.every((change) => {
          const source = currentPlan.items.find((item) => item.id === change.itemId);
          if (!source) return false;
          const wall = wallConstraint(source, geometry);
          if (wall === "PROTECTED") return false;
          if (!wall) return true;
          const wallDistance = (change.position.xCm - wall.start.xCm) * wall.tangent.xCm + (change.position.yCm - wall.start.yCm) * wall.tangent.yCm;
          return wallDistance >= -GEOMETRY_EPSILON && wallDistance <= wall.lengthCm + GEOMETRY_EPSILON;
        });
        const admissible = centerInside && wallSpanAllowed;
        const improving = after.hardP0 < before.hardP0 && compareRepairScores(after, before) < 0;
        const attempt: SpatialRepairAttempt = {
          strategy: candidate.strategy, changedItemIds: movements.map((movement) => movement.itemId).sort(),
          relationshipContext: candidate.context, movements,
          movementCostCm: movements.reduce((sum, movement) => sum + Math.hypot(movement.offset.dxCm, movement.offset.dyCm), 0),
          iteration, violationId: target.violation.id, violationType: target.violation.type,
          itemId: target.item.id, candidateIndex: index + 1, movementDistanceCm: candidate.distance, offset: candidate.offset,
          accepted: false, reason: !centerInside ? "CENTER_OUTSIDE_ROOM" : !wallSpanAllowed ? "WALL_SPAN_CONSTRAINT" : !improving ? "NO_P0_IMPROVEMENT" : "NOT_SELECTED", before, after,
        };
        attempts.push(attempt);
        if (!admissible || !improving) continue;
        if (!best || compareRepairScores(after, best.score) < 0
          || (compareRepairScores(after, best.score) === 0 && attempt.movementCostCm < best.attempt.movementCostCm)) {
          best = { plan: candidatePlan, report, score: after, attempt };
        }
      }
      if (!best) {
        terminationReason = budget < candidates.length
          ? exhausted.has("maxTotalCandidateEvaluations") ? "MAX_TOTAL_CANDIDATE_EVALUATIONS" : "MAX_CANDIDATES_PER_ITERATION"
          : "NO_STRICT_IMPROVEMENT";
        break;
      }
      best.attempt.accepted = true;
      best.attempt.reason = "ACCEPTED";
      currentPlan = best.plan;
      currentReport = best.report;
      for (const id of best.attempt.changedItemIds) changed.add(id);
      acceptedCount += 1;
      if (getRepairScore(currentReport).hardP0 === 0) { terminationReason = "PHYSICAL_FAILURES_RESOLVED"; break; }
      if (iteration === limits.maxIterations) exhausted.add("maxIterations");
    }
  }
  const finalReport = validateSpatialPlan(currentPlan, geometry, openings, zones);
  const status: SpatialRepairResult["status"] = originalReport.status === "VALID" ? "UNCHANGED_VALID"
    : acceptedCount > 0 ? finalReport.status === "VALID" ? "REPAIRED" : "PARTIALLY_REPAIRED"
    : attempts.length > 0 ? "UNREPAIRABLE" : "NOT_REPAIRABLE";
  const changedItemIds = [...changed].filter((id) => {
    const original = originalPlan.items.find((item) => item.id === id)?.placement.approximatePosition;
    const final = currentPlan.items.find((item) => item.id === id)?.placement.approximatePosition;
    const originalOrientation = originalPlan.items.find((item) => item.id === id)?.placement.preferredOrientationDegrees;
    const finalOrientation = currentPlan.items.find((item) => item.id === id)?.placement.preferredOrientationDegrees;
    return original?.xCm !== final?.xCm || original?.yCm !== final?.yCm || originalOrientation !== finalOrientation;
  }).sort();
  return {
    status, originalPlan, repairedPlan: currentPlan, originalReport, finalReport, attempts,
    changedItemIds, limits,
    diagnostics: { terminationReason, iterationsCompleted, totalCandidateEvaluations: attempts.length,
      exhaustedLimits: [...exhausted].sort(), suppliedReportRevalidated: options.report !== undefined },
  };
}