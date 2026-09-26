import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  catalogCandidateSchema,
  catalogQuerySchema,
  type CatalogCandidate,
  type CatalogQuery,
} from "@/lib/catalog/schema";

const PUBLIC_CATALOG_VIEW = "roomai_catalog_public";

function createCatalogClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new CatalogQueryError("Catalog server configuration is missing.");
  }
  return createSupabaseClient(url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

type CatalogViewRow = {
  product_id: string;
  variant_id: string;
  country_code: string;
  category_code: string | null;
  category_name: string | null;
  furniture_type_code: string | null;
  furniture_type_name: string | null;
  product_title: string | null;
  roomai_description: string | null;
  normalized_color: string | null;
  normalized_material: string | null;
  normalized_style: string | null;
  configuration: string | null;
  seating_capacity: number | null;
  width_cm: number | null;
  depth_cm: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  currency: string | null;
  roomai_selling_price: number | null;
  normalized_availability: string | null;
  delivery_text: string | null;
  estimated_delivery_days_min: number | null;
  estimated_delivery_days_max: number | null;
  vendor_data_checked_at: string | null;
  roomai_price_calculated_at: string | null;
  vendor_name: string;
  product_url: string;
  primary_image_url: string | null;
};

export class CatalogQueryError extends Error {
  constructor(message = "Catalog query failed.") {
    super(message);
    this.name = "CatalogQueryError";
  }
}

function toCandidate(row: CatalogViewRow): CatalogCandidate {
  return catalogCandidateSchema.parse({
    productId: row.product_id,
    variantId: row.variant_id,
    countryCode: row.country_code,
    categoryCode: row.category_code,
    categoryName: row.category_name,
    furnitureTypeCode: row.furniture_type_code,
    furnitureTypeName: row.furniture_type_name,
    productTitle: row.product_title,
    roomaiDescription: row.roomai_description,
    normalizedColor: row.normalized_color,
    normalizedMaterial: row.normalized_material,
    normalizedStyle: row.normalized_style,
    configuration: row.configuration,
    seatingCapacity: row.seating_capacity,
    widthCm: row.width_cm,
    depthCm: row.depth_cm,
    heightCm: row.height_cm,
    weightKg: row.weight_kg,
    currency: row.currency,
    roomaiSellingPrice: row.roomai_selling_price,
    normalizedAvailability: row.normalized_availability,
    deliveryText: row.delivery_text,
    estimatedDeliveryDaysMin: row.estimated_delivery_days_min,
    estimatedDeliveryDaysMax: row.estimated_delivery_days_max,
    vendorDataCheckedAt: row.vendor_data_checked_at,
    roomaiPriceCalculatedAt: row.roomai_price_calculated_at,
    vendorName: row.vendor_name,
    productUrl: row.product_url,
    primaryImageUrl: row.primary_image_url,
  });
}

export async function findCatalogProducts(input: CatalogQuery): Promise<CatalogCandidate[]> {
  const query = catalogQuerySchema.parse(input);
  const supabase = createCatalogClient();

  let request = supabase
    .from(PUBLIC_CATALOG_VIEW)
    .select(
      "product_id,variant_id,country_code,category_code,category_name,furniture_type_code,furniture_type_name,product_title,roomai_description,normalized_color,normalized_material,normalized_style,configuration,seating_capacity,width_cm,depth_cm,height_cm,weight_kg,currency,roomai_selling_price,normalized_availability,delivery_text,estimated_delivery_days_min,estimated_delivery_days_max,vendor_data_checked_at,roomai_price_calculated_at,vendor_name,product_url,primary_image_url",
    )
    .eq("country_code", query.countryCode)
    .eq("furniture_type_code", query.furnitureTypeCode);

  if (query.normalizedAvailability !== undefined) {
    request = request.eq("normalized_availability", query.normalizedAvailability);
  }
  if (query.currency !== undefined) {
    request = request.eq("currency", query.currency);
  }
  if (query.maxPrice !== undefined) {
    request = request.lte("roomai_selling_price", query.maxPrice);
  }
  if (query.maxWidthCm !== undefined) {
    request = request.lte("width_cm", query.maxWidthCm);
  }
  if (query.maxDepthCm !== undefined) {
    request = request.lte("depth_cm", query.maxDepthCm);
  }
  if (query.maxHeightCm !== undefined) {
    request = request.lte("height_cm", query.maxHeightCm);
  }

  const { data, error } = await request.limit(query.limit);
  if (error) {
    console.error("Catalog query failed", {
      code: error.code,
      message: error.message,
    });
    throw new CatalogQueryError();
  }

  try {
    return (data as CatalogViewRow[]).map(toCandidate);
  } catch (error) {
    console.error("Catalog result validation failed", {
      message: error instanceof Error ? error.message : "Unknown catalog result error",
    });
    throw new CatalogQueryError("Catalog result validation failed.");
  }
}

export async function findCatalogProductsByVariantIds(
  variantIds: string[],
): Promise<CatalogCandidate[]> {
  const uniqueVariantIds = [...new Set(variantIds.filter((id) => id.trim() !== ""))];

  if (uniqueVariantIds.length === 0) {
    return [];
  }

  const supabase = createCatalogClient();

  const { data, error } = await supabase
    .from(PUBLIC_CATALOG_VIEW)
    .select(
      "product_id,variant_id,country_code,category_code,category_name,furniture_type_code,furniture_type_name,product_title,roomai_description,normalized_color,normalized_material,normalized_style,configuration,seating_capacity,width_cm,depth_cm,height_cm,weight_kg,currency,roomai_selling_price,normalized_availability,delivery_text,estimated_delivery_days_min,estimated_delivery_days_max,vendor_data_checked_at,roomai_price_calculated_at,vendor_name,product_url,primary_image_url",
    )
    .in("variant_id", uniqueVariantIds);

  if (error) {
    console.error("Catalog variant lookup failed", {
      code: error.code,
      message: error.message,
    });
    throw new CatalogQueryError();
  }

  try {
    return (data as CatalogViewRow[]).map(toCandidate);
  } catch (error) {
    console.error("Catalog variant lookup validation failed", {
      message: error instanceof Error ? error.message : "Unknown catalog result error",
    });
    throw new CatalogQueryError("Catalog result validation failed.");
  }
}


export async function findCatalogProductsForAlternativeContexts(
  currents: CatalogCandidate[],
): Promise<CatalogCandidate[]> {
  const contexts = [
    ...new Map(
      currents
        .filter(
          (candidate) =>
            candidate.countryCode.trim() !== "" &&
            candidate.furnitureTypeCode !== null &&
            candidate.furnitureTypeCode.trim() !== "",
        )
        .map((candidate) => [
          `${candidate.countryCode}::${candidate.furnitureTypeCode}`,
          {
            countryCode: candidate.countryCode,
            furnitureTypeCode: candidate.furnitureTypeCode!,
          },
        ]),
    ).values(),
  ];

  if (contexts.length === 0) {
    return [];
  }

  const supabase = createCatalogClient();

  const countryCodes = [...new Set(contexts.map((context) => context.countryCode))];
  const furnitureTypeCodes = [
    ...new Set(contexts.map((context) => context.furnitureTypeCode)),
  ];

  const { data, error } = await supabase
    .from(PUBLIC_CATALOG_VIEW)
    .select(
      "product_id,variant_id,country_code,category_code,category_name,furniture_type_code,furniture_type_name,product_title,roomai_description,normalized_color,normalized_material,normalized_style,configuration,seating_capacity,width_cm,depth_cm,height_cm,weight_kg,currency,roomai_selling_price,normalized_availability,delivery_text,estimated_delivery_days_min,estimated_delivery_days_max,vendor_data_checked_at,roomai_price_calculated_at,vendor_name,product_url,primary_image_url",
    )
    .in("country_code", countryCodes)
    .in("furniture_type_code", furnitureTypeCodes)
    .limit(500);

  if (error) {
    console.error("Catalog alternative context lookup failed", {
      code: error.code,
      message: error.message,
    });
    throw new CatalogQueryError();
  }

  try {
    const validContextKeys = new Set(
      contexts.map(
        (context) => `${context.countryCode}::${context.furnitureTypeCode}`,
      ),
    );

    return (data as CatalogViewRow[])
      .map(toCandidate)
      .filter(
        (candidate) =>
          candidate.furnitureTypeCode !== null &&
          validContextKeys.has(
            `${candidate.countryCode}::${candidate.furnitureTypeCode}`,
          ),
      );
  } catch (error) {
    console.error("Catalog alternative context validation failed", {
      message:
        error instanceof Error
          ? error.message
          : "Unknown catalog result error",
    });
    throw new CatalogQueryError("Catalog result validation failed.");
  }
}
