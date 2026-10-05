import type { CatalogCandidate } from "@/lib/catalog/schema";
import { evaluateColorPairHarmony } from "@/lib/design-intelligence/color-harmony";
import type {
  DesignCompatibility,
  DesignRole,
} from "@/lib/design-intelligence/schema";

const BED_TYPES = new Set(["bed", "bed_frame"]);
const NIGHTSTAND_TYPES = new Set(["nightstand"]);

export const NIGHTSTAND_WIDTH_MIN_CM = 35;
export const NIGHTSTAND_WIDTH_MAX_CM = 70;
export const NIGHTSTAND_DEPTH_MIN_CM = 30;
export const NIGHTSTAND_DEPTH_MAX_CM = 55;
export const NIGHTSTAND_HEIGHT_MIN_CM = 45;
export const NIGHTSTAND_HEIGHT_MAX_CM = 75;

export type BedNightstandReason =
  | "relationship_not_bed_nightstand"
  | "nightstand_dimensions_missing_or_invalid"
  | "nightstand_dimensions_typical"
  | "nightstand_dimensions_outside_typical_range"
  | "bed_sleeping_surface_height_not_represented"
  | "nightstand_height_known_but_not_comparable_to_bed_total_height"
  | "bedside_height_alignment_unknown"
  | "relationship_color_missing"
  | "relationship_color_unknown"
  | "relationship_colors_match"
  | "relationship_colors_share_family"
  | "relationship_colors_harmonize"
  | "relationship_colors_valid_but_not_aligned";

export type BedNightstandDimensionEvaluation = {
  compatibility: DesignCompatibility;
  reasons: BedNightstandReason[];
};

export type BedNightstandRelationshipEvaluation = {
  applicable: boolean;
  bedRoleId: string;
  nightstandRoleId: string;
  scaleProportion: BedNightstandDimensionEvaluation;
  functionalRelationship: BedNightstandDimensionEvaluation;
  colorHarmony: BedNightstandDimensionEvaluation;
  overallCompatibility: DesignCompatibility;
};

type ResolvedPair = {
  bedRole: DesignRole;
  bedCandidate: CatalogCandidate;
  nightstandRole: DesignRole;
  nightstandCandidate: CatalogCandidate;
};

