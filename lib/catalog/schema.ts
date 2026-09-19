import { z } from "zod";

const finiteNonNegativeNumber = z.number().finite().nonnegative();
const finitePositiveNumber = z.number().finite().positive();

export const catalogQuerySchema = z.object({
  countryCode: z.string().trim().min(1).max(16),
  furnitureTypeCode: z.string().trim().min(1).max(64),
  normalizedAvailability: z.string().trim().min(1).max(32).optional(),
  currency: z.string().trim().min(1).max(8).optional(),
  maxPrice: finiteNonNegativeNumber.optional(),
  maxWidthCm: finitePositiveNumber.optional(),
  maxDepthCm: finitePositiveNumber.optional(),
  maxHeightCm: finitePositiveNumber.optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

export const catalogCandidateSchema = z.object({
  productId: z.string(),
  variantId: z.string(),
  countryCode: z.string(),
  categoryCode: z.string().nullable(),
  categoryName: z.string().nullable(),
  furnitureTypeCode: z.string().nullable(),
  furnitureTypeName: z.string().nullable(),
  productTitle: z.string().nullable(),
  roomaiDescription: z.string().nullable(),
  normalizedColor: z.string().nullable(),
  normalizedMaterial: z.string().nullable(),
  normalizedStyle: z.string().nullable(),
  configuration: z.string().nullable(),
  seatingCapacity: z.number().nullable(),
  widthCm: z.number().nullable(),
  depthCm: z.number().nullable(),
  heightCm: z.number().nullable(),
  weightKg: z.number().nullable(),
  currency: z.string().nullable(),
  roomaiSellingPrice: z.number().nullable(),
  normalizedAvailability: z.string().nullable(),
  deliveryText: z.string().nullable(),
  estimatedDeliveryDaysMin: z.number().nullable(),
  estimatedDeliveryDaysMax: z.number().nullable(),
  vendorDataCheckedAt: z.string().nullable(),
  roomaiPriceCalculatedAt: z.string().nullable(),
});

export type CatalogCandidate = z.infer<typeof catalogCandidateSchema>;
