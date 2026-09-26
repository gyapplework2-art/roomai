"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { findCatalogProductsByVariantIds } from "@/lib/catalog/query";
import { designSpecificationSchema } from "@/lib/designs/schema";
import { buildVisualizationBrief } from "@/lib/designs/visualization-brief";
import { runVisualizationWorkflow } from "@/lib/designs/visualization-workflow";
import {
  generateVisualizationImage,
  VISUALIZATION_BUCKET,
  VISUALIZATION_MODEL,
  VISUALIZATION_PROMPT_VERSION,
  VisualizationGenerationError,
  visualizationStoragePath,
} from "@/lib/designs/visualization";
import { validateRoomOpenings } from "@/lib/geometry/openings";
import { roomGeometrySchema, roomOpeningSchema } from "@/lib/geometry/schema";
import type { RoomOpening } from "@/lib/geometry/types";
import { validateRoomGeometryStructure } from "@/lib/geometry/validation";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";

const visualizationRequestSchema = z.object({
  projectId: z.string().uuid(),
  designId: z.string().uuid(),
});

type VisualizationResult =
  | { ok: true; visualizationId: string }
  | { ok: false; error: "unauthorized" | "design_not_found" | "invalid_design" | "invalid_room_context" | "generation_failed" | "persistence_failed" };

type DesignObject = Tables<"design_objects">;

function sanitizedGenerationError(error: unknown) {
  return error instanceof VisualizationGenerationError ? error.code : "generation_failed";
}

