import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { getWallLengthCm, getWallOrientation } from "@/lib/geometry/dimensions";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";
import { furniturePlanSchema } from "@/lib/furniture-planning/schema";
import type { FurniturePlan } from "@/lib/furniture-planning/types";
import type { Tables } from "@/types/database.types";

export const FURNITURE_PLAN_PROMPT_VERSION = "roomai-furniture-plan-v1";
export const FURNITURE_PLAN_MODEL = "gpt-4o-mini";

type Project = Tables<"projects">;
type RoomPreferences = Tables<"room_preferences">;

type FurniturePlanningBrief = {
  project: {
    name: string;
    roomType: string;
    currency: string;
    budgetMin: number | null;
    budgetMax: number | null;
  };
  preferences: {
    primaryStyle: string | null;
    secondaryStyle: string | null;
    colorMood: string | null;
    colors: Record<string, string | null>;
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
  geometry: {
    schemaVersion: string;
    shapeType: string;
    ceilingHeightCm: number | null;
    vertices: RoomGeometry["vertices"];
    walls: Array<{
      id: string;
      startVertexId: string;
      endVertexId: string;
      lengthCm: number;
      orientation: "horizontal" | "vertical" | "diagonal";
    }>;
    openings: RoomOpening[];
  };
};

function jsonStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function createFurniturePlanningBrief(
  project: Project,
  preferences: RoomPreferences | null,
  geometry: RoomGeometry,
  openings: RoomOpening[],
): FurniturePlanningBrief {
  return {
    project: {
      name: project.name,
      roomType: project.room_type,
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
    geometry: {
      schemaVersion: geometry.schemaVersion,
      shapeType: geometry.shapeType,
      ceilingHeightCm: geometry.ceilingHeightCm,
      vertices: geometry.vertices,
      walls: geometry.wallSegments.map((wall) => ({
        id: wall.id,
        startVertexId: wall.startVertexId,
        endVertexId: wall.endVertexId,
        lengthCm: getWallLengthCm(geometry, wall) ?? 0,
        orientation: getWallOrientation(geometry, wall),
      })),
      openings,
    },
  };
}

const planningInstructions = `Act as an interior furniture planning engine. Return a compact FurniturePlan, not a final product list or exact DesignSpecification.

First identify the furniture categories needed from room functions, household size, must-have items, nice-to-have items, and special requirements. Must-have items are required; nice-to-have items are optional. Prefer canonical categories such as sofa, loveseat, sectional, armchair, bed, mattress, nightstand, dresser, coffee_table, side_table, dining_table, dining_chair, desk, media_console, bookshelf, storage, rug, and floor_lamp. Use the subtype to carry distinctions such as 2-seat/3-seat sofa or accent chair. Use the supplied polygon, wall IDs, wall lengths, orientations, doors, and windows. Do not assume a rectangular room. Whenever reasonably possible, provide approximatePosition for every furniture item using the supplied canonical room xCm/yCm centimeter coordinate system; it represents the approximate center or planning reference of the item. Do not leave both anchorWallId and approximatePosition null unless the item genuinely has no meaningful planned location. For wall-oriented furniture such as sofas, loveseats, sectionals, beds, desks, media consoles, bookshelves, dressers, and storage, provide a valid anchorWallId that exactly matches a supplied wall ID when appropriate, and prefer providing both anchorWallId and approximatePosition. For freestanding or central furniture such as coffee tables, dining tables, rugs, some armchairs, and some floor lamps, anchorWallId may be null, but approximatePosition should normally still be provided. preferredZone is supplemental human-readable context and does not replace approximatePosition. Do not force furniture onto a wall when floating placement is more appropriate. Keep placement qualitative and planning-level; do not attempt final collision validation or exact product placement. Avoid door zones, preserve likely circulation, avoid blocking windows, and consider sill height qualitatively.

Use the same floor coordinates as the supplied geometry: approximatePosition xCm/yCm is the approximate center or planning reference of the furniture item on the floor plane. This is not final placement. For freestanding furniture, keep approximatePosition clearly inside the room polygon. Do not place the center directly on a wall, polygon edge, or room corner. Leave enough space around the center for at least half of the item's minimum width and minimum depth to fit inside the room in the relevant local directions whenever reasonably possible. Conceptually, distance from the center to nearby room boundaries should be at least approximately widthMinCm / 2 and depthMinCm / 2 plus a small planning safety margin, such as 10 cm, whenever reasonably possible. This guidance applies especially to freestanding items such as floor lamps, armchairs, coffee tables, dining tables, rugs, and freestanding decor. A floor lamp near a chair or sofa may be close to that seating item, but its center should still remain safely inside the room polygon and not directly on a wall or corner unless it is explicitly wall-anchored. Use centimeters. Every size-range bound must be finite and strictly greater than 0: widthMinCm > 0, widthMaxCm > 0, depthMinCm > 0, depthMaxCm > 0, heightMinCm > 0, and heightMaxCm > 0. For every dimension, minCm must be less than or equal to maxCm. Never use zero as a physical dimension. Thin objects still require positive thickness: a rug may use heightMinCm = 0.5 or 1 and heightMaxCm around 1-3 cm; a mat or thin decorative panel must also use a small positive thickness. Never use heightMinCm = 0. An object may sit at elevation zCm = 0 in a later coordinate representation, but elevation is unrelated to its required positive physical height range. Provide realistic provisional market-informed size ranges, never exact product dimensions or inverted ranges. Do not choose products, brands, product IDs, or claim final physical validity. If budget is unspecified, treat it as unspecified. Keep the plan useful but reasonably compact.`;

export async function generateFurniturePlan(brief: FurniturePlanningBrief): Promise<FurniturePlan> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI_NOT_CONFIGURED");

  const openai = new OpenAI({ apiKey });
  const response = await openai.responses.parse({
    model: FURNITURE_PLAN_MODEL,
    input: [
      { role: "system", content: planningInstructions },
      { role: "user", content: `Furniture planning brief:\n${JSON.stringify(brief)}` },
    ],
    text: { format: zodTextFormat(furniturePlanSchema, "furniture_plan") },
  });

  const parsed = furniturePlanSchema.safeParse(response.output_parsed);
  if (!parsed.success) {
    console.error("RoomAI furniture plan validation failed", {
      issues: parsed.error.issues,
      promptVersion: FURNITURE_PLAN_PROMPT_VERSION,
      model: FURNITURE_PLAN_MODEL,
    });
    throw new Error("FURNITURE_PLAN_INVALID_RESPONSE");
  }

  return parsed.data;
}
