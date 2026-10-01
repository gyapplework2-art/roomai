import { z } from "zod";

import { furniturePlanItemSchema, furniturePlanSchema } from "@/lib/furniture-planning/schema";
import {
  furniturePlanV11ItemSchema,
  furniturePlanV11Schema,
  acceptedFurniturePlanSchema,
  semanticPlacementSchema,
} from "@/lib/furniture-planning/semantic-schema";

export type FurniturePlanItemV1 = z.infer<typeof furniturePlanItemSchema>;
export type FurniturePlanV1 = z.infer<typeof furniturePlanSchema>;

export type FurniturePlanItemV11 = z.infer<typeof furniturePlanV11ItemSchema>;
export type FurniturePlanV11 = z.infer<typeof furniturePlanV11Schema>;

export type AcceptedFurniturePlan = z.infer<typeof acceptedFurniturePlanSchema>;
export type SemanticPlacement = z.infer<typeof semanticPlacementSchema>;

// Backward-compatible aliases for existing v1.0 consumers
export type FurniturePlanItem = FurniturePlanItemV1;
export type FurniturePlan = FurniturePlanV1;

export type AnyFurniturePlan = FurniturePlanV1 | FurniturePlanV11;
export type AnyFurniturePlanItem = FurniturePlanItemV1 | FurniturePlanItemV11;

export * from "@/lib/furniture-planning/semantic-types";
