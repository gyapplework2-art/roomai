import type { CatalogCandidate } from "@/lib/catalog/schema";

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
