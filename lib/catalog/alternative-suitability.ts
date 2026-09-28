import {
  evaluateAestheticCompatibility,
  type AestheticCompatibilityResult,
} from "@/lib/catalog/aesthetic-compatibility";
import {
  rankCatalogAlternative,
  type RankedCatalogAlternative,
} from "@/lib/catalog/alternative-ranking";
import type { CatalogCandidate } from "@/lib/catalog/schema";
import type { FurnitureDesignAttributes } from "@/lib/design-intelligence/furniture-attributes";
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
  furnitureAttributes?: {
    current: FurnitureDesignAttributes;
    alternative: FurnitureDesignAttributes;
  },
): SuitableCatalogAlternative | null {
  const spatialCompatibility = evaluateCatalogReplacementContextCompatibility(
    context.currentObjectId,
    context.designObject,
    current,
    alternative,
    context.geometry,
    context.openings,
    context.neighbors,
  );

  // Unknown is excluded along with incompatible: customer alternatives must be
  // positively established as fitting the saved placement.
  if (spatialCompatibility.status !== "compatible") return null;

  const catalogRanking = rankCatalogAlternative(current, alternative);
  const aestheticCompatibility = evaluateAestheticCompatibility(current, alternative, furnitureAttributes);
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
  attributesByVariantId?: ReadonlyMap<string, FurnitureDesignAttributes>,
): SuitableCatalogAlternative[] {
  return alternatives
    .flatMap((alternative) => {
      const currentAttributes = attributesByVariantId?.get(current.variantId);
      const alternativeAttributes = attributesByVariantId?.get(alternative.variantId);
      const result = evaluateCatalogAlternativeSuitability(
        current,
        alternative,
        context,
        currentAttributes && alternativeAttributes
          ? { current: currentAttributes, alternative: alternativeAttributes }
          : undefined,
      );
      return result ? [result] : [];
    })
    .sort((first, second) => {
      if (second.suitabilityScore !== first.suitabilityScore) {
        return second.suitabilityScore - first.suitabilityScore;
      }
      if (second.score !== first.score) return second.score - first.score;
      if (attributesByVariantId) {
        const firstEvidence = first.aestheticCompatibility.furnitureAttributeCompatibility?.overallCompatibility ?? "unknown";
        const secondEvidence = second.aestheticCompatibility.furnitureAttributeCompatibility?.overallCompatibility ?? "unknown";
        if (firstEvidence !== secondEvidence) {
          if (firstEvidence === "compatible") return -1;
          if (secondEvidence === "compatible") return 1;
          if (firstEvidence === "unknown") return -1;
          if (secondEvidence === "unknown") return 1;
        }
      }
      return first.candidate.variantId.localeCompare(second.candidate.variantId);
    })
    .slice(0, limit);
}
