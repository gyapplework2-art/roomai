import type { CatalogCandidate } from "@/lib/catalog/schema";
import type { DesignCompatibility, DesignIntent } from "./schema";

export const DESIGN_STYLE_CODES = [
  "modern",
  "warm_modern",
  "contemporary",
  "minimalist",
  "scandinavian",
  "mid_century_modern",
  "traditional",
  "transitional",
  "industrial",
  "japandi",
  "coastal",
  "farmhouse",
  "bohemian",
  "art_deco",
  "luxury_modern",
] as const;

export type DesignStyleCode = (typeof DESIGN_STYLE_CODES)[number];

export type StyleHarmonyReason =
  | "candidate_style_missing"
  | "candidate_style_unknown"
  | "design_style_intent_missing"
  | "candidate_matches_primary_style"
  | "candidate_matches_secondary_style"
  | "candidate_adjacent_to_primary_style"
  | "candidate_adjacent_to_secondary_style"
  | "candidate_style_valid_but_not_aligned";

export type StyleHarmonyEvaluation = {
  compatibility: DesignCompatibility;
  reasons: StyleHarmonyReason[];
};

const STYLE_CODE_SET = new Set<string>(DESIGN_STYLE_CODES);

const STYLE_ADJACENCY: Record<DesignStyleCode, readonly DesignStyleCode[]> = {
  modern: [
    "warm_modern",
    "contemporary",
    "minimalist",
    "luxury_modern",
  ],
  warm_modern: [
    "modern",
    "contemporary",
    "minimalist",
    "scandinavian",
    "japandi",
  ],
  contemporary: [
    "modern",
    "warm_modern",
    "minimalist",
    "luxury_modern",
  ],
  minimalist: [
    "modern",
    "warm_modern",
    "contemporary",
    "scandinavian",
    "japandi",
  ],
  scandinavian: [
    "minimalist",
    "warm_modern",
    "japandi",
  ],
  mid_century_modern: [
    "modern",
    "warm_modern",
    "contemporary",
  ],
  traditional: [
    "transitional",
    "farmhouse",
  ],
  transitional: [
    "traditional",
    "modern",
    "warm_modern",
    "contemporary",
  ],
  industrial: [
    "modern",
    "contemporary",
  ],
  japandi: [
    "scandinavian",
    "minimalist",
    "warm_modern",
  ],
  coastal: [
    "scandinavian",
    "farmhouse",
  ],
  farmhouse: [
    "traditional",
    "transitional",
    "coastal",
  ],
  bohemian: [
    "mid_century_modern",
  ],
  art_deco: [
    "luxury_modern",
    "contemporary",
  ],
  luxury_modern: [
    "modern",
    "contemporary",
    "art_deco",
  ],
};

export function normalizeDesignStyle(
  value: string | null,
): DesignStyleCode | null {
  if (!value) return null;

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  return STYLE_CODE_SET.has(normalized)
    ? (normalized as DesignStyleCode)
    : null;
}

function isAdjacent(
  candidate: DesignStyleCode,
  intended: DesignStyleCode,
): boolean {
  return (
    STYLE_ADJACENCY[intended].includes(candidate) ||
    STYLE_ADJACENCY[candidate].includes(intended)
  );
}

export function evaluateCandidateStyleHarmony(
  intent: Pick<DesignIntent, "primaryStyle" | "secondaryStyle">,
  candidate: CatalogCandidate,
): StyleHarmonyEvaluation {
  if (!candidate.normalizedStyle?.trim()) {
    return {
      compatibility: "unknown",
      reasons: ["candidate_style_missing"],
    };
  }

  const candidateStyle = normalizeDesignStyle(candidate.normalizedStyle);

  if (!candidateStyle) {
    return {
      compatibility: "unknown",
      reasons: ["candidate_style_unknown"],
    };
  }

  const primaryStyle = normalizeDesignStyle(intent.primaryStyle);
  const secondaryStyle = normalizeDesignStyle(intent.secondaryStyle);

  if (!primaryStyle && !secondaryStyle) {
    return {
      compatibility: "unknown",
      reasons: ["design_style_intent_missing"],
    };
  }

  if (primaryStyle === candidateStyle) {
    return {
      compatibility: "compatible",
      reasons: ["candidate_matches_primary_style"],
    };
  }

  if (secondaryStyle === candidateStyle) {
    return {
      compatibility: "compatible",
      reasons: ["candidate_matches_secondary_style"],
    };
  }

  if (primaryStyle && isAdjacent(candidateStyle, primaryStyle)) {
    return {
      compatibility: "compatible",
      reasons: ["candidate_adjacent_to_primary_style"],
    };
  }

  if (secondaryStyle && isAdjacent(candidateStyle, secondaryStyle)) {
    return {
      compatibility: "compatible",
      reasons: ["candidate_adjacent_to_secondary_style"],
    };
  }

  return {
    compatibility: "mixed",
    reasons: ["candidate_style_valid_but_not_aligned"],
  };
}
