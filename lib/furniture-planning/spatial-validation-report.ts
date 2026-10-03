import type { CirculationEvaluation } from "./circulation";
import type { SpatialViolation } from "./spatial-validator";

export type ValidationPriority = "P0" | "P1" | "P2" | "P3";
export type EvaluationCoverage = {
  footprintsEvaluated: boolean;
  physicalEvaluated: boolean;
  physicalDoorConflictEvaluated: boolean;
  functionalClearanceEvaluated: boolean;
  circulationEvaluated: boolean;
};

/**
 * A.4 consumes ordered violations and structured details, validity, circulation and coverage;
 * repair decisions must not parse messages. `valid` means no hard violations, not full coverage.
 * Physical coverage requires usable footprints; no-door checks are unavailable, not certified.
 */
export type WholeRoomValidationReport = {
  schemaVersion: "1.0";
  valid: boolean;
  physicallyValid: boolean;
  functionallyValid: boolean;
  status: "VALID" | "INVALID" | "NOT_FULLY_EVALUATED";
  summary: {
    totalViolations: number;
    p0Count: number;
    p1Count: number;
    p2Count: number;
    p3Count: number;
    hardCount: number;
    softCount: number;
  };
  violations: SpatialViolation[];
  circulation: CirculationEvaluation;
  evaluation: EvaluationCoverage;
};

type OrderedViolation = {
  priority: ValidationPriority;
  classification: "hard" | "soft";
  type: string;
  id: string;
};

const priorityOrder: Record<ValidationPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const classificationOrder = { hard: 0, soft: 1 };
const compareText = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0;

/** Sole canonical ordering: priority, hardness, type, stable ID. */
export function compareSpatialViolations(first: OrderedViolation, second: OrderedViolation): number {
  return priorityOrder[first.priority] - priorityOrder[second.priority]
    || classificationOrder[first.classification] - classificationOrder[second.classification]
    || compareText(first.type, second.type)
    || compareText(first.id, second.id);
}

/** Reporting only; no footprint, rule, geometry, or circulation evaluation occurs here. */
export function buildWholeRoomValidationReport(
  violations: readonly SpatialViolation[],
  circulation: CirculationEvaluation,
  evaluation: EvaluationCoverage,
): WholeRoomValidationReport {
  const canonical = [...violations].sort(compareSpatialViolations);
  const countPriority = (priority: ValidationPriority) => canonical.filter((violation) => violation.priority === priority).length;
  const countClassification = (classification: "hard" | "soft") => canonical.filter((violation) => violation.classification === classification).length;
  const hardCount = countClassification("hard");
  const physicallyValid = !canonical.some((violation) => violation.priority === "P0" && violation.classification === "hard");
  const functionallyValid = !canonical.some((violation) => violation.priority === "P1" && violation.classification === "hard");
  const valid = hardCount === 0;
  const fullyEvaluated = Object.values(evaluation).every(Boolean);
  return {
    schemaVersion: "1.0", valid, physicallyValid, functionallyValid,
    status: !valid ? "INVALID" : fullyEvaluated ? "VALID" : "NOT_FULLY_EVALUATED",
    summary: {
      totalViolations: canonical.length, p0Count: countPriority("P0"), p1Count: countPriority("P1"),
      p2Count: countPriority("P2"), p3Count: countPriority("P3"), hardCount, softCount: countClassification("soft"),
    },
    violations: canonical, circulation, evaluation: { ...evaluation },
  };
}