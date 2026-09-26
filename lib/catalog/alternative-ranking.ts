import type { CatalogCandidate } from "@/lib/catalog/schema";

export const ALTERNATIVE_SCORE_WEIGHTS = {
  dimensions: 30,
  configuration: 15,
  seatingCapacity: 10,
  style: 15,
  material: 10,
  color: 10,
  price: 10,
} as const;

export type AlternativeScoreBreakdown = {
  dimensions: number;
  configuration: number;
  seatingCapacity: number;
  style: number;
  material: number;
  color: number;
  price: number;
};

export type RankedCatalogAlternative = {
  candidate: CatalogCandidate;
  score: number;
  scoreBreakdown: AlternativeScoreBreakdown;
  availabilityPenalty: number;
};

function normalizedText(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function scoreExactTextMatch(
  current: string | null,
  alternative: string | null,
  weight: number,
): number {
  const currentValue = normalizedText(current);
  const alternativeValue = normalizedText(alternative);

  if (!currentValue || !alternativeValue) {
    return weight * 0.5;
  }

  return currentValue === alternativeValue ? weight : 0;
}

function scoreSeatingCapacity(
  current: number | null,
  alternative: number | null,
): number {
  const weight = ALTERNATIVE_SCORE_WEIGHTS.seatingCapacity;

  if (current === null || alternative === null) {
    return weight * 0.5;
  }

  const difference = Math.abs(current - alternative);

  if (difference === 0) return weight;
  if (difference === 1) return weight * 0.5;

  return 0;
}

function scoreDimensions(
  current: CatalogCandidate,
  alternative: CatalogCandidate,
): number {
  const weight = ALTERNATIVE_SCORE_WEIGHTS.dimensions;

  const pairs = [
    [current.widthCm, alternative.widthCm],
    [current.depthCm, alternative.depthCm],
    [current.heightCm, alternative.heightCm],
  ] as const;

  const comparablePairs = pairs.filter(
    ([currentValue, alternativeValue]) =>
      currentValue !== null &&
      alternativeValue !== null &&
      currentValue > 0 &&
      alternativeValue > 0,
  );

  if (comparablePairs.length === 0) {
    return weight * 0.5;
  }

  const similarity =
    comparablePairs.reduce((total, [currentValue, alternativeValue]) => {
      const larger = Math.max(currentValue!, alternativeValue!);
      const difference = Math.abs(currentValue! - alternativeValue!);

      return total + Math.max(0, 1 - difference / larger);
    }, 0) / comparablePairs.length;

  return weight * similarity;
}

function scorePrice(
  current: CatalogCandidate,
  alternative: CatalogCandidate,
): number {
  const weight = ALTERNATIVE_SCORE_WEIGHTS.price;

  if (
    current.roomaiSellingPrice === null ||
    alternative.roomaiSellingPrice === null ||
    current.roomaiSellingPrice <= 0 ||
    alternative.roomaiSellingPrice < 0 ||
    !current.currency ||
    !alternative.currency
  ) {
    return weight * 0.5;
  }

  if (
    current.currency.trim().toUpperCase() !==
    alternative.currency.trim().toUpperCase()
  ) {
    return weight * 0.5;
  }

  const difference = Math.abs(
    current.roomaiSellingPrice - alternative.roomaiSellingPrice,
  );

  const relativeDifference = difference / current.roomaiSellingPrice;

  return weight * Math.max(0, 1 - relativeDifference);
}

function getAvailabilityPenalty(candidate: CatalogCandidate): number {
  const availability = normalizedText(candidate.normalizedAvailability);

  if (!availability) {
    return 0;
  }

  if (
    availability === "out_of_stock" ||
    availability === "unavailable" ||
    availability === "discontinued"
  ) {
    return 25;
  }

  return 0;
}

export function rankCatalogAlternative(
  current: CatalogCandidate,
  alternative: CatalogCandidate,
): RankedCatalogAlternative {
  const scoreBreakdown: AlternativeScoreBreakdown = {
    dimensions: scoreDimensions(current, alternative),

    configuration: scoreExactTextMatch(
      current.configuration,
      alternative.configuration,
      ALTERNATIVE_SCORE_WEIGHTS.configuration,
    ),

    seatingCapacity: scoreSeatingCapacity(
      current.seatingCapacity,
      alternative.seatingCapacity,
    ),

    style: scoreExactTextMatch(
      current.normalizedStyle,
      alternative.normalizedStyle,
      ALTERNATIVE_SCORE_WEIGHTS.style,
    ),

    material: scoreExactTextMatch(
      current.normalizedMaterial,
      alternative.normalizedMaterial,
      ALTERNATIVE_SCORE_WEIGHTS.material,
    ),

    color: scoreExactTextMatch(
      current.normalizedColor,
      alternative.normalizedColor,
      ALTERNATIVE_SCORE_WEIGHTS.color,
    ),

    price: scorePrice(current, alternative),
  };

  const availabilityPenalty = getAvailabilityPenalty(alternative);

  const rawScore = Object.values(scoreBreakdown).reduce(
    (total, value) => total + value,
    0,
  );

  return {
    candidate: alternative,
    score: Math.max(0, rawScore - availabilityPenalty),
    scoreBreakdown,
    availabilityPenalty,
  };
}

export function rankCatalogAlternatives(
  current: CatalogCandidate,
  alternatives: CatalogCandidate[],
): RankedCatalogAlternative[] {
  return alternatives
    .map((alternative) => rankCatalogAlternative(current, alternative))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.candidate.variantId.localeCompare(b.candidate.variantId);
    });
}
