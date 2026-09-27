import type { CatalogCandidate } from "@/lib/catalog/schema";

export type CatalogCandidateScoreBreakdown = {
  dimensions: number;
  visualMetadata: number;
  productMetadata: number;
  price: number;
};

export type RankedCatalogCandidate = {
  candidate: CatalogCandidate;
  score: number;
  scoreBreakdown: CatalogCandidateScoreBreakdown;
};

const SCORE_WEIGHTS = {
  dimensions: 40,
  visualMetadata: 30,
  productMetadata: 20,
  price: 10,
} as const;

function scoreCompleteness(
  values: Array<string | number | null>,
  maxScore: number,
): number {
  const present = values.filter((value) => {
    if (typeof value === "number") return Number.isFinite(value);
    return typeof value === "string" && value.trim().length > 0;
  }).length;

  return (present / values.length) * maxScore;
}

export function rankCatalogCandidate(
  candidate: CatalogCandidate,
): RankedCatalogCandidate {
  const scoreBreakdown: CatalogCandidateScoreBreakdown = {
    dimensions: scoreCompleteness(
      [candidate.widthCm, candidate.depthCm, candidate.heightCm],
      SCORE_WEIGHTS.dimensions,
    ),
    visualMetadata: scoreCompleteness(
      [
        candidate.normalizedStyle,
        candidate.normalizedMaterial,
        candidate.normalizedColor,
      ],
      SCORE_WEIGHTS.visualMetadata,
    ),
    productMetadata: scoreCompleteness(
      [candidate.configuration, candidate.seatingCapacity],
      SCORE_WEIGHTS.productMetadata,
    ),
    price:
      candidate.roomaiSellingPrice !== null && Number.isFinite(candidate.roomaiSellingPrice)
        ? SCORE_WEIGHTS.price
        : 0,
  };

  return {
    candidate,
    score: Object.values(scoreBreakdown).reduce(
      (total, component) => total + component,
      0,
    ),
    scoreBreakdown,
  };
}

export function rankCatalogCandidates(
  candidates: CatalogCandidate[],
): RankedCatalogCandidate[] {
  return candidates
    .map(rankCatalogCandidate)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.candidate.variantId.localeCompare(right.candidate.variantId);
    });
}
