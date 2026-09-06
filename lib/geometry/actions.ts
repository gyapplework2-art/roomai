"use server";

import { z } from "zod";

import { roomGeometrySchema } from "@/lib/geometry/schema";
import { roomOpeningSchema } from "@/lib/geometry/schema";
import { validateRoomOpenings } from "@/lib/geometry/openings";
import type { RoomOpening } from "@/lib/geometry/types";
import { validateRoomGeometryStructure } from "@/lib/geometry/validation";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";

const projectIdSchema = z.string().uuid();

type GeometryResult =
  | { success: true }
  | { success: false; error: "not_found" | "invalid_geometry" | "save_failed" };

function toJson(value: unknown): Json {
  return value as Json;
}

export async function saveRoomGeometry(projectId: string, input: unknown, openingInput: unknown[] = []): Promise<GeometryResult> {
  const parsedProjectId = projectIdSchema.safeParse(projectId);
  const parsedGeometry = roomGeometrySchema.safeParse(input);
  if (!parsedProjectId.success) return { success: false, error: "not_found" };
  if (!parsedGeometry.success) return { success: false, error: "invalid_geometry" };
  if (!validateRoomGeometryStructure(parsedGeometry.data).valid) {
    return { success: false, error: "invalid_geometry" };
  }
  const parsedOpenings: RoomOpening[] = [];
  for (const opening of openingInput) {
    const parsedOpening = roomOpeningSchema.safeParse(opening);
    if (!parsedOpening.success) return { success: false, error: "invalid_geometry" };
    parsedOpenings.push(parsedOpening.data);
  }
  if (!validateRoomOpenings(parsedGeometry.data, parsedOpenings).valid) {
    return { success: false, error: "invalid_geometry" };
  }

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) return { success: false, error: "not_found" };

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, height_cm")
    .eq("id", parsedProjectId.data)
    .maybeSingle();
  if (projectError || !project) return { success: false, error: "not_found" };

  if (parsedGeometry.data.ceilingHeightCm !== project.height_cm) {
    return { success: false, error: "invalid_geometry" };
  }

  const { data: savedGeometry, error } = await supabase.from("room_geometries").upsert({
    project_id: project.id,
    schema_version: parsedGeometry.data.schemaVersion,
    shape_type: parsedGeometry.data.shapeType,
    template_rotation_degrees: parsedGeometry.data.templateTransform.rotationDegrees,
    template_mirrored_horizontal: parsedGeometry.data.templateTransform.mirroredHorizontal,
    template_mirrored_vertical: parsedGeometry.data.templateTransform.mirroredVertical,
    vertices: toJson(parsedGeometry.data.vertices),
    wall_segments: toJson(parsedGeometry.data.wallSegments),
    ceiling_height_cm: parsedGeometry.data.ceilingHeightCm,
    updated_at: new Date().toISOString(),
  }, { onConflict: "project_id" }).select("id").single();

  if (error) {
    console.error("RoomAI room geometry save failed", { projectId, error });
    return { success: false, error: "save_failed" };
  }

  const { error: deleteError } = await supabase.from("room_openings").delete().eq("room_geometry_id", savedGeometry.id);
  if (deleteError) return { success: false, error: "save_failed" };
  if (parsedOpenings.length > 0) {
    const { error: openingError } = await supabase.from("room_openings").insert(parsedOpenings.map((opening) => ({
      ...(opening.id ? { id: opening.id } : {}),
      room_geometry_id: savedGeometry.id,
      opening_type: opening.openingType,
      wall_segment_id: opening.wallSegmentId,
      offset_cm: opening.offsetCm,
      width_cm: opening.widthCm,
      height_cm: opening.heightCm,
      sill_height_cm: opening.sillHeightCm,
      hinge_side: opening.hingeSide,
      swing_direction: opening.swingDirection,
    })));
    if (openingError) return { success: false, error: "save_failed" };
  }

  return { success: true };
}
