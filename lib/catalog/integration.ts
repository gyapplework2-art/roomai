import { z } from "zod";

import type { CatalogCandidate, CatalogQuery } from "@/lib/catalog/schema";
import { rankCatalogCandidates } from "@/lib/catalog/candidate-ranking";
import { selectDiverseCatalogCandidates } from "@/lib/catalog/candidate-diversity";
import { evaluateCatalogHardFilters } from "@/lib/catalog/hard-filter";
import type { RoomConstrainedPlanItem } from "@/lib/furniture-planning/room-constraints";

export type CatalogSelectionIdentity = {
  catalogProductId: string;
  catalogProductVariantId: string;
};

export type CatalogSelectionsByObjectId = Record<string, CatalogSelectionIdentity>;

export type CoffeeTableCandidatePool = {
  planItemId: string;
  candidates: CatalogCandidate[];
};

export type SemanticCatalogSelection = CatalogSelectionIdentity & {
  planItemId: string;
  candidate: CatalogCandidate;
};

export type SemanticCatalogSelectionContext = {
  aiCandidatePools: Array<{ planItemId: string; candidates: AICatalogCandidate[] }>;
  selectionByKey: Record<string, SemanticCatalogSelection>;
};

export function createCoffeeTableCatalogQuery(
  item: RoomConstrainedPlanItem,
  currency: string,
): CatalogQuery | null {
  if (resolveFurnitureTypeCode(item.normalizedCategory) !== "coffee_table"
    || item.roomStatus !== "ready" || item.finalSearchRange === null) return null;
  const range = item.finalSearchRange;
  return {
    countryCode: "US",
    furnitureTypeCode: "coffee_table",
    currency,
    normalizedAvailability: "in_stock",
    maxWidthCm: range.widthMaxCm,
    maxDepthCm: range.depthMaxCm,
    maxHeightCm: range.heightMaxCm,
    limit: 30,
  };
}

export function createCoffeeTableCandidatePool(
  item: RoomConstrainedPlanItem,
  candidates: CatalogCandidate[],
  currency: string,
): CoffeeTableCandidatePool {
  const query = createCoffeeTableCatalogQuery(item, currency);
  const range = item.finalSearchRange;
  const eligible = query && range ? candidates.filter((candidate) => {
    const dimensions = [candidate.widthCm, candidate.depthCm, candidate.heightCm];
    return evaluateCatalogHardFilters(candidate, query).eligible
      && dimensions.every((value) => value !== null && Number.isFinite(value) && value > 0)
      && candidate.widthCm! >= range.widthMinCm
      && candidate.depthCm! >= range.depthMinCm
      && candidate.heightCm! >= range.heightMinCm
      && candidate.roomaiSellingPrice !== null
      && Number.isFinite(candidate.roomaiSellingPrice) && candidate.roomaiSellingPrice >= 0
      && candidate.productId.trim() !== "" && candidate.variantId.trim() !== ""
      && candidate.primaryImageUrl !== null
      && /^https?:\/\//.test(candidate.primaryImageUrl)
      && z.string().url().safeParse(candidate.primaryImageUrl).success;
  }) : [];
  return { planItemId: item.item.id, candidates: selectDesignCatalogCandidates([eligible]) };
}

export function createSemanticCatalogCandidateSelectionContext(
  pools: CoffeeTableCandidatePool[],
): SemanticCatalogSelectionContext {
  const offered = pools.flatMap((pool) => pool.candidates.map((candidate) => ({
    planItemId: pool.planItemId, candidate,
  })));
  const context = createCatalogCandidateSelectionContext(offered.map((entry) => entry.candidate));
  const selectionByKey: Record<string, SemanticCatalogSelection> = {};
  const aiCandidatePools = pools.map((pool) => ({
    planItemId: pool.planItemId,
    candidates: context.aiCandidates.filter((candidate, index) => {
      const entry = offered[index];
      if (entry.planItemId !== pool.planItemId) return false;
      selectionByKey[candidate.catalogSelectionKey] = {
        ...context.selectionByKey[candidate.catalogSelectionKey],
        planItemId: entry.planItemId,
        candidate: entry.candidate,
      };
      return true;
    }),
  }));
  return { aiCandidatePools, selectionByKey };
}