export async function generateDesignVisualization(input: {
  projectId: string;
  designId: string;
}): Promise<VisualizationResult> {
  const parsedInput = visualizationRequestSchema.safeParse(input);
  if (!parsedInput.success) return { ok: false, error: "design_not_found" };

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (claimsError || !userId) return { ok: false, error: "unauthorized" };

  const { projectId, designId } = parsedInput.data;
  const [projectResult, designResult, objectsResult, geometryResult] = await Promise.all([
    supabase.from("projects").select("id, user_id, name, room_type").eq("id", projectId).eq("user_id", userId).maybeSingle(),
    supabase.from("designs").select("id, project_id, design_specification").eq("id", designId).eq("project_id", projectId).maybeSingle(),
    supabase.from("design_objects").select("id, design_id, object_type, category, name, x_cm, y_cm, z_cm, width_cm, depth_cm, height_cm, rotation_degrees, material, primary_color, product_id, catalog_product_id, catalog_product_variant_id, reasoning, created_at").eq("design_id", designId).order("created_at", { ascending: true }),
    supabase.from("room_geometries").select("id, schema_version, shape_type, template_rotation_degrees, template_mirrored_horizontal, template_mirrored_vertical, vertices, wall_segments, ceiling_height_cm").eq("project_id", projectId).maybeSingle(),
  ]);

  if (projectResult.error || !projectResult.data) return { ok: false, error: "unauthorized" };
  if (designResult.error || !designResult.data || objectsResult.error) return { ok: false, error: "design_not_found" };

  const specification = designSpecificationSchema.safeParse(designResult.data.design_specification);
  if (!specification.success) return { ok: false, error: "invalid_design" };
  if (geometryResult.error || !geometryResult.data) return { ok: false, error: "invalid_room_context" };

  const geometry = roomGeometrySchema.safeParse({
    schemaVersion: geometryResult.data.schema_version,
    shapeType: geometryResult.data.shape_type,
    templateTransform: {
      rotationDegrees: geometryResult.data.template_rotation_degrees,
      mirroredHorizontal: geometryResult.data.template_mirrored_horizontal,
      mirroredVertical: geometryResult.data.template_mirrored_vertical,
    },
    ceilingHeightCm: geometryResult.data.ceiling_height_cm,
    vertices: geometryResult.data.vertices,
    wallSegments: geometryResult.data.wall_segments,
  });
  if (!geometry.success || !validateRoomGeometryStructure(geometry.data).valid) {
    return { ok: false, error: "invalid_room_context" };
  }

  const openingsResult = await supabase
    .from("room_openings")
    .select("id, opening_type, wall_segment_id, offset_cm, width_cm, height_cm, sill_height_cm, hinge_side, swing_direction")
    .eq("room_geometry_id", geometryResult.data.id)
    .order("created_at", { ascending: true });
  if (openingsResult.error) return { ok: false, error: "invalid_room_context" };

  const openings: RoomOpening[] = [];
  for (const opening of openingsResult.data ?? []) {
    const parsedOpening = roomOpeningSchema.safeParse({
      id: opening.id,
      openingType: opening.opening_type,
      wallSegmentId: opening.wall_segment_id,
      offsetCm: opening.offset_cm,
      widthCm: opening.width_cm,
      heightCm: opening.height_cm,
      sillHeightCm: opening.sill_height_cm,
      hingeSide: opening.hinge_side,
      swingDirection: opening.swing_direction,
    });
    if (!parsedOpening.success) return { ok: false, error: "invalid_room_context" };
    openings.push(parsedOpening.data);
  }
  if (!validateRoomOpenings(geometry.data, openings).valid) {
    return { ok: false, error: "invalid_room_context" };
  }

  const objects = (objectsResult.data ?? []) as DesignObject[];
  const variantIds = [...new Set(objects.flatMap((object) => object.catalog_product_variant_id ? [object.catalog_product_variant_id] : []))];
  const catalogCandidates = variantIds.length > 0
    ? await findCatalogProductsByVariantIds(variantIds).catch(() => [])
    : [];
  const brief = buildVisualizationBrief({
    project: { name: projectResult.data.name, roomType: projectResult.data.room_type },
    specification: specification.data,
    geometry: geometry.data,
    openings,
    objects,
    catalogByVariantId: new Map(catalogCandidates.map((candidate) => [candidate.variantId, candidate])),
  });

  const { data: visualization, error: attemptError } = await supabase
    .from("design_visualizations")
    .insert({
      design_id: designId,
      status: "generating",
      model_provider: "openai",
      model_name: VISUALIZATION_MODEL,
      prompt_version: VISUALIZATION_PROMPT_VERSION,
    })
    .select("id")
    .single();
  if (attemptError || !visualization) return { ok: false, error: "persistence_failed" };

  const storagePath = visualizationStoragePath({
    userId,
    projectId,
    designId,
    visualizationId: visualization.id,
  });
  const workflow = await runVisualizationWorkflow(brief, {
    generate: generateVisualizationImage,
    upload: async (image) => {
      const { error } = await supabase.storage
        .from(VISUALIZATION_BUCKET)
        .upload(storagePath, image, { contentType: "image/png", upsert: false });
      if (error) throw new Error("storage_upload_failed");
    },
    markGenerated: async () => {
      const { error } = await supabase
        .from("design_visualizations")
        .update({
          status: "generated",
          storage_bucket: VISUALIZATION_BUCKET,
          storage_path: storagePath,
          generation_completed_at: new Date().toISOString(),
          error_code: null,
          error_message: null,
        })
        .eq("id", visualization.id);
      if (error) throw new Error("visualization_update_failed");
    },
    removeUpload: async () => {
      const { error } = await supabase.storage.from(VISUALIZATION_BUCKET).remove([storagePath]);
      if (error) throw new Error("storage_cleanup_failed");
    },
    markFailed: async (errorCode) => {
      const { error } = await supabase
        .from("design_visualizations")
        .update({
          status: "failed",
          generation_completed_at: new Date().toISOString(),
          error_code: errorCode,
          error_message: "Visualization generation failed.",
        })
        .eq("id", visualization.id);
      if (error) throw new Error("visualization_failure_update_failed");
    },
    errorCode: sanitizedGenerationError,
  });

  if (workflow.ok) return { ok: true, visualizationId: visualization.id };
  console.error("RoomAI visualization generation failed", { designId, errorCode: workflow.errorCode });
  return { ok: false, error: workflow.errorCode === "generation_failed" ? "persistence_failed" : "generation_failed" };
}

export async function generateDesignVisualizationAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const designId = String(formData.get("designId") ?? "");
  const result = await generateDesignVisualization({ projectId, designId });
  if (result.ok) redirect(`/projects/${projectId}/designs/${designId}`);
  redirect(`/projects/${projectId}/designs/${designId}?visualizationError=${result.error}`);
}
