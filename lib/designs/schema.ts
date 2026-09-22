import { z } from "zod";

import { ROOM_TYPES } from "@/lib/projects/validation";

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) => z.string().trim().max(max).nullable();

const finiteNumber = z.number().refine(Number.isFinite, "Must be a finite number.");
const positiveNumber = finiteNumber.refine((value) => value > 0, "Must be greater than 0.");
const nonNegativeNumber = finiteNumber.refine(
  (value) => value >= 0,
  "Must be greater than or equal to 0.",
);

export const positionSchema = z.object({
  xCm: finiteNumber,
  yCm: finiteNumber,
  zCm: finiteNumber,
});

export const dimensionsSchema = z.object({
  widthCm: positiveNumber,
  depthCm: positiveNumber,
  heightCm: positiveNumber,
});

export const roomSchema = z.object({
  widthCm: positiveNumber,
  lengthCm: positiveNumber,
  heightCm: positiveNumber.nullable(),
  roomType: z.enum(ROOM_TYPES),
});

export const paletteSchema = z.object({
  walls: nonEmptyText(120),
  primary: nonEmptyText(120),
  secondary: nonEmptyText(120),
  accent: nonEmptyText(120),
  metal: nonEmptyText(120),
});

export const surfacesSchema = z.object({
  walls: nonEmptyText(240),
  floor: nonEmptyText(240),
  ceiling: nonEmptyText(240),
});

export const lightingSchema = z.object({
  ambient: nonEmptyText(240),
  task: nonEmptyText(240),
  accent: nonEmptyText(240),
});

export const furnitureObjectSchema = z.object({
  objectId: nonEmptyText(120),
  category: nonEmptyText(120),
  name: nonEmptyText(160),
  description: nonEmptyText(500),
  material: nonEmptyText(120),
  color: nonEmptyText(120),
  dimensions: dimensionsSchema,
  position: positionSchema,
  rotationDegrees: finiteNumber,
  required: z.boolean(),
  estimatedPrice: nonNegativeNumber,
  catalogSelectionKey: nullableText(120),
  reasoning: nonEmptyText(1000),
});

export const decorationObjectSchema = z.object({
  objectId: nonEmptyText(120),
  category: nonEmptyText(120),
  name: nonEmptyText(160),
  description: nonEmptyText(500),
  material: nullableText(120),
  color: nullableText(120),
  position: positionSchema.nullable(),
  estimatedPrice: nonNegativeNumber.nullable(),
  reasoning: nullableText(1000),
});

export const budgetSchema = z
  .object({
    low: nonNegativeNumber,
    high: nonNegativeNumber,
    currency: z.enum(["USD", "CAD"]),
  })
  .refine((budget) => budget.high >= budget.low, {
    path: ["high"],
    message: "Budget high must be greater than or equal to budget low.",
  });

export const designSpecificationSchema = z
  .object({
    contractVersion: z.literal("1.0"),
    designName: nonEmptyText(160),
    summary: nonEmptyText(2000),
    room: roomSchema,
    palette: paletteSchema,
    surfaces: surfacesSchema,
    lighting: lightingSchema,
    furniture: z.array(furnitureObjectSchema),
    decorations: z.array(decorationObjectSchema),
    budget: budgetSchema,
    advice: z.array(nonEmptyText(1000)),
    warnings: z.array(nonEmptyText(1000)),
  })
  .superRefine((specification, context) => {
    const objectIds = [
      ...specification.furniture.map((object) => object.objectId),
      ...specification.decorations.map((object) => object.objectId),
    ];
    const duplicateObjectIds = objectIds.filter(
      (objectId, index) => objectIds.indexOf(objectId) !== index,
    );

    if (duplicateObjectIds.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["furniture"],
        message: "objectId values must be unique across furniture and decorations.",
      });
    }
  });

export type DesignSpecificationInput = z.input<typeof designSpecificationSchema>;

export function calculateEstimatedDesignCost(
  specification: z.infer<typeof designSpecificationSchema>,
) {
  const furnitureTotal = specification.furniture.reduce(
    (total, object) => total + object.estimatedPrice,
    0,
  );
  const decorationTotal = specification.decorations.reduce(
    (total, object) => total + (object.estimatedPrice ?? 0),
    0,
  );

  return furnitureTotal + decorationTotal;
}

export function validateDesignBudget(
  specification: z.infer<typeof designSpecificationSchema>,
) {
  const estimatedTotal = calculateEstimatedDesignCost(specification);

  return {
    estimatedTotal,
    budgetHigh: specification.budget.high,
    withinBudget: estimatedTotal <= specification.budget.high,
  };
}
