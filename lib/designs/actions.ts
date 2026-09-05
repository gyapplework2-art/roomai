"use server";

import { generateDesignSpecification, createDesignBrief } from "@/lib/designs/generation";
import {
  DesignPersistenceError,
  persistDesign,
} from "@/lib/designs/persistence";
import type { DesignSpecification } from "@/lib/designs/types";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";

type GenerationResult =
  | { success: true; designId: string; version: number; specification: DesignSpecification }
  | {
      success: false;
      error: "not_configured" | "not_found" | "provider_failure" | "invalid_response" | "persistence_failed";
    };

export async function generateDesign(projectId: string): Promise<GenerationResult> {
  if (!projectId) return { success: false, error: "not_found" };

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    return { success: false, error: "not_found" };
  }

  const [projectResult, preferencesResult] = await Promise.all([
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
  ]);

  if (projectResult.error || !projectResult.data || preferencesResult.error) {
    return { success: false, error: "not_found" };
  }

  const generationStartedAt = new Date().toISOString();
  let specification: DesignSpecification;

  try {
    specification = await generateDesignSpecification(
      createDesignBrief(
        projectResult.data as Tables<"projects">,
        preferencesResult.data as Tables<"room_preferences"> | null,
      ),
    );
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