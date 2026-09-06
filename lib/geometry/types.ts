import { z } from "zod";

import {
  roomGeometrySchema,
  roomOpeningSchema,
  templateTransformSchema,
  vertexSchema,
  wallSegmentSchema,
} from "@/lib/geometry/schema";

export type Vertex = z.infer<typeof vertexSchema>;
export type WallSegment = z.infer<typeof wallSegmentSchema>;
export type TemplateTransform = z.infer<typeof templateTransformSchema>;
export type RoomGeometry = z.infer<typeof roomGeometrySchema>;
export type RoomOpening = z.infer<typeof roomOpeningSchema>;
