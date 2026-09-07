import { z } from "zod";

import { furniturePlanItemSchema, furniturePlanSchema } from "@/lib/furniture-planning/schema";

export type FurniturePlanItem = z.infer<typeof furniturePlanItemSchema>;
export type FurniturePlan = z.infer<typeof furniturePlanSchema>;
