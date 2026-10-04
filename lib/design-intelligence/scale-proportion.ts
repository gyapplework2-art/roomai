import type { CatalogCandidate } from "@/lib/catalog/schema";
import type { DesignCompatibility, DesignRole } from "./schema";

export const SCALE_PROPORTION_TOLERANCE_RATIO = 0.15;

export type ScaleProportionReason =
  | "candidate_dimensions_missing_or_invalid"
  | "candidate_dimensions_within_role_range"
  | "candidate_width_slightly_below_role_range"
  | "candidate_width_slightly_above_role_range"
  | "candidate_width_far_below_role_range"
  | "candidate_width_far_above_role_range"
  | "candidate_depth_slightly_below_role_range"
  | "candidate_depth_slightly_above_role_range"
  | "candidate_depth_far_below_role_range"
  | "candidate_depth_far_above_role_range"
  | "candidate_height_slightly_below_role_range"
  | "candidate_height_slightly_above_role_range"
  | "candidate_height_far_below_role_range"
  | "candidate_height_far_above_role_range";

export type ScaleProportionEvaluation = {
  compatibility: DesignCompatibility;
  reasons: ScaleProportionReason[];
};

type DimensionName = "width" | "depth" | "height";

type DimensionEvaluation = {
  compatibility: "compatible" | "mixed" | "incompatible";
  reason: ScaleProportionReason | null;
};

function isFinitePositive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function evaluateDimension(
  dimension: DimensionName,
  valueCm: number,
  minCm: number,
  maxCm: number,
): DimensionEvaluation {
  if (valueCm >= minCm && valueCm <= maxCm) {
    return {
      compatibility: "compatible",
      reason: null,
    };
  }

  if (valueCm < minCm) {
    const deviationRatio = (minCm - valueCm) / minCm;
    const severity =
      deviationRatio <= SCALE_PROPORTION_TOLERANCE_RATIO
        ? "slightly"
        : "far";

    return {
      compatibility:
        severity === "slightly" ? "mixed" : "incompatible",
      reason: `candidate_${dimension}_${severity}_below_role_range`,
    };
  }

  const deviationRatio = (valueCm - maxCm) / maxCm;
  const severity =
    deviationRatio <= SCALE_PROPORTION_TOLERANCE_RATIO
      ? "slightly"
      : "far";

  return {
    compatibility:
      severity === "slightly" ? "mixed" : "incompatible",
    reason: `candidate_${dimension}_${severity}_above_role_range`,
  };
}

function aggregateDimensionEvaluations(evaluations: readonly DimensionEvaluation[]): ScaleProportionEvaluation {
  const reasons = evaluations.map((evaluation) => evaluation.reason)
    .filter((reason): reason is ScaleProportionReason => reason !== null);
  if (evaluations.some((evaluation) => evaluation.compatibility === "incompatible")) return { compatibility: "incompatible", reasons };
  if (evaluations.some((evaluation) => evaluation.compatibility === "mixed")) return { compatibility: "mixed", reasons };
  return { compatibility: "compatible", reasons: ["candidate_dimensions_within_role_range"] };
}

/** Width/depth-only role-envelope check for contexts where height is not required by the consuming rule. */
export function evaluateCandidateFootprintScaleProportion(
  role: Pick<DesignRole, "sizeRange">,
  candidate: Pick<CatalogCandidate, "widthCm" | "depthCm">,
): ScaleProportionEvaluation {
  if (!isFinitePositive(candidate.widthCm) || !isFinitePositive(candidate.depthCm)) {
    return { compatibility: "unknown", reasons: ["candidate_dimensions_missing_or_invalid"] };
  }
  return aggregateDimensionEvaluations([
    evaluateDimension("width", candidate.widthCm, role.sizeRange.widthMinCm, role.sizeRange.widthMaxCm),
    evaluateDimension("depth", candidate.depthCm, role.sizeRange.depthMinCm, role.sizeRange.depthMaxCm),
  ]);
}

export function evaluateCandidateScaleProportion(
  role: DesignRole,
  candidate: CatalogCandidate,
): ScaleProportionEvaluation {
  if (
    !isFinitePositive(candidate.widthCm) ||
    !isFinitePositive(candidate.depthCm) ||
    !isFinitePositive(candidate.heightCm)
  ) {
    return {
      compatibility: "unknown",
      reasons: ["candidate_dimensions_missing_or_invalid"],
    };
  }

  const evaluations = [
    evaluateDimension(
      "width",
      candidate.widthCm,
      role.sizeRange.widthMinCm,
      role.sizeRange.widthMaxCm,
    ),
    evaluateDimension(
      "depth",
      candidate.depthCm,
      role.sizeRange.depthMinCm,
      role.sizeRange.depthMaxCm,
    ),
    evaluateDimension(
      "height",
      candidate.heightCm,
      role.sizeRange.heightMinCm,
      role.sizeRange.heightMaxCm,
    ),
  ];

  return aggregateDimensionEvaluations(evaluations);
}
