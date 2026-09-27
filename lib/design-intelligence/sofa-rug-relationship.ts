import type { CatalogCandidate } from "@/lib/catalog/schema";
import {
  familiesHarmonize,
  normalizeDesignColor,
} from "@/lib/design-intelligence/color-harmony";
import type {
  DesignCompatibility,
  DesignRole,
} from "@/lib/design-intelligence/schema";

export const SOFA_RUG_COMPATIBLE_WIDTH_RATIO = 0.75;
export const SOFA_RUG_MIXED_WIDTH_RATIO = 0.6;

export type SofaRugRelationshipReason =
  | "relationship_not_sofa_rug"
  | "relationship_dimensions_missing_or_invalid"
  | "rug_width_proportionate_to_seating"
  | "rug_width_somewhat_small_for_seating"
  | "rug_width_too_small_for_seating"
  | "relationship_color_missing"
  | "relationship_color_unknown"
  | "relationship_colors_match"
  | "relationship_colors_share_family"
  | "relationship_colors_harmonize"
  | "relationship_colors_valid_but_not_aligned"
  | "visual_hierarchy_evidence_unavailable";

export type SofaRugDimensionEvaluation = {
  compatibility: DesignCompatibility;
  reasons: SofaRugRelationshipReason[];
};

export type SofaRugRelationshipEvaluation = {
  applicable: boolean;
  seatingRoleId: string | null;
  rugRoleId: string | null;
  scaleProportion: SofaRugDimensionEvaluation;
  colorHarmony: SofaRugDimensionEvaluation;
  composition: SofaRugDimensionEvaluation;
  overallCompatibility: DesignCompatibility;
};

const SEATING_TYPES = new Set([
  "sofa",
  "loveseat",
  "sectional",
  "sectional_sofa",
  "sofa_with_chaise",
]);

const RUG_TYPES = new Set([
  "rug",
  "area_rug",
]);

function isFinitePositive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function resolveRoles(first: DesignRole, second: DesignRole) {
  if (
    SEATING_TYPES.has(first.furnitureTypeCode) &&
    RUG_TYPES.has(second.furnitureTypeCode)
  ) {
    return {
      seatingRole: first,
      rugRole: second,
    };
  }

  if (
    SEATING_TYPES.has(second.furnitureTypeCode) &&
    RUG_TYPES.has(first.furnitureTypeCode)
  ) {
    return {
      seatingRole: second,
      rugRole: first,
    };
  }

  return null;
}

function evaluateScaleProportion(
  seating: CatalogCandidate,
  rug: CatalogCandidate,
): SofaRugDimensionEvaluation {
  if (
    !isFinitePositive(seating.widthCm) ||
    !isFinitePositive(rug.widthCm)
  ) {
    return {
      compatibility: "unknown",
      reasons: ["relationship_dimensions_missing_or_invalid"],
    };
  }

  const ratio = rug.widthCm / seating.widthCm;

  if (ratio >= SOFA_RUG_COMPATIBLE_WIDTH_RATIO) {
    return {
      compatibility: "compatible",
      reasons: ["rug_width_proportionate_to_seating"],
    };
  }

  if (ratio >= SOFA_RUG_MIXED_WIDTH_RATIO) {
    return {
      compatibility: "mixed",
      reasons: ["rug_width_somewhat_small_for_seating"],
    };
  }

  return {
    compatibility: "incompatible",
    reasons: ["rug_width_too_small_for_seating"],
  };
}

function evaluateColorHarmony(
  seating: CatalogCandidate,
  rug: CatalogCandidate,
): SofaRugDimensionEvaluation {
  if (
    !seating.normalizedColor?.trim() ||
    !rug.normalizedColor?.trim()
  ) {
    return {
      compatibility: "unknown",
      reasons: ["relationship_color_missing"],
    };
  }

  const seatingColor = normalizeDesignColor(seating.normalizedColor);
  const rugColor = normalizeDesignColor(rug.normalizedColor);

  if (!seatingColor || !rugColor) {
    return {
      compatibility: "unknown",
      reasons: ["relationship_color_unknown"],
    };
  }

  if (seatingColor.value === rugColor.value) {
    return {
      compatibility: "compatible",
      reasons: ["relationship_colors_match"],
    };
  }

  if (seatingColor.family === rugColor.family) {
    return {
      compatibility: "compatible",
      reasons: ["relationship_colors_share_family"],
    };
  }

  if (familiesHarmonize(seatingColor.family, rugColor.family)) {
    return {
      compatibility: "compatible",
      reasons: ["relationship_colors_harmonize"],
    };
  }

  return {
    compatibility: "mixed",
    reasons: ["relationship_colors_valid_but_not_aligned"],
  };
}

function overallCompatibility(
  evaluations: SofaRugDimensionEvaluation[],
): DesignCompatibility {
  if (evaluations.some((evaluation) => evaluation.compatibility === "incompatible")) {
    return "incompatible";
  }

  if (evaluations.some((evaluation) => evaluation.compatibility === "mixed")) {
    return "mixed";
  }

  if (evaluations.some((evaluation) => evaluation.compatibility === "compatible")) {
    return "compatible";
  }

  return "unknown";
}

export function evaluateSofaRugRelationship(
  firstRole: DesignRole,
  firstCandidate: CatalogCandidate,
  secondRole: DesignRole,
  secondCandidate: CatalogCandidate,
): SofaRugRelationshipEvaluation {
  const roles = resolveRoles(firstRole, secondRole);

  if (!roles) {
    const notApplicable: SofaRugDimensionEvaluation = {
      compatibility: "unknown",
      reasons: ["relationship_not_sofa_rug"],
    };

    return {
      applicable: false,
      seatingRoleId: null,
      rugRoleId: null,
      scaleProportion: notApplicable,
      colorHarmony: notApplicable,
      composition: notApplicable,
      overallCompatibility: "unknown",
    };
  }

  const seatingCandidate =
    roles.seatingRole.roleId === firstRole.roleId
      ? firstCandidate
      : secondCandidate;

  const rugCandidate =
    roles.rugRole.roleId === firstRole.roleId
      ? firstCandidate
      : secondCandidate;

  const scaleProportion = evaluateScaleProportion(
    seatingCandidate,
    rugCandidate,
  );

  const colorHarmony = evaluateColorHarmony(
    seatingCandidate,
    rugCandidate,
  );

  const composition: SofaRugDimensionEvaluation = {
    compatibility: "unknown",
    reasons: ["visual_hierarchy_evidence_unavailable"],
  };

  return {
    applicable: true,
    seatingRoleId: roles.seatingRole.roleId,
    rugRoleId: roles.rugRole.roleId,
    scaleProportion,
    colorHarmony,
    composition,
    overallCompatibility: overallCompatibility([
      scaleProportion,
      colorHarmony,
      composition,
    ]),
  };
}
