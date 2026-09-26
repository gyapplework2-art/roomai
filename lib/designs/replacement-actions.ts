"use server";

import { redirect } from "next/navigation";

import { evaluateCatalogAlternativeSuitability } from "@/lib/catalog/alternative-suitability";
import { findCatalogProductsByVariantIds } from "@/lib/catalog/query";
import { createReplacementClone } from "@/lib/designs/replacement";
import { designSpecificationSchema } from "@/lib/designs/schema";
import { validateRoomOpenings } from "@/lib/geometry/openings";
import { roomGeometrySchema, roomOpeningSchema } from "@/lib/geometry/schema";
import { validateRoomGeometryStructure } from "@/lib/geometry/validation";
import type { RoomOpening } from "@/lib/geometry/types";
import { createClient } from "@/lib/supabase/server";
import type { Json, Tables } from "@/types/database.types";

export type ReplaceFurnitureResult =
  | { ok: true; designId: string }
  | { ok: false; error: "unauthorized" | "design_not_found" | "design_object_not_found" | "catalog_candidate_not_found" | "replacement_not_eligible" | "invalid_room_context" | "persistence_failed" };

type Design = Tables<"designs">;
type DesignObject = Tables<"design_objects">;

async function cleanupReplacementDesign(
  supabase: Awaited<ReturnType<typeof createClient>>,
  designId: string,
) {
  const { error } = await supabase.from("designs").delete().eq("id", designId);
  if (error) console.error("RoomAI replacement cleanup failed", { designId });
}