export const aiCatalogCandidateSchema = z.object({
  catalogSelectionKey: z.string().min(1),
  furnitureTypeCode: z.string().nullable(),
  furnitureTypeName: z.string().nullable(),
  productTitle: z.string().nullable(),
  roomaiDescription: z.string().nullable(),
  normalizedColor: z.string().nullable(),
  normalizedMaterial: z.string().nullable(),
  normalizedStyle: z.string().nullable(),
  configuration: z.string().nullable(),
  seatingCapacity: z.number().nullable(),
  dimensions: z.object({
    widthCm: z.number().nullable(),
    depthCm: z.number().nullable(),
    heightCm: z.number().nullable(),
    weightKg: z.number().nullable(),
  }),
  currency: z.string().nullable(),
  roomaiSellingPrice: z.number().nullable(),
}).strict();

export type AICatalogCandidate = z.infer<typeof aiCatalogCandidateSchema>;

const FURNITURE_TYPE_ALIASES: Record<string, string> = {
  rug: "area_rug",
  "area rug": "area_rug",
  sofa: "sofa",
  sectional: "sectional_sofa",
  "sectional sofa": "sectional_sofa",
  "accent chair": "accent_chair",
  armchair: "accent_chair",
  "coffee table": "coffee_table",
};

export function resolveFurnitureTypeCode(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/[\/_-]+/g, " ").replace(/\s+/g, " ");
  return FURNITURE_TYPE_ALIASES[normalized] ?? null;
}

export function deduplicateCatalogCandidates(candidates: CatalogCandidate[]): CatalogCandidate[] {
  const seenVariantIds = new Set<string>();
  return candidates.filter((candidate) => {
    if (seenVariantIds.has(candidate.variantId)) return false;
    seenVariantIds.add(candidate.variantId);
    return true;
  });
}

export function selectDesignCatalogCandidates(
  candidateGroups: CatalogCandidate[][],
  limitPerType = 10,
): CatalogCandidate[] {
  return deduplicateCatalogCandidates(candidateGroups.flatMap((candidates) =>
    selectDiverseCatalogCandidates(rankCatalogCandidates(candidates), limitPerType)
      .map((ranked) => ranked.candidate),
  ));
}

export function createCatalogCandidateSelectionContext(candidates: CatalogCandidate[]) {
  const selectionByKey: Record<string, CatalogSelectionIdentity> = {};
  const aiCandidates: AICatalogCandidate[] = candidates.map((candidate, index) => {
    const catalogSelectionKey = `candidate_${index + 1}`;
    selectionByKey[catalogSelectionKey] = {
      catalogProductId: candidate.productId,
      catalogProductVariantId: candidate.variantId,
    };
    return aiCatalogCandidateSchema.parse({
      catalogSelectionKey,
      furnitureTypeCode: candidate.furnitureTypeCode,
      furnitureTypeName: candidate.furnitureTypeName,
      productTitle: candidate.productTitle,
      roomaiDescription: candidate.roomaiDescription,
      normalizedColor: candidate.normalizedColor,
      normalizedMaterial: candidate.normalizedMaterial,
      normalizedStyle: candidate.normalizedStyle,
      configuration: candidate.configuration,
      seatingCapacity: candidate.seatingCapacity,
      dimensions: {
        widthCm: candidate.widthCm,
        depthCm: candidate.depthCm,
        heightCm: candidate.heightCm,
        weightKg: candidate.weightKg,
      },
      currency: candidate.currency,
      roomaiSellingPrice: candidate.roomaiSellingPrice,
    });
  });

  return { aiCandidates, selectionByKey };
}
