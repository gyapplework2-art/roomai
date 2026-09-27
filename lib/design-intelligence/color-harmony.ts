import type { CatalogCandidate } from "@/lib/catalog/schema";
import type { DesignCompatibility, DesignIntent } from "./schema";

export const DESIGN_COLOR_FAMILIES = [
  "white",
  "cream",
  "beige",
  "brown",
  "gray",
  "black",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
] as const;

export type DesignColorFamily = (typeof DESIGN_COLOR_FAMILIES)[number];

export type NormalizedDesignColor = {
  value: string;
  family: DesignColorFamily;
};

export type ColorHarmonyReason =
  | "candidate_color_missing"
  | "candidate_color_unknown"
  | "design_color_intent_missing"
  | "candidate_matches_primary_color"
  | "candidate_matches_secondary_color"
  | "candidate_matches_accent_color"
  | "candidate_same_family_as_primary"
  | "candidate_same_family_as_secondary"
  | "candidate_same_family_as_accent"
  | "candidate_harmonizes_with_primary"
  | "candidate_harmonizes_with_secondary"
  | "candidate_harmonizes_with_accent"
  | "candidate_color_valid_but_not_aligned";

export type ColorHarmonyEvaluation = {
  compatibility: DesignCompatibility;
  reasons: ColorHarmonyReason[];
};

const COLOR_ALIASES: Record<string, DesignColorFamily> = {
  white: "white",
  soft_white: "white",
  warm_white: "white",
  off_white: "white",
  ivory: "cream",
  cream: "cream",
  vanilla: "cream",
  beige: "beige",
  warm_beige: "beige",
  oatmeal: "beige",
  sandstone: "beige",
  taupe: "beige",
  warm_taupe: "beige",
  tan: "brown",
  camel: "brown",
  brown: "brown",
  cognac: "brown",
  gray: "gray",
  grey: "gray",
  light_gray: "gray",
  light_grey: "gray",
  charcoal: "gray",
  charcoal_gray: "gray",
  charcoal_grey: "gray",
  black: "black",
  red: "red",
  rust: "orange",
  terracotta: "orange",
  orange: "orange",
  yellow: "yellow",
  mustard: "yellow",
  green: "green",
  sage: "green",
  sage_green: "green",
  olive: "green",
  olive_green: "green",
  forest_green: "green",
  blue: "blue",
  navy: "blue",
  navy_blue: "blue",
  purple: "purple",
  plum: "purple",
  pink: "pink",
  blush: "pink",
};

const HARMONIOUS_FAMILIES: Record<
  DesignColorFamily,
  readonly DesignColorFamily[]
> = {
  white: ["cream", "beige", "gray", "black"],
  cream: ["white", "beige", "brown"],
  beige: ["white", "cream", "brown", "gray"],
  brown: ["cream", "beige", "green"],
  gray: ["white", "beige", "black", "blue"],
  black: ["white", "gray"],
  red: ["orange", "pink"],
  orange: ["red", "yellow", "brown"],
  yellow: ["orange", "green"],
  green: ["brown", "yellow", "blue"],
  blue: ["gray", "green", "purple"],
  purple: ["blue", "pink"],
  pink: ["red", "purple"],
};

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

export function normalizeDesignColor(
  value: string | null,
): NormalizedDesignColor | null {
  if (!value?.trim()) return null;

  const normalized = normalizeToken(value);
  const family = COLOR_ALIASES[normalized];

  if (!family) return null;

  return {
    value: normalized,
    family,
  };
}

export function familiesHarmonize(
  first: DesignColorFamily,
  second: DesignColorFamily,
): boolean {
  return (
    HARMONIOUS_FAMILIES[first].includes(second) ||
    HARMONIOUS_FAMILIES[second].includes(first)
  );
}

export function evaluateCandidateColorHarmony(
  intent: Pick<DesignIntent, "colors">,
  candidate: CatalogCandidate,
): ColorHarmonyEvaluation {
  if (!candidate.normalizedColor?.trim()) {
    return {
      compatibility: "unknown",
      reasons: ["candidate_color_missing"],
    };
  }

  const candidateColor = normalizeDesignColor(candidate.normalizedColor);

  if (!candidateColor) {
    return {
      compatibility: "unknown",
      reasons: ["candidate_color_unknown"],
    };
  }

  const primary = normalizeDesignColor(intent.colors.primary);
  const secondary = normalizeDesignColor(intent.colors.secondary);
  const accent = normalizeDesignColor(intent.colors.accent);

  if (!primary && !secondary && !accent) {
    return {
      compatibility: "unknown",
      reasons: ["design_color_intent_missing"],
    };
  }

  const intended = [
    {
      color: primary,
      exact: "candidate_matches_primary_color" as const,
      sameFamily: "candidate_same_family_as_primary" as const,
      harmonious: "candidate_harmonizes_with_primary" as const,
    },
    {
      color: secondary,
      exact: "candidate_matches_secondary_color" as const,
      sameFamily: "candidate_same_family_as_secondary" as const,
      harmonious: "candidate_harmonizes_with_secondary" as const,
    },
    {
      color: accent,
      exact: "candidate_matches_accent_color" as const,
      sameFamily: "candidate_same_family_as_accent" as const,
      harmonious: "candidate_harmonizes_with_accent" as const,
    },
  ];

  for (const target of intended) {
    if (target.color?.value === candidateColor.value) {
      return {
        compatibility: "compatible",
        reasons: [target.exact],
      };
    }
  }

  for (const target of intended) {
    if (target.color?.family === candidateColor.family) {
      return {
        compatibility: "compatible",
        reasons: [target.sameFamily],
      };
    }
  }

  for (const target of intended) {
    if (
      target.color &&
      familiesHarmonize(candidateColor.family, target.color.family)
    ) {
      return {
        compatibility: "compatible",
        reasons: [target.harmonious],
      };
    }
  }

  return {
    compatibility: "mixed",
    reasons: ["candidate_color_valid_but_not_aligned"],
  };
}