function isPositiveFinite(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function resolveRoles(
  firstRole: DesignRole,
  firstCandidate: CatalogCandidate,
  secondRole: DesignRole,
  secondCandidate: CatalogCandidate,
): ResolvedPair | null {
  if (
    BED_TYPES.has(firstRole.furnitureTypeCode) &&
    NIGHTSTAND_TYPES.has(secondRole.furnitureTypeCode)
  ) {
    return {
      bedRole: firstRole,
      bedCandidate: firstCandidate,
      nightstandRole: secondRole,
      nightstandCandidate: secondCandidate,
    };
  }

  if (
    BED_TYPES.has(secondRole.furnitureTypeCode) &&
    NIGHTSTAND_TYPES.has(firstRole.furnitureTypeCode)
  ) {
    return {
      bedRole: secondRole,
      bedCandidate: secondCandidate,
      nightstandRole: firstRole,
      nightstandCandidate: firstCandidate,
    };
  }

  return null;
}

function evaluateScaleProportion(
  nightstand: CatalogCandidate,
): BedNightstandDimensionEvaluation {
  if (
    !isPositiveFinite(nightstand.widthCm) ||
    !isPositiveFinite(nightstand.depthCm) ||
    !isPositiveFinite(nightstand.heightCm)
  ) {
    return {
      compatibility: "unknown",
      reasons: ["nightstand_dimensions_missing_or_invalid"],
    };
  }

  const typical =
    nightstand.widthCm >= NIGHTSTAND_WIDTH_MIN_CM &&
    nightstand.widthCm <= NIGHTSTAND_WIDTH_MAX_CM &&
    nightstand.depthCm >= NIGHTSTAND_DEPTH_MIN_CM &&
    nightstand.depthCm <= NIGHTSTAND_DEPTH_MAX_CM &&
    nightstand.heightCm >= NIGHTSTAND_HEIGHT_MIN_CM &&
    nightstand.heightCm <= NIGHTSTAND_HEIGHT_MAX_CM;

  if (typical) {
    return {
      compatibility: "compatible",
      reasons: ["nightstand_dimensions_typical"],
    };
  }

  return {
    compatibility: "mixed",
    reasons: ["nightstand_dimensions_outside_typical_range"],
  };
}

export function evaluateBedNightstandFunctionalRelationship(
  nightstandHeightCm: number | null,
): BedNightstandDimensionEvaluation {
  const reasons: BedNightstandReason[] = [
    "bed_sleeping_surface_height_not_represented",
  ];

  if (isPositiveFinite(nightstandHeightCm)) {
    reasons.push(
      "nightstand_height_known_but_not_comparable_to_bed_total_height",
    );
  }

  reasons.push("bedside_height_alignment_unknown");

  return {
    compatibility: "unknown",
    reasons,
  };
}

function evaluateFunctionalRelationship(nightstand: CatalogCandidate): BedNightstandDimensionEvaluation {
  return evaluateBedNightstandFunctionalRelationship(nightstand.heightCm);
}

function evaluateColorHarmony(
  bed: CatalogCandidate,
  nightstand: CatalogCandidate,
): BedNightstandDimensionEvaluation {
  const exactValueMatch = !!bed.normalizedColor?.trim() && !!nightstand.normalizedColor?.trim()
    && bed.normalizedColor.trim().toLowerCase() === nightstand.normalizedColor.trim().toLowerCase();
  const result = evaluateColorPairHarmony(bed.normalizedColor, nightstand.normalizedColor, exactValueMatch);
  return { compatibility: result.compatibility, reasons: result.reasons };
}

function aggregateCompatibility(
  evaluations: readonly BedNightstandDimensionEvaluation[],
): DesignCompatibility {
  if (
    evaluations.some(
      (evaluation) => evaluation.compatibility === "incompatible",
    )
  ) {
    return "incompatible";
  }

  if (
    evaluations.some(
      (evaluation) => evaluation.compatibility === "mixed",
    )
  ) {
    return "mixed";
  }

  if (
    evaluations.some(
      (evaluation) => evaluation.compatibility === "compatible",
    )
  ) {
    return "compatible";
  }

  return "unknown";
}

export function evaluateBedNightstandRelationship(
  firstRole: DesignRole,
  firstCandidate: CatalogCandidate,
  secondRole: DesignRole,
  secondCandidate: CatalogCandidate,
): BedNightstandRelationshipEvaluation {
  const resolved = resolveRoles(
    firstRole,
    firstCandidate,
    secondRole,
    secondCandidate,
  );

  if (!resolved) {
    const notApplicable: BedNightstandDimensionEvaluation = {
      compatibility: "unknown",
      reasons: ["relationship_not_bed_nightstand"],
    };

    return {
      applicable: false,
      bedRoleId: "",
      nightstandRoleId: "",
      scaleProportion: notApplicable,
      functionalRelationship: notApplicable,
      colorHarmony: notApplicable,
      overallCompatibility: "unknown",
    };
  }

  const scaleProportion = evaluateScaleProportion(
    resolved.nightstandCandidate,
  );

  const functionalRelationship = evaluateFunctionalRelationship(
    resolved.nightstandCandidate,
  );

  const colorHarmony = evaluateColorHarmony(
    resolved.bedCandidate,
    resolved.nightstandCandidate,
  );

  return {
    applicable: true,
    bedRoleId: resolved.bedRole.roleId,
    nightstandRoleId: resolved.nightstandRole.roleId,
    scaleProportion,
    functionalRelationship,
    colorHarmony,
    overallCompatibility: aggregateCompatibility([
      scaleProportion,
      functionalRelationship,
      colorHarmony,
    ]),
  };
}