export async function replaceFurnitureInDesign(input: {
  projectId: string;
  designId: string;
  designObjectId: string;
  selectedCatalogVariantId: string;
}): Promise<ReplaceFurnitureResult> {
  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (claimsError || !userId) return { ok: false, error: "unauthorized" };

  const [projectResult, designResult, objectsResult, geometryResult] = await Promise.all([
    supabase.from("projects").select("id, user_id").eq("id", input.projectId).eq("user_id", userId).maybeSingle(),
    supabase.from("designs").select("id, project_id, version, status, design_name, summary, design_specification, model_provider, model_name, prompt_version, generation_started_at, generation_completed_at, created_at").eq("id", input.designId).eq("project_id", input.projectId).maybeSingle(),
    supabase.from("design_objects").select("id, design_id, object_type, category, name, x_cm, y_cm, z_cm, width_cm, depth_cm, height_cm, rotation_degrees, material, primary_color, product_id, catalog_product_id, catalog_product_variant_id, reasoning, created_at").eq("design_id", input.designId).order("created_at", { ascending: true }),
    supabase.from("room_geometries").select("id, project_id, schema_version, shape_type, template_rotation_degrees, template_mirrored_horizontal, template_mirrored_vertical, vertices, wall_segments, ceiling_height_cm, created_at, updated_at").eq("project_id", input.projectId).maybeSingle(),
  ]);
  if (projectResult.error || !projectResult.data) return { ok: false, error: "unauthorized" };
  if (designResult.error || !designResult.data) return { ok: false, error: "design_not_found" };
  if (objectsResult.error) return { ok: false, error: "persistence_failed" };

  const objects = (objectsResult.data ?? []) as DesignObject[];
  const selectedObject = objects.find((object) => object.id === input.designObjectId);
  if (!selectedObject || selectedObject.design_id !== input.designId || !selectedObject.catalog_product_variant_id) {
    return { ok: false, error: "design_object_not_found" };
  }
  const catalogCandidates = await findCatalogProductsByVariantIds([
    selectedObject.catalog_product_variant_id,
    input.selectedCatalogVariantId,
  ]).catch(() => []);
  const currentCandidate = catalogCandidates.find((candidate) => candidate.variantId === selectedObject.catalog_product_variant_id);
  const selectedCandidate = catalogCandidates.find((candidate) => candidate.variantId === input.selectedCatalogVariantId);
  if (!currentCandidate || !selectedCandidate) return { ok: false, error: "catalog_candidate_not_found" };
  if (
    selectedCandidate.variantId === currentCandidate.variantId
    || selectedCandidate.countryCode !== currentCandidate.countryCode
    || selectedCandidate.furnitureTypeCode !== currentCandidate.furnitureTypeCode
  ) return { ok: false, error: "replacement_not_eligible" };

  if (geometryResult.error || !geometryResult.data) return { ok: false, error: "invalid_room_context" };
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
    return { ok: false, error: "invalid_room_context" };
  }
  const openingsResult = await supabase.from("room_openings").select("id, room_geometry_id, opening_type, wall_segment_id, offset_cm, width_cm, height_cm, sill_height_cm, hinge_side, swing_direction, created_at, updated_at").eq("room_geometry_id", geometryResult.data.id).order("created_at", { ascending: true });
  if (openingsResult.error) return { ok: false, error: "invalid_room_context" };
  const openings: RoomOpening[] = [];
  for (const opening of openingsResult.data ?? []) {
    const parsed = roomOpeningSchema.safeParse({
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
    if (!parsed.success) return { ok: false, error: "invalid_room_context" };
    openings.push(parsed.data);
  }
  if (!validateRoomOpenings(geometryParsed.data, openings).valid) return { ok: false, error: "invalid_room_context" };

  const suitability = evaluateCatalogAlternativeSuitability(currentCandidate, selectedCandidate, {
    currentObjectId: selectedObject.id,
    designObject: {
      x_cm: selectedObject.x_cm,
      y_cm: selectedObject.y_cm,
      rotation_degrees: selectedObject.rotation_degrees,
    },
    geometry: geometryParsed.data,
    openings,
    neighbors: objects,
  });
  if (!suitability) return { ok: false, error: "replacement_not_eligible" };

  const specificationParsed = designSpecificationSchema.safeParse(designResult.data.design_specification);
  if (!specificationParsed.success) return { ok: false, error: "persistence_failed" };

  const { data: latestDesign, error: versionError } = await supabase
    .from("designs")
    .select("version")
    .eq("project_id", input.projectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (versionError) return { ok: false, error: "persistence_failed" };
  const nextVersion = (latestDesign?.version ?? 0) + 1;

  const sourceDesign = designResult.data as Design;
  const { data: newDesign, error: designInsertError } = await supabase.from("designs").insert({
    project_id: sourceDesign.project_id,
    version: nextVersion,
    status: sourceDesign.status,
    design_name: sourceDesign.design_name,
    summary: sourceDesign.summary,
    design_specification: sourceDesign.design_specification,
    model_provider: sourceDesign.model_provider,
    model_name: sourceDesign.model_name,
    prompt_version: sourceDesign.prompt_version,
    generation_started_at: sourceDesign.generation_started_at,
    generation_completed_at: sourceDesign.generation_completed_at,
  }).select("id").single();
  if (designInsertError || !newDesign) return { ok: false, error: "persistence_failed" };

  const clone = createReplacementClone(
    newDesign.id,
    specificationParsed.data,
    objects,
    selectedObject.id,
    selectedCandidate,
  );
  if (!clone) {
    await cleanupReplacementDesign(supabase, newDesign.id);
    return { ok: false, error: "persistence_failed" };
  }
  const { error: specificationUpdateError } = await supabase
    .from("designs")
    .update({ design_specification: clone.specification as unknown as Json })
    .eq("id", newDesign.id);
  if (specificationUpdateError) {
    await cleanupReplacementDesign(supabase, newDesign.id);
    return { ok: false, error: "persistence_failed" };
  }
  const { error: objectsInsertError } = await supabase.from("design_objects").insert(clone.objects);
  if (objectsInsertError) {
    await cleanupReplacementDesign(supabase, newDesign.id);
    return { ok: false, error: "persistence_failed" };
  }

  return { ok: true, designId: newDesign.id };
}

export async function replaceFurnitureAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const designId = String(formData.get("designId") ?? "");
  const designObjectId = String(formData.get("designObjectId") ?? "");
  const selectedCatalogVariantId = String(formData.get("selectedCatalogVariantId") ?? "");
  const result = await replaceFurnitureInDesign({ projectId, designId, designObjectId, selectedCatalogVariantId });
  if (result.ok) redirect(`/projects/${projectId}/designs/${result.designId}`);
  redirect(`/projects/${projectId}/designs/${designId}?replacementError=${result.error}`);
}
