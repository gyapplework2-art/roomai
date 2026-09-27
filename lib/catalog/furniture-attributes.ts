import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { CatalogQueryError } from "@/lib/catalog/query";
import type { CatalogCandidate } from "@/lib/catalog/schema";
import {
  normalizeFurnitureAttributes,
  type FurnitureDesignAttributes,
} from "@/lib/design-intelligence/furniture-attributes";

type VariantAttributeRow = {
  id: string;
  variant_attributes: unknown;
};

type VariantAttributeQuery = (variantIds: string[]) => Promise<VariantAttributeRow[]>;

async function queryVariantAttributes(variantIds: string[]): Promise<VariantAttributeRow[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new CatalogQueryError("Catalog server configuration is missing.");

  const supabase = createSupabaseClient(url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await supabase
    .from("catalog_product_variants")
    .select("id,variant_attributes")
    .in("id", variantIds);
  if (error) throw new CatalogQueryError();
  return data ?? [];
}

function normalizedAttributeBag(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const normalized = (value as Record<string, unknown>).normalized_attributes;
  return normalized !== null && typeof normalized === "object" && !Array.isArray(normalized)
    ? normalized as Record<string, unknown>
    : null;
}

export async function getFurnitureAttributesByVariantIds(
  variantIds: readonly string[],
  seatingCapacityByVariantId?: ReadonlyMap<string, CatalogCandidate["seatingCapacity"]>,
  query: VariantAttributeQuery = queryVariantAttributes,
): Promise<Map<string, FurnitureDesignAttributes>> {
  const ids = [...new Set(variantIds.filter((id) => id.trim() !== ""))];
  if (ids.length === 0) return new Map();

  let rows: VariantAttributeRow[];
  try {
    rows = await query(ids);
  } catch (error) {
    if (error instanceof CatalogQueryError) throw error;
    throw new CatalogQueryError();
  }

  const rowsById = new Map(rows.filter((row) => ids.includes(row.id)).map((row) => [row.id, row]));
  return new Map(ids.map((id) => [
    id,
    normalizeFurnitureAttributes(
      { seatingCapacity: seatingCapacityByVariantId?.get(id) ?? null },
      { normalizedAttributes: normalizedAttributeBag(rowsById.get(id)?.variant_attributes) ?? undefined },
    ),
  ]));
}