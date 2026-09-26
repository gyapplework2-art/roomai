import type { CatalogCandidate } from "@/lib/catalog/schema";

export const AESTHETIC_SCORE_WEIGHTS = {
  style: 30,
  material: 25,
  color: 20,
  configuration: 15,
  proportion: 10,
} as const;

export type AestheticCompatibilityResult = {
  score: number;
  status: "compatible" | "mixed" | "unknown";
  reasons: string[];
};

function normalized(value: string | null): string | null {
  const result = value?.trim().toLowerCase();
  return result || null;
}

function scoreVisualAttribute(
  current: string | null,
  alternative: string | null,
  weight: number,
  label: "style" | "material" | "color" | "configuration",
) {
  const currentValue = normalized(current);
  const alternativeValue = normalized(alternative);
  if (!currentValue || !alternativeValue) {
    return { score: weight * 0.5, comparable: false, reason: `${label}_unknown` };
  }
  if (currentValue === alternativeValue) {
    return { score: weight, comparable: true, reason: `${label}_match` };
  }
  return { score: 0, comparable: true, reason: `${label}_changed` };
}

function scoreProportion(current: CatalogCandidate, alternative: CatalogCandidate) {
  const currentWidth = current.widthCm;
  const currentDepth = current.depthCm;
  const alternativeWidth = alternative.widthCm;
  const alternativeDepth = alternative.depthCm;
  if (
    currentWidth === null
    || currentDepth === null
    || alternativeWidth === null
    || alternativeDepth === null
    || currentWidth <= 0
    || currentDepth <= 0
    || alternativeWidth <= 0
    || alternativeDepth <= 0
  ) {
    return { score: AESTHETIC_SCORE_WEIGHTS.proportion * 0.5, comparable: false, reason: "proportion_unknown" };
  }
  const currentRatio = currentWidth / currentDepth;
  const alternativeRatio = alternativeWidth / alternativeDepth;
  const similarity = Math.min(currentRatio, alternativeRatio) / Math.max(currentRatio, alternativeRatio);
  return similarity >= 0.8
    ? { score: AESTHETIC_SCORE_WEIGHTS.proportion * similarity, comparable: true, reason: "proportion_similar" }
    : { score: AESTHETIC_SCORE_WEIGHTS.proportion * similarity, comparable: true, reason: "proportion_changed" };
}

export function evaluateAestheticCompatibility(
  current: CatalogCandidate,
  alternative: CatalogCandidate,
): AestheticCompatibilityResult {
  const components = [
    scoreVisualAttribute(current.normalizedStyle, alternative.normalizedStyle, AESTHETIC_SCORE_WEIGHTS.style, "style"),
    scoreVisualAttribute(current.normalizedMaterial, alternative.normalizedMaterial, AESTHETIC_SCORE_WEIGHTS.material, "material"),
    scoreVisualAttribute(current.normalizedColor, alternative.normalizedColor, AESTHETIC_SCORE_WEIGHTS.color, "color"),
    scoreVisualAttribute(current.configuration, alternative.configuration, AESTHETIC_SCORE_WEIGHTS.configuration, "configuration"),
    scoreProportion(current, alternative),
  ];
  const comparableCount = components.filter((component) => component.comparable).length;
  const score = components.reduce((total, component) => total + component.score, 0);
  if (comparableCount === 0) {
    return {
      score,
      status: "unknown",
      reasons: [...components.map((component) => component.reason), "insufficient_aesthetic_metadata"],
    };
  }
  return {
    score,
    status: score >= 70 ? "compatible" : "mixed",
    reasons: components.map((component) => component.reason),
  };
}
