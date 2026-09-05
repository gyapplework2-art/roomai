import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { designSpecificationSchema } from "@/lib/designs/schema";
import type { Tables } from "@/types/database.types";

export const DESIGN_PROMPT_VERSION = "roomai-design-v1";
export const DESIGN_MODEL = "gpt-4o-mini";

type Project = Tables<"projects">;
type RoomPreferences = Tables<"room_preferences">;

type DesignBrief = {
  project: {
    name: string;
    roomType: string;
    widthCm: number;
    lengthCm: number;
    heightCm: number | null;
    currency: string;
    budgetMin: number | null;
    budgetMax: number | null;
  };
  preferences: {
    primaryStyle: string | null;
    secondaryStyle: string | null;
    colorMood: string | null;
    colors: {
      primary: string | null;
      secondary: string | null;
      accent: string | null;
      metal: string | null;
    };
    preferredMaterials: string[];
    avoidMaterials: string[];
    roomFunctions: string[];
    mustHaveItems: string[];
    niceToHaveItems: string[];
    householdSize: string | null;
    specialRequirements: string[];
    notes: string | null;
    priority: string | null;
  };
};

function jsonStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function createDesignBrief(
  project: Project,
  preferences: RoomPreferences | null,
): DesignBrief {
  return {
    project: {
      name: project.name,
      roomType: project.room_type,
      widthCm: project.width_cm,
      lengthCm: project.length_cm,
      heightCm: project.height_cm,
      currency: project.currency,
      budgetMin: project.budget_min,
      budgetMax: project.budget_max,
    },
    preferences: {
      primaryStyle: preferences?.primary_style ?? null,
      secondaryStyle: preferences?.secondary_style ?? null,
      colorMood: preferences?.color_mood ?? null,
      colors: {
        primary: preferences?.primary_color ?? null,
        secondary: preferences?.secondary_color ?? null,
        accent: preferences?.accent_color ?? null,
        metal: preferences?.metal_color ?? null,
      },
      preferredMaterials: jsonStrings(preferences?.preferred_materials),
      avoidMaterials: jsonStrings(preferences?.avoid_materials),
      roomFunctions: jsonStrings(preferences?.room_functions),
      mustHaveItems: jsonStrings(preferences?.must_have_items),
      niceToHaveItems: jsonStrings(preferences?.nice_to_have_items),
      householdSize: preferences?.household_size ?? null,
      specialRequirements: jsonStrings(preferences?.special_requirements),
      notes: preferences?.additional_notes ?? null,
      priority: preferences?.priority ?? null,
    },
  };
}

const designInstructions = `Act as an interior design planning engine. Return a compact DesignSpecification for the supplied project and preferences.

Use centimeters for every dimension and position. Fit the room dimensions, include every must-have item, and include nice-to-have items only when practical. Respect style, color, material, function, household, priority, and budget preferences. Explain placement reasoning and include useful warnings for assumptions or fit risks.

This is a proposal, not a geometry-certified layout. Keep furniture within approximate room bounds, use conservative dimensions, avoid obvious overlaps where possible, leave warnings for uncertain constraints, and never claim validated door, window, or walkway clearance. Every furniture widthCm, depthCm, and heightCm must be a realistic numeric centimeter value strictly greater than 0; never use 0 for any furniture dimension. For very thin objects such as rugs, mats, panels, or similar objects, use a small realistic positive thickness such as 1 cm rather than 0. Every estimatedPrice and budget low/high value must be numeric and greater than or equal to 0. All required numeric fields must satisfy their DesignSpecification Zod constraints, including finite coordinates and positive dimensions. Do not invent product IDs or claim exact product availability. For nullable fields whose value is not applicable or unknown, return null. Do not omit schema fields. Use generated object IDs only for the specification objects. Do not add unnecessary prose.`;

export async function generateDesignSpecification(brief: DesignBrief) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("AI_NOT_CONFIGURED");
  }

  const openai = new OpenAI({ apiKey });
  const response = await openai.responses.parse({
    model: DESIGN_MODEL,
    input: [
      { role: "system", content: designInstructions },
      {
        role: "user",
        content: `Design brief:\n${JSON.stringify(brief)}`,
      },
    ],
    text: {
      format: zodTextFormat(designSpecificationSchema, "design_specification"),
    },
  });

  const parsed = designSpecificationSchema.safeParse(response.output_parsed);
  if (!parsed.success) {
    console.error("RoomAI structured design validation failed", {
      issues: parsed.error.issues,
      promptVersion: DESIGN_PROMPT_VERSION,
      model: DESIGN_MODEL,
    });
    throw new Error("AI_INVALID_RESPONSE");
  }

  return parsed.data;
}