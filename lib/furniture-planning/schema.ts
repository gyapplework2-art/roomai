import { z } from "zod";

const finiteNumber = z.number().refine(Number.isFinite, "Must be a finite number.");
const positiveNumber = finiteNumber.refine((value) => value > 0, "Must be greater than 0.");
const nonEmptyText = z.string().trim().min(1);

const sizeRangeSchema = z
  .object({
    widthMinCm: positiveNumber,
    widthMaxCm: positiveNumber,
    depthMinCm: positiveNumber,
    depthMaxCm: positiveNumber,
    heightMinCm: positiveNumber,
    heightMaxCm: positiveNumber,
  })
  .superRefine((range, context) => {
    if (range.widthMaxCm < range.widthMinCm) {
      context.addIssue({ code: "custom", path: ["widthMaxCm"], message: "Width range must be ordered." });
    }
    if (range.depthMaxCm < range.depthMinCm) {
      context.addIssue({ code: "custom", path: ["depthMaxCm"], message: "Depth range must be ordered." });
    }
    if (range.heightMaxCm < range.heightMinCm) {
      context.addIssue({ code: "custom", path: ["heightMaxCm"], message: "Height range must be ordered." });
    }
  });

const approximatePositionSchema = z.object({
  xCm: finiteNumber,
  yCm: finiteNumber,
});

export const furniturePlanItemSchema = z.object({
  id: nonEmptyText.max(120),
  category: nonEmptyText.max(120),
  subtype: z.string().trim().max(160).nullable(),
  priority: z.enum(["required", "preferred", "optional"]),
  placement: z.object({
    preferredZone: z.string().trim().max(160).nullable(),
    anchorWallId: z.string().trim().max(120).nullable(),
    approximatePosition: approximatePositionSchema.nullable(),
    preferredOrientationDegrees: finiteNumber.nullable(),
  }),
  sizeRange: sizeRangeSchema,
  styleHints: z.array(nonEmptyText.max(120)),
  materialHints: z.array(nonEmptyText.max(120)),
  colorHints: z.array(nonEmptyText.max(120)),
  functionalRequirements: z.array(nonEmptyText.max(300)),
  reasoning: nonEmptyText.max(1000),
});

export const furniturePlanSchema = z.object({
  schemaVersion: z.literal("1.0"),
  roomIntent: nonEmptyText.max(1200),
  items: z.array(furniturePlanItemSchema),
  notes: z.array(nonEmptyText.max(1000)),
});
