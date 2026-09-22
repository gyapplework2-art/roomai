"use server";

import { findCatalogProducts } from "@/lib/catalog/query";
import {
  deduplicateCatalogCandidates,
  resolveFurnitureTypeCode,
  type CatalogSelectionsByObjectId,
} from "@/lib/catalog/integration";
import { generateDesignSpecification, createDesignBrief } from "@/lib/designs/generation";
import {
  DesignPersistenceError,
  persistDesign,
} from "@/lib/designs/persistence";
import type { DesignSpecification } from "@/lib/designs/types";
import { roomGeometrySchema, roomOpeningSchema } from "@/lib/geometry/schema";
import { validateRoomOpenings } from "@/lib/geometry/openings";
import { validateRoomGeometryStructure } from "@/lib/geometry/validation";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";

type GenerationResult =
  | { success: true; designId: string; version: number; specification: DesignSpecification }
  | {
      success: false;
      error: "not_configured" | "not_found" | "missing_layout" | "invalid_layout" | "provider_failure" | "invalid_response" | "persistence_failed";
    };

export async function generateDesign(projectId: string): Promise<GenerationResult> {
  if (!projectId) return { success: false, error: "not_found" };

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    return { success: false, error: "not_found" };
  }

  const [projectResult, preferencesResult, geometryResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, room_type, width_cm, length_cm, height_cm, currency, budget_min, budget_max, user_id")
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("room_preferences")
      .select("id, project_id, primary_style, secondary_style, color_mood, primary_color, secondary_color, accent_color, metal_color, preferred_materials, avoid_materials, room_functions, must_have_items, nice_to_have_items, household_size, special_requirements, additional_notes, priority")
      .eq("project_id", projectId)
      .maybeSingle(),
    supabase
      .from("room_geometries")
      .select("id, project_id, schema_version, shape_type, template_rotation_degrees, template_mirrored_horizontal, template_mirrored_vertical, vertices, wall_segments, ceiling_height_cm, created_at, updated_at")
      .eq("project_id", projectId)
      .maybeSingle(),
  ]);

  if (projectResult.error || !projectResult.data || preferencesResult.error) {
    return { success: false, error: "not_found" };
  }
  if (geometryResult.error || !geometryResult.data) {
    return { success: false, error: "missing_layout" };
  }

  const geometryParsed = roomGeometrySchema.safeParse({
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
  if (!geometryParsed.success || !validateRoomGeometryStructure(geometryParsed.data).valid) {
    return { success: false, error: "invalid_layout" };
  }

  const { data: openingRows, error: openingsError } = await supabase
    .from("room_openings")
    .select("id, room_geometry_id, opening_type, wall_segment_id, offset_cm, width_cm, height_cm, sill_height_cm, hinge_side, swing_direction, created_at, updated_at")
    .eq("room_geometry_id", geometryResult.data.id)
    .order("created_at", { ascending: true });
  if (openingsError) return { success: false, error: "invalid_layout" };

  const openings: RoomOpening[] = [];
  for (const opening of openingRows ?? []) {
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
    if (!parsedOpening.success) return { success: false, error: "invalid_layout" };
    openings.push(parsedOpening.data);
  }
  if (!validateRoomOpenings(geometryParsed.data, openings).valid) {
    return { success: false, error: "invalid_layout" };
  }

  const generationStartedAt = new Date().toISOString();
  let specification: DesignSpecification;
  let catalogSelectionsByObjectId: CatalogSelectionsByObjectId = {};

  try {
    const brief = createDesignBrief(
      projectResult.data as Tables<"projects">,
      preferencesResult.data as Tables<"room_preferences"> | null,
      geometryParsed.data as RoomGeometry,
      openings,
    );
    const requestedFurnitureTypes = [
      ...brief.preferences.mustHaveItems,
      ...brief.preferences.niceToHaveItems,
    ]
      .map(resolveFurnitureTypeCode)
      .filter((code): code is string => code !== null);
    const uniqueFurnitureTypes = [...new Set(requestedFurnitureTypes)];
    const catalogResults = await Promise.all(
      uniqueFurnitureTypes.map(async (furnitureTypeCode) => {
        try {
          return await findCatalogProducts({
            countryCode: "US",
            furnitureTypeCode,
            currency: brief.project.currency,
            normalizedAvailability: "in_stock",
            limit: 10,
          });
        } catch (error) {
          console.error("RoomAI catalog enrichment failed", {
            projectId,
            furnitureTypeCode,
            error: error instanceof Error ? error.name : "UnknownError",
          });
          return [];
        }
      }),
    );
    const catalogCandidates = deduplicateCatalogCandidates(catalogResults.flat());
    const generation = await generateDesignSpecification(
      brief,
      catalogCandidates,
    );
    specification = generation.specification;
    catalogSelectionsByObjectId = generation.catalogSelectionsByObjectId;
  } catch (error) {
    if (error instanceof Error && error.message === "AI_NOT_CONFIGURED") {
      return { success: false, error: "not_configured" };
    }

    if (error instanceof Error && error.message === "AI_INVALID_RESPONSE") {
      return { success: false, error: "invalid_response" };
    }

    console.error("RoomAI design generation failed", {
      error: error instanceof Error ? error.message : "Unknown error",
      projectId,
    });
    return { success: false, error: "provider_failure" };
  }

  const generationCompletedAt = new Date().toISOString();

  try {
    const persistedDesign = await persistDesign(supabase, {
      projectId,
      specification,
      catalogSelectionsByObjectId,
      generationStartedAt,
      generationCompletedAt,
    });

    return {
      success: true,
      designId: persistedDesign.designId,
      version: persistedDesign.version,
      specification,
    };
  } catch (error) {
    if (error instanceof DesignPersistenceError) {
      console.error("RoomAI design persistence failed", {
        code: error.code,
        projectId,
      });
    } else {
      console.error("RoomAI design persistence failed", {
        projectId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }

    return { success: false, error: "persistence_failed" };
  }
}