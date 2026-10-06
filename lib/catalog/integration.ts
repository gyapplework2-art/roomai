import { z } from "zod";

import type { CatalogCandidate } from "@/lib/catalog/schema";
import { rankCatalogCandidates } from "@/lib/catalog/candidate-ranking";
import { selectDiverseCatalogCandidates } from "@/lib/catalog/candidate-diversity";

export type CatalogSelectionIdentity = {
  catalogProductId: string;
  catalogProductVariantId: string;
};

export type CatalogSelectionsByObjectId = Record<string, CatalogSelectionIdentity>;

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
