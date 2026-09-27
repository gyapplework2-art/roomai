import type { CatalogCandidate, CatalogQuery } from "@/lib/catalog/schema";

export type CatalogHardFilterReason =
  | "country_mismatch"
  | "furniture_type_mismatch"
  | "availability_mismatch"
  | "currency_mismatch"
  | "price_missing"
  | "price_exceeds_max"
  | "width_missing"
  | "width_exceeds_max"
  | "depth_missing"
  | "depth_exceeds_max"
  | "height_missing"
  | "height_exceeds_max";

export type CatalogHardFilterResult =
  | { eligible: true; reasons: [] }
  | { eligible: false; reasons: CatalogHardFilterReason[] };

function normalized(value: string | null | undefined): string | null {
  const result = value?.trim().toLowerCase();
  return result ? result : null;
}

export function evaluateCatalogHardFilters(
  candidate: CatalogCandidate,
  query: CatalogQuery,
): CatalogHardFilterResult {
  const reasons: CatalogHardFilterReason[] = [];

  if (normalized(candidate.countryCode) !== normalized(query.countryCode)) {
    reasons.push("country_mismatch");
  }

  if (
    normalized(candidate.furnitureTypeCode) !==
    normalized(query.furnitureTypeCode)
  ) {
    reasons.push("furniture_type_mismatch");
  }

  if (
    query.normalizedAvailability !== undefined &&
    normalized(candidate.normalizedAvailability) !==
      normalized(query.normalizedAvailability)
  ) {
    reasons.push("availability_mismatch");
  }

  if (
    query.currency !== undefined &&
    normalized(candidate.currency) !== normalized(query.currency)
  ) {
    reasons.push("currency_mismatch");
  }

  if (query.maxPrice !== undefined) {
    if (candidate.roomaiSellingPrice === null) {
      reasons.push("price_missing");
    } else if (candidate.roomaiSellingPrice > query.maxPrice) {
      reasons.push("price_exceeds_max");
    }
  }

  if (query.maxWidthCm !== undefined) {
    if (candidate.widthCm === null) {
      reasons.push("width_missing");
    } else if (candidate.widthCm > query.maxWidthCm) {
      reasons.push("width_exceeds_max");
    }
  }

  if (query.maxDepthCm !== undefined) {
    if (candidate.depthCm === null) {
      reasons.push("depth_missing");
    } else if (candidate.depthCm > query.maxDepthCm) {
      reasons.push("depth_exceeds_max");
    }
  }

  if (query.maxHeightCm !== undefined) {
    if (candidate.heightCm === null) {
      reasons.push("height_missing");
    } else if (candidate.heightCm > query.maxHeightCm) {
      reasons.push("height_exceeds_max");
    }
  }

  return reasons.length === 0
    ? { eligible: true, reasons: [] }
    : { eligible: false, reasons };
}
