import type { CatalogCandidate } from "@/lib/catalog/schema";
import { evaluateColorPairHarmony } from "@/lib/design-intelligence/color-harmony";
import type {
  DesignCompatibility,
  DesignRole,
} from "@/lib/design-intelligence/schema";

export const SOFA_RUG_COMPATIBLE_WIDTH_RATIO = 0.75;
export const SOFA_RUG_MIXED_WIDTH_RATIO = 0.6;
export const SOFA_RUG_PROPORTION_RULE_ID = "sofa_rug_width_ratio";

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

export type SofaRugScaleProportionEvaluation = Pick<
  SofaRugRelationshipEvaluation,
  "applicable" | "seatingRoleId" | "rugRoleId" | "scaleProportion"
>;

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

function resolveRoles(first: Pick<DesignRole, "roleId" | "furnitureTypeCode">, second: Pick<DesignRole, "roleId" | "furnitureTypeCode">) {
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

function evaluateScaleProportionWidths(
  seatingWidthCm: number | null,
  rugWidthCm: number | null,
): SofaRugDimensionEvaluation {
  if (
    !isFinitePositive(seatingWidthCm) ||
    !isFinitePositive(rugWidthCm)
  ) {
    return {
      compatibility: "unknown",
      reasons: ["relationship_dimensions_missing_or_invalid"],
    };
  }

  const ratio = rugWidthCm / seatingWidthCm;

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

function evaluateScaleProportion(
  seating: CatalogCandidate,
  rug: CatalogCandidate,
): SofaRugDimensionEvaluation {
  return evaluateScaleProportionWidths(seating.widthCm, rug.widthCm);
}

function evaluateColorHarmony(
  seating: CatalogCandidate,
  rug: CatalogCandidate,
): SofaRugDimensionEvaluation {
  const result = evaluateColorPairHarmony(seating.normalizedColor, rug.normalizedColor);
  return { compatibility: result.compatibility, reasons: result.reasons };
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

/** Width-only adapter for B.2.2; preserves the existing sofa/rug thresholds and reasons. */
export function evaluateSofaRugScaleProportion(
  firstRole: Pick<DesignRole, "roleId" | "furnitureTypeCode">,
  firstWidthCm: number | null,
  secondRole: Pick<DesignRole, "roleId" | "furnitureTypeCode">,
  secondWidthCm: number | null,
): SofaRugScaleProportionEvaluation {
  const roles = resolveRoles(firstRole, secondRole);
  if (!roles) {
    return {
      applicable: false,
      seatingRoleId: null,
      rugRoleId: null,
      scaleProportion: { compatibility: "unknown", reasons: ["relationship_not_sofa_rug"] },
    };
  }
  const seatingWidthCm = roles.seatingRole.roleId === firstRole.roleId ? firstWidthCm : secondWidthCm;
  const rugWidthCm = roles.rugRole.roleId === firstRole.roleId ? firstWidthCm : secondWidthCm;
  return {
    applicable: true,
    seatingRoleId: roles.seatingRole.roleId,
    rugRoleId: roles.rugRole.roleId,
    scaleProportion: evaluateScaleProportionWidths(seatingWidthCm, rugWidthCm),
  };
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
