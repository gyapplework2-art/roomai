import {
  evaluateAestheticCompatibility,
  type AestheticCompatibilityResult,
} from "@/lib/catalog/aesthetic-compatibility";
import {
  rankCatalogAlternative,
  type RankedCatalogAlternative,
} from "@/lib/catalog/alternative-ranking";
import type { CatalogCandidate } from "@/lib/catalog/schema";
import {
  evaluateCatalogReplacementContextCompatibility,
  type NeighborSpatialFields,
  type SpatialCompatibilityResult,
} from "@/lib/catalog/spatial-compatibility";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";

export const ALTERNATIVE_SUITABILITY_WEIGHTS = {
  catalogSimilarity: 0.7,
  aestheticCompatibility: 0.3,
} as const;

export type AlternativeSuitabilityContext = {
  currentObjectId: string;
  designObject: {
    x_cm: number | null;
    y_cm: number | null;
    rotation_degrees: number | null;
  };
  geometry: RoomGeometry;
  openings: RoomOpening[];
  neighbors: NeighborSpatialFields[];
};

export type SuitableCatalogAlternative = RankedCatalogAlternative & {
  suitabilityScore: number;
  spatialCompatibility: SpatialCompatibilityResult;
  aestheticCompatibility: AestheticCompatibilityResult;
};

export function evaluateCatalogAlternativeSuitability(
  current: CatalogCandidate,
  alternative: CatalogCandidate,
  context: AlternativeSuitabilityContext,
): SuitableCatalogAlternative | null {
  const spatialCompatibility = evaluateCatalogReplacementContextCompatibility(
    context.currentObjectId,
    context.designObject,
    alternative,
    context.geometry,
    context.openings,
    context.neighbors,
  );

  // Unknown is excluded along with incompatible: customer alternatives must be
  // positively established as fitting the saved placement.
  if (spatialCompatibility.status !== "compatible") return null;

  const catalogRanking = rankCatalogAlternative(current, alternative);
  const aestheticCompatibility = evaluateAestheticCompatibility(current, alternative);
  const suitabilityScore =
    catalogRanking.score * ALTERNATIVE_SUITABILITY_WEIGHTS.catalogSimilarity
    + aestheticCompatibility.score * ALTERNATIVE_SUITABILITY_WEIGHTS.aestheticCompatibility;

  return {
    ...catalogRanking,
    suitabilityScore,
    spatialCompatibility,
    aestheticCompatibility,
  };
}

export function rankSuitableCatalogAlternatives(
  current: CatalogCandidate,
  alternatives: CatalogCandidate[],
  context: AlternativeSuitabilityContext,
  limit: number,
): SuitableCatalogAlternative[] {
  return alternatives
    .flatMap((alternative) => {
      const result = evaluateCatalogAlternativeSuitability(current, alternative, context);
      return result ? [result] : [];
    })
    .sort((first, second) => {
      if (second.suitabilityScore !== first.suitabilityScore) {
        return second.suitabilityScore - first.suitabilityScore;
      }
      if (second.score !== first.score) return second.score - first.score;
      return first.candidate.variantId.localeCompare(second.candidate.variantId);
    })
    .slice(0, limit);
}
