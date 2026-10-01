import { z } from "zod";

import {
  alignments,
  furnitureRoles,
  placementModes,
  relationshipTypes,
} from "@/lib/furniture-planning/semantic-types";
import { furniturePlanItemSchema, furniturePlanSchema } from "@/lib/furniture-planning/schema";

const nonEmptyText = z.string().trim().min(1);

export const furnitureRoleSchema = z.enum(furnitureRoles);
export const placementModeSchema = z.enum(placementModes);
export const alignmentSchema = z.enum(alignments);
export const relationshipTypeSchema = z.enum(relationshipTypes);

export const semanticPlacementRelationshipSchema = z.object({
  type: relationshipTypeSchema,
  targetItemId: nonEmptyText.max(120),
});

export const semanticPlacementSchema = z.object({
  role: furnitureRoleSchema,
  mode: placementModeSchema,
  alignment: alignmentSchema.nullable(),
  zoneId: z.string().trim().max(160).nullable(),
  targetWallId: z.string().trim().max(120).nullable(),
  relationships: z.array(semanticPlacementRelationshipSchema),
  fallbackModes: z.array(placementModeSchema),
});

export const furniturePlanV11ItemSchema = furniturePlanItemSchema.extend({
  semanticPlacement: semanticPlacementSchema,
});

export const furniturePlanV11Schema = z
  .object({
    schemaVersion: z.literal("1.1"),
    roomIntent: nonEmptyText.max(1200),
    items: z.array(furniturePlanV11ItemSchema),
    notes: z.array(nonEmptyText.max(1000)),
  })
  .superRefine((plan, context) => {
    const itemIds = new Set(plan.items.map((item) => item.id));
    for (let i = 0; i < plan.items.length; i++) {
      const item = plan.items[i];
      for (let r = 0; r < item.semanticPlacement.relationships.length; r++) {
        const rel = item.semanticPlacement.relationships[r];
        if (rel.targetItemId === item.id) {
          context.addIssue({
            code: "custom",
            path: ["items", i, "semanticPlacement", "relationships", r, "targetItemId"],
            message: "A furniture item cannot have a relationship with itself.",
          });
        }
        if (!itemIds.has(rel.targetItemId)) {
          context.addIssue({
            code: "custom",
            path: ["items", i, "semanticPlacement", "relationships", r, "targetItemId"],
            message: `Relationship target "${rel.targetItemId}" does not match any item ID in the plan.`,
          });
        }
      }
    }
  });

export const acceptedFurniturePlanSchema = z.discriminatedUnion("schemaVersion", [
  furniturePlanSchema,
  furniturePlanV11Schema,
]);
