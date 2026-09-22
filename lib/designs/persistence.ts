import type { SupabaseClient } from "@supabase/supabase-js";

import { DESIGN_MODEL, DESIGN_PROMPT_VERSION } from "@/lib/designs/generation";
import type { DesignSpecification } from "@/lib/designs/types";
import type { Database, Json, TablesInsert } from "@/types/database.types";

const MAX_VERSION_ATTEMPTS = 3;

// TODO: Replace application-level retries and cleanup with an atomic Postgres RPC for version allocation and design/object persistence.

type DesignClient = SupabaseClient<Database>;
type DesignInsert = TablesInsert<"designs">;
type DesignObjectInsert = TablesInsert<"design_objects">;

export type PersistDesignInput = {
  projectId: string;
  specification: DesignSpecification;
  generationStartedAt: string;
  generationCompletedAt: string;
};

export type PersistedDesign = {
  designId: string;
  version: number;
};

export type PersistenceErrorCode =
  | "version_conflict"
  | "design_insert_failed"
  | "objects_insert_failed";

export class DesignPersistenceError extends Error {
  constructor(public readonly code: PersistenceErrorCode) {
    super(code);
    this.name = "DesignPersistenceError";
  }
}

function toJson(specification: DesignSpecification): Json {
  return specification as unknown as Json;
}

function isVersionConflict(error: { code?: string; message?: string; details?: string; hint?: string }) {
  const errorText = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  return error.code === "23505" && errorText.includes("designs_project_version_unique");
}

async function nextVersion(client: DesignClient, projectId: string) {
  const { data, error } = await client
    .from("designs")
    .select("version")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("RoomAI design version lookup failed", { projectId, error });
    throw new DesignPersistenceError("design_insert_failed");
  }

  return (data?.version ?? 0) + 1;
}

export function createDesignObjectInserts(
  designId: string,
  specification: DesignSpecification,
): DesignObjectInsert[] {
  const furnitureObjects: DesignObjectInsert[] = specification.furniture.map((furniture) => ({
    design_id: designId,
    object_type: "furniture",
    category: furniture.category,
    name: furniture.name,
    x_cm: furniture.position.xCm,
    y_cm: furniture.position.yCm,
    z_cm: furniture.position.zCm,
    width_cm: furniture.dimensions.widthCm,
    depth_cm: furniture.dimensions.depthCm,
    height_cm: furniture.dimensions.heightCm,
    rotation_degrees: furniture.rotationDegrees,
    material: furniture.material,
    primary_color: furniture.color,
    product_id: null,
    catalog_product_id: null,
    catalog_product_variant_id: null,
    reasoning: furniture.reasoning,
  }));

  const decorationObjects: DesignObjectInsert[] = specification.decorations.map((decoration) => ({
    design_id: designId,
    object_type: "decoration",
    category: decoration.category,
    name: decoration.name,
    x_cm: decoration.position?.xCm ?? null,
    y_cm: decoration.position?.yCm ?? null,
    z_cm: decoration.position?.zCm ?? null,
    width_cm: null,
    depth_cm: null,
    height_cm: null,
    rotation_degrees: 0,
    material: decoration.material,
    primary_color: decoration.color,
    product_id: null,
    catalog_product_id: null,
    catalog_product_variant_id: null,
    reasoning: decoration.reasoning,
  }));

  return [...furnitureObjects, ...decorationObjects];
}

export async function persistDesign(
  client: DesignClient,
  input: PersistDesignInput,
): Promise<PersistedDesign> {
  const designValues: Omit<DesignInsert, "version"> = {
    project_id: input.projectId,
    status: "generated",
    design_name: input.specification.designName,
    summary: input.specification.summary,
    design_specification: toJson(input.specification),
    model_provider: "openai",
    model_name: DESIGN_MODEL,
    prompt_version: DESIGN_PROMPT_VERSION,
    generation_started_at: input.generationStartedAt,
    generation_completed_at: input.generationCompletedAt,
  };

  for (let attempt = 0; attempt < MAX_VERSION_ATTEMPTS; attempt += 1) {
    const version = await nextVersion(client, input.projectId);
    const { data: design, error: designError } = await client
      .from("designs")
      .insert({ ...designValues, version })
      .select("id, version")
      .single();

    if (designError) {
      if (isVersionConflict(designError) && attempt < MAX_VERSION_ATTEMPTS - 1) {
        continue;
      }

      if (isVersionConflict(designError)) {
        throw new DesignPersistenceError("version_conflict");
      }

      console.error("RoomAI design insert failed", { projectId: input.projectId, error: designError });
      throw new DesignPersistenceError("design_insert_failed");
    }

    const objectInserts = createDesignObjectInserts(design.id, input.specification);
    if (objectInserts.length === 0) {
      return { designId: design.id, version: design.version };
    }

    const { error: objectsError } = await client.from("design_objects").insert(objectInserts);
    if (!objectsError) {
      return { designId: design.id, version: design.version };
    }

    console.error("RoomAI design_objects insert failed", {
      designId: design.id,
      projectId: input.projectId,
      error: objectsError,
    });
    const { error: cleanupError } = await client.from("designs").delete().eq("id", design.id);
    if (cleanupError) {
      console.error("RoomAI design cleanup failed after object insert failure", {
        designId: design.id,
        projectId: input.projectId,
        error: cleanupError,
      });
    }

    throw new DesignPersistenceError("objects_insert_failed");
  }

  throw new DesignPersistenceError("version_conflict");
}
