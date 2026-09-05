import { z } from "zod";

import {
  budgetSchema,
  decorationObjectSchema,
  dimensionsSchema,
  designSpecificationSchema,
  furnitureObjectSchema,
  lightingSchema,
  paletteSchema,
  positionSchema,
  roomSchema,
  surfacesSchema,
} from "@/lib/designs/schema";

export type Position = z.infer<typeof positionSchema>;
export type Dimensions = z.infer<typeof dimensionsSchema>;
export type RoomSpecification = z.infer<typeof roomSchema>;
export type Palette = z.infer<typeof paletteSchema>;
export type Surfaces = z.infer<typeof surfacesSchema>;
export type Lighting = z.infer<typeof lightingSchema>;
export type Budget = z.infer<typeof budgetSchema>;
export type FurnitureObject = z.infer<typeof furnitureObjectSchema>;
export type DecorationObject = z.infer<typeof decorationObjectSchema>;
export type DesignSpecification = z.infer<typeof designSpecificationSchema>;

export type DesignBudgetValidation = {
  estimatedTotal: number;
  budgetHigh: number;
  withinBudget: boolean;
};
