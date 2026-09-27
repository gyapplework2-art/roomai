import type { CatalogCandidate } from "@/lib/catalog/schema";
import {
  familiesHarmonize,
  normalizeDesignColor,
} from "@/lib/design-intelligence/color-harmony";
import type {
  DesignCompatibility,
  DesignRole,
} from "@/lib/design-intelligence/schema";

const TABLE_TYPES = new Set(["dining_table"]);
const CHAIR_TYPES = new Set(["dining_chair"]);

export type DiningTableChairReason =
  | "relationship_not_dining_table_chair"
  | "table_height_missing_or_invalid"
  | "table_height_dining_appropriate"
  | "table_height_outside_typical_dining_range"
  | "chair_overall_height_missing_or_invalid"
  | "chair_overall_height_available_but_seat_height_unknown"
  | "table_seating_capacity_known"
  | "table_seating_capacity_missing_or_invalid"
  | "chair_count_not_represented_by_candidate"
  | "relationship_color_missing"
  | "relationship_color_unknown"
  | "relationship_colors_match"
  | "relationship_colors_share_family"
  | "relationship_colors_harmonize"
  | "relationship_colors_valid_but_not_aligned";

export type DiningRelationshipDimensionEvaluation = {
  compatibility: DesignCompatibility;
  reasons: DiningTableChairReason[];
};

export type DiningTableChairRelationshipEvaluation = {
  applicable: boolean;
  tableRoleId: string;
  chairRoleId: string;
  scaleProportion: DiningRelationshipDimensionEvaluation;
  functionalRelationship: DiningRelationshipDimensionEvaluation;
  colorHarmony: DiningRelationshipDimensionEvaluation;
  overallCompatibility: DesignCompatibility;
};

type ResolvedPair = {
  tableRole: DesignRole;
  tableCandidate: CatalogCandidate;
  chairRole: DesignRole;
  chairCandidate: CatalogCandidate;
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
    TABLE_TYPES.has(firstRole.furnitureTypeCode) &&
    CHAIR_TYPES.has(secondRole.furnitureTypeCode)
  ) {
    return {
      tableRole: firstRole,
      tableCandidate: firstCandidate,
      chairRole: secondRole,
      chairCandidate: secondCandidate,
    };
  }

  if (
    TABLE_TYPES.has(secondRole.furnitureTypeCode) &&
    CHAIR_TYPES.has(firstRole.furnitureTypeCode)
  ) {
    return {
      tableRole: secondRole,
      tableCandidate: secondCandidate,
      chairRole: firstRole,
      chairCandidate: firstCandidate,
    };
  }

  return null;
}

function evaluateScaleProportion(
  table: CatalogCandidate,
  chair: CatalogCandidate,
): DiningRelationshipDimensionEvaluation {
  const reasons: DiningTableChairReason[] = [];

  if (!isPositiveFinite(table.heightCm)) {
    reasons.push("table_height_missing_or_invalid");
  } else if (table.heightCm >= 70 && table.heightCm <= 80) {
    reasons.push("table_height_dining_appropriate");
  } else {
    reasons.push("table_height_outside_typical_dining_range");
  }

  if (!isPositiveFinite(chair.heightCm)) {
    reasons.push("chair_overall_height_missing_or_invalid");
  } else {
    reasons.push("chair_overall_height_available_but_seat_height_unknown");
  }

  if (
    reasons.includes("table_height_outside_typical_dining_range")
  ) {
    return {
      compatibility: "mixed",
      reasons,
    };
  }

  if (
    reasons.includes("table_height_missing_or_invalid") ||
    reasons.includes("chair_overall_height_missing_or_invalid")
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

function evaluateFunctionalRelationship(
  table: CatalogCandidate,
): DiningRelationshipDimensionEvaluation {
  if (
    table.seatingCapacity !== null &&
    Number.isFinite(table.seatingCapacity) &&
    table.seatingCapacity > 0
  ) {
    return {
      compatibility: "unknown",
      reasons: [
        "table_seating_capacity_known",
        "chair_count_not_represented_by_candidate",
      ],
    };
  }

  return {
    compatibility: "unknown",
    reasons: [
      "table_seating_capacity_missing_or_invalid",
      "chair_count_not_represented_by_candidate",
    ],
  };
}

function evaluateColorHarmony(
  table: CatalogCandidate,
  chair: CatalogCandidate,
): DiningRelationshipDimensionEvaluation {
  if (!table.normalizedColor || !chair.normalizedColor) {
    return {
      compatibility: "unknown",
      reasons: ["relationship_color_missing"],
    };
  }

  const tableColor = normalizeDesignColor(table.normalizedColor);
  const chairColor = normalizeDesignColor(chair.normalizedColor);

  if (!tableColor || !chairColor) {
    return {
      compatibility: "unknown",
      reasons: ["relationship_color_unknown"],
    };
  }

  if (
    table.normalizedColor.trim().toLowerCase() ===
    chair.normalizedColor.trim().toLowerCase()
  ) {
    return {
      compatibility: "compatible",
      reasons: ["relationship_colors_match"],
    };
  }

  if (tableColor.family === chairColor.family) {
    return {
      compatibility: "compatible",
      reasons: ["relationship_colors_share_family"],
    };
  }

  if (familiesHarmonize(tableColor.family, chairColor.family)) {
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

function aggregateCompatibility(
  evaluations: readonly DiningRelationshipDimensionEvaluation[],
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

export function evaluateDiningTableChairRelationship(
  firstRole: DesignRole,
  firstCandidate: CatalogCandidate,
  secondRole: DesignRole,
  secondCandidate: CatalogCandidate,
): DiningTableChairRelationshipEvaluation {
  const resolved = resolveRoles(
    firstRole,
    firstCandidate,
    secondRole,
    secondCandidate,
  );

  if (!resolved) {
    const notApplicable: DiningRelationshipDimensionEvaluation = {
      compatibility: "unknown",
      reasons: ["relationship_not_dining_table_chair"],
    };

    return {
      applicable: false,
      tableRoleId: "",
      chairRoleId: "",
      scaleProportion: notApplicable,
      functionalRelationship: notApplicable,
      colorHarmony: notApplicable,
      overallCompatibility: "unknown",
    };
  }

  const scaleProportion = evaluateScaleProportion(
    resolved.tableCandidate,
    resolved.chairCandidate,
  );

  const functionalRelationship = evaluateFunctionalRelationship(
    resolved.tableCandidate,
  );

  const colorHarmony = evaluateColorHarmony(
    resolved.tableCandidate,
    resolved.chairCandidate,
  );

  return {
    applicable: true,
    tableRoleId: resolved.tableRole.roleId,
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
