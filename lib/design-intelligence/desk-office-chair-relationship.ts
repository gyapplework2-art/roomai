import type { CatalogCandidate } from "@/lib/catalog/schema";
import { evaluateColorPairHarmony } from "@/lib/design-intelligence/color-harmony";
import type {
  DesignCompatibility,
  DesignRole,
} from "@/lib/design-intelligence/schema";

const DESK_TYPES = new Set(["desk"]);
const OFFICE_CHAIR_TYPES = new Set(["office_chair"]);

export type DeskOfficeChairReason =
  | "relationship_not_desk_office_chair"
  | "desk_dimensions_missing_or_invalid"
  | "desk_overall_dimensions_available"
  | "office_chair_dimensions_missing_or_invalid"
  | "office_chair_overall_dimensions_available"
  | "office_chair_seat_height_not_exposed"
  | "office_chair_seat_depth_not_exposed"
  | "office_chair_arm_clearance_not_exposed"
  | "desk_underside_clearance_not_exposed"
  | "adjustable_height_attributes_not_exposed"
  | "ergonomic_fit_unknown"
  | "relationship_color_missing"
  | "relationship_color_unknown"
  | "relationship_colors_match"
  | "relationship_colors_share_family"
  | "relationship_colors_harmonize"
  | "relationship_colors_valid_but_not_aligned";

export type DeskOfficeChairDimensionEvaluation = {
  compatibility: DesignCompatibility;
  reasons: DeskOfficeChairReason[];
};

export type DeskOfficeChairRelationshipEvaluation = {
  applicable: boolean;
  deskRoleId: string;
  chairRoleId: string;
  scaleProportion: DeskOfficeChairDimensionEvaluation;
  functionalRelationship: DeskOfficeChairDimensionEvaluation;
  colorHarmony: DeskOfficeChairDimensionEvaluation;
  overallCompatibility: DesignCompatibility;
};

type ResolvedPair = {
  deskRole: DesignRole;
  deskCandidate: CatalogCandidate;
  chairRole: DesignRole;
  chairCandidate: CatalogCandidate;
};

function isPositiveFinite(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function hasCompleteDimensions(candidate: CatalogCandidate): boolean {
  return (
    isPositiveFinite(candidate.widthCm) &&
    isPositiveFinite(candidate.depthCm) &&
    isPositiveFinite(candidate.heightCm)
  );
}

function resolveRoles(
  firstRole: DesignRole,
  firstCandidate: CatalogCandidate,
  secondRole: DesignRole,
  secondCandidate: CatalogCandidate,
): ResolvedPair | null {
  if (
    DESK_TYPES.has(firstRole.furnitureTypeCode) &&
    OFFICE_CHAIR_TYPES.has(secondRole.furnitureTypeCode)
  ) {
    return {
      deskRole: firstRole,
      deskCandidate: firstCandidate,
      chairRole: secondRole,
      chairCandidate: secondCandidate,
    };
  }

  if (
    DESK_TYPES.has(secondRole.furnitureTypeCode) &&
    OFFICE_CHAIR_TYPES.has(firstRole.furnitureTypeCode)
  ) {
    return {
      deskRole: secondRole,
      deskCandidate: secondCandidate,
      chairRole: firstRole,
      chairCandidate: firstCandidate,
    };
  }

  return null;
}

function evaluateScaleProportion(
  desk: CatalogCandidate,
  chair: CatalogCandidate,
): DeskOfficeChairDimensionEvaluation {
  const reasons: DeskOfficeChairReason[] = [];

  if (hasCompleteDimensions(desk)) {
    reasons.push("desk_overall_dimensions_available");
  } else {
    reasons.push("desk_dimensions_missing_or_invalid");
  }

  if (hasCompleteDimensions(chair)) {
    reasons.push("office_chair_overall_dimensions_available");
  } else {
    reasons.push("office_chair_dimensions_missing_or_invalid");
  }

  if (
    reasons.includes("desk_dimensions_missing_or_invalid") ||
    reasons.includes("office_chair_dimensions_missing_or_invalid")
  ) {
    return {
      compatibility: "unknown",
      reasons,
    };
  }

  return {
    compatibility: "compatible",
    reasons,
  };
}

export function evaluateDeskOfficeChairFunctionalRelationship(): DeskOfficeChairDimensionEvaluation {
  return {
    compatibility: "unknown",
    reasons: [
      "office_chair_seat_height_not_exposed",
      "office_chair_seat_depth_not_exposed",
      "office_chair_arm_clearance_not_exposed",
      "desk_underside_clearance_not_exposed",
      "adjustable_height_attributes_not_exposed",
      "ergonomic_fit_unknown",
    ],
  };
}

function evaluateColorHarmony(
  desk: CatalogCandidate,
  chair: CatalogCandidate,
): DeskOfficeChairDimensionEvaluation {
  const exactValueMatch = !!desk.normalizedColor?.trim() && !!chair.normalizedColor?.trim()
    && desk.normalizedColor.trim().toLowerCase() === chair.normalizedColor.trim().toLowerCase();
  const result = evaluateColorPairHarmony(desk.normalizedColor, chair.normalizedColor, exactValueMatch);
  return { compatibility: result.compatibility, reasons: result.reasons };
}

function aggregateCompatibility(
  evaluations: readonly DeskOfficeChairDimensionEvaluation[],
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

export function evaluateDeskOfficeChairRelationship(
  firstRole: DesignRole,
  firstCandidate: CatalogCandidate,
  secondRole: DesignRole,
  secondCandidate: CatalogCandidate,
): DeskOfficeChairRelationshipEvaluation {
  const resolved = resolveRoles(
    firstRole,
    firstCandidate,
    secondRole,
    secondCandidate,
  );

  if (!resolved) {
    const notApplicable: DeskOfficeChairDimensionEvaluation = {
      compatibility: "unknown",
      reasons: ["relationship_not_desk_office_chair"],
    };

    return {
      applicable: false,
      deskRoleId: "",
      chairRoleId: "",
      scaleProportion: notApplicable,
      functionalRelationship: notApplicable,
      colorHarmony: notApplicable,
      overallCompatibility: "unknown",
    };
  }

  const scaleProportion = evaluateScaleProportion(
    resolved.deskCandidate,
    resolved.chairCandidate,
  );

  const functionalRelationship = evaluateDeskOfficeChairFunctionalRelationship();

  const colorHarmony = evaluateColorHarmony(
    resolved.deskCandidate,
    resolved.chairCandidate,
  );

  return {
    applicable: true,
    deskRoleId: resolved.deskRole.roleId,
    chairRoleId: resolved.chairRole.roleId,
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
