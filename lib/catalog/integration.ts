import type { CatalogCandidate } from "@/lib/catalog/schema";

export type CatalogSelectionIdentity = {
  catalogProductId: string;
  catalogProductVariantId: string;
};

export type CatalogSelectionsByObjectId = Record<string, CatalogSelectionIdentity>;

export type AICatalogCandidate = {
  catalogSelectionKey: string;
  furnitureTypeCode: string | null;
  furnitureTypeName: string | null;
  productTitle: string | null;
  roomaiDescription: string | null;
  normalizedColor: string | null;
  normalizedMaterial: string | null;
  normalizedStyle: string | null;
  configuration: string | null;
  seatingCapacity: number | null;
  dimensions: {
    widthCm: number | null;
    depthCm: number | null;
    heightCm: number | null;
    weightKg: number | null;
  };
  currency: string | null;
  roomaiSellingPrice: number | null;
};

const FURNITURE_TYPE_ALIASES: Record<string, string> = {
  rug: "area_rug",
  "area rug": "area_rug",
  area_rug: "area_rug",
};

export function resolveFurnitureTypeCode(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
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

export function createCatalogCandidateSelectionContext(candidates: CatalogCandidate[]) {
  const selectionByKey: Record<string, CatalogSelectionIdentity> = {};
  const aiCandidates: AICatalogCandidate[] = candidates.map((candidate, index) => {
    const catalogSelectionKey = `candidate_${index + 1}`;
    selectionByKey[catalogSelectionKey] = {
      catalogProductId: candidate.productId,
      catalogProductVariantId: candidate.variantId,
    };
    return {
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
    };
  });

  return { aiCandidates, selectionByKey };
}
