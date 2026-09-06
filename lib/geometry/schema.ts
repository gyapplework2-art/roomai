import { z } from "zod";

const finiteNumber = z.number().refine(Number.isFinite, "Must be a finite number.");
const positiveNumber = finiteNumber.refine((value) => value > 0, "Must be greater than 0.");
const nonNegativeNumber = finiteNumber.refine(
  (value) => value >= 0,
  "Must be greater than or equal to 0.",
);
const nonEmptyText = z.string().trim().min(1);

export const shapeTypes = [
  "rectangle",
  "l_shape",
  "clipped_corner",
  "t_shape",
  "u_shape",
  "stepped",
] as const;

export const openingTypes = ["door", "window"] as const;
export const rotationDegrees = [0, 90, 180, 270] as const;
const rotationDegreesSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);

export const vertexSchema = z.object({
  id: nonEmptyText,
  xCm: finiteNumber,
  yCm: finiteNumber,
});

export const wallSegmentSchema = z.object({
  id: nonEmptyText,
  startVertexId: nonEmptyText,
  endVertexId: nonEmptyText,
});

const templateTransformSchema = z.object({
  rotationDegrees: rotationDegreesSchema,
  mirroredHorizontal: z.boolean(),
  mirroredVertical: z.boolean(),
});

export const roomOpeningSchema = z.object({
  id: nonEmptyText.optional(),
  openingType: z.enum(openingTypes),
  wallSegmentId: nonEmptyText,
  offsetCm: nonNegativeNumber,
  widthCm: positiveNumber,
  heightCm: positiveNumber,
  sillHeightCm: nonNegativeNumber.nullable(),
  hingeSide: z.enum(["left", "right"]).nullable(),
  swingDirection: z.enum(["inward", "outward"]).nullable(),
});

export const roomGeometrySchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    shapeType: z.enum(shapeTypes),
    templateTransform: templateTransformSchema,
    ceilingHeightCm: positiveNumber.nullable(),
    vertices: z.array(vertexSchema).min(3),
    wallSegments: z.array(wallSegmentSchema).min(3),
  })
  .superRefine((geometry, context) => {
    const vertexIds = geometry.vertices.map((vertex) => vertex.id);
    if (new Set(vertexIds).size !== vertexIds.length) {
      context.addIssue({
        code: "custom",
        path: ["vertices"],
        message: "Vertex IDs must be unique.",
      });
    }

    const wallSegmentIds = geometry.wallSegments.map((wallSegment) => wallSegment.id);
    if (new Set(wallSegmentIds).size !== wallSegmentIds.length) {
      context.addIssue({
        code: "custom",
        path: ["wallSegments"],
        message: "Wall segment IDs must be unique.",
      });
    }
  });

export { templateTransformSchema };
