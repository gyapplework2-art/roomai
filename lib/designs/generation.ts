import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import type { CatalogCandidate } from "@/lib/catalog/schema";
import { designSpecificationSchema } from "@/lib/designs/schema";
import { getWallLengthCm, getWallOrientation } from "@/lib/geometry/dimensions";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";
import type { Tables } from "@/types/database.types";

export const DESIGN_PROMPT_VERSION = "roomai-design-v2";
export const DESIGN_MODEL = "gpt-4o-mini";

type Project = Tables<"projects">;
type RoomPreferences = Tables<"room_preferences">;

export type RoomGeometryAIContext = {
  schemaVersion: string;
  shapeType: string;
  ceilingHeightCm: number | null;
  vertices: Array<{ id: string; xCm: number; yCm: number }>;
  walls: Array<{
    id: string;
    startVertexId: string;
    endVertexId: string;
    lengthCm: number;
    orientation: "horizontal" | "vertical" | "diagonal";
  }>;
  openings: Array<{
    id?: string;
    openingType: "door" | "window";
    wallSegmentId: string;
    offsetCm: number;
    widthCm: number;
    heightCm: number;
    sillHeightCm: number | null;
    hinge: "left" | "right" | null;
    swing: "inward" | "outward" | null;
  }>;
};

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
  geometry: RoomGeometryAIContext;
  geometrySummary: string;
};

function jsonStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function createDesignBrief(
  project: Project,
  preferences: RoomPreferences | null,
  geometry: RoomGeometry,
  openings: RoomOpening[],
): DesignBrief {
  const geometryContext: RoomGeometryAIContext = {
    schemaVersion: geometry.schemaVersion,
    shapeType: geometry.shapeType,
    ceilingHeightCm: geometry.ceilingHeightCm,
    vertices: geometry.vertices.map(({ id, xCm, yCm }) => ({ id, xCm, yCm })),
    walls: geometry.wallSegments.map((wall) => ({
      id: wall.id,
      startVertexId: wall.startVertexId,
      endVertexId: wall.endVertexId,
      lengthCm: getWallLengthCm(geometry, wall) ?? 0,
      orientation: getWallOrientation(geometry, wall),
    })),
    openings: openings.map((opening) => ({
      id: opening.id,
      openingType: opening.openingType,
      wallSegmentId: opening.wallSegmentId,
      offsetCm: opening.offsetCm,
      widthCm: opening.widthCm,
      heightCm: opening.heightCm,
      sillHeightCm: opening.sillHeightCm,
      hinge: opening.hingeSide,
      swing: opening.swingDirection,
    })),
  };
  const geometrySummary = [
    `Room shape: ${geometry.shapeType}`,
    ...geometryContext.walls.map((wall) => {
      const wallOpenings = geometryContext.openings.filter((opening) => opening.wallSegmentId === wall.id);
      const openingSummary = wallOpenings.map((opening) => {
        const label = opening.openingType === "door" ? "door" : "window";
        const sill = opening.openingType === "window" && opening.sillHeightCm !== null
          ? `, sill ${opening.sillHeightCm} cm`
          : "";
        return `${label} from ${opening.offsetCm}-${opening.offsetCm + opening.widthCm} cm${sill}`;
      }).join("; ");
      return `${wall.id}: ${wall.lengthCm.toFixed(1)} cm ${wall.orientation} from ${wall.startVertexId} to ${wall.endVertexId}${openingSummary ? ` (${openingSummary})` : ""}`;
    }),
  ].join("\n");

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
    geometry: geometryContext,
    geometrySummary,
  };
}

const designInstructions = `Act as an interior design planning engine. Return a compact DesignSpecification for the supplied project and preferences.

Use centimeters for every dimension and position. Use the supplied polygon vertices as the actual room boundary; do not assume the room is rectangular. Keep furniture inside the polygon and do not place it through walls. Respect wall IDs, wall lengths, doors, windows, opening offsets, door swing metadata, and window sill heights. Do not block doors or usable circulation paths, and avoid tall furniture that obstructs windows where relevant. The floor plane uses xCm/yCm from the supplied geometry; DesignSpecification furniture position xCm/yCm uses those same floor coordinates and zCm is vertical elevation.

Fit the supplied room geometry, include every must-have item, and include nice-to-have items only when practical. Respect style, color, material, function, household, priority, and budget preferences. Explain placement reasoning and include useful warnings for assumptions or fit risks.

This is a proposal, not a geometry-certified layout. Keep furniture within the supplied polygon, use conservative dimensions, avoid obvious overlaps where possible, leave warnings for uncertain constraints, and never claim validated door, window, or walkway clearance. Every furniture widthCm, depthCm, and heightCm must be a realistic numeric centimeter value strictly greater than 0; never use 0 for any furniture dimension. For physically thin objects such as rugs, mats, panels, or artwork represented as furniture, use a small realistic positive dimension, such as heightCm = 1, rather than 0. position.zCm describes elevation and does not replace the required positive physical dimensions. The DesignSpecification budget object represents the user's budget constraint, not the estimated design cost. budget.low and budget.high must always be numeric, non-negative, and satisfy budget.low <= budget.high. If both budgetMin and budgetMax are provided, preserve those user-specified bounds in the output budget using the project currency. If only budgetMin is provided, use low = budgetMin and high >= low. If only budgetMax is provided, use high = budgetMax and low <= high. If budgetMin and budgetMax are both null, output low = 0 and high = 0 as the deterministic representation of budget unspecified; this does not mean the design is expected to cost zero. Estimated design cost is represented separately by furniture and decoration estimatedPrice values. Never output budget.high less than budget.low. All required numeric fields must satisfy their DesignSpecification Zod constraints, including finite coordinates and positive dimensions. Do not invent product IDs or claim exact product availability. For nullable fields whose value is not applicable or unknown, return null. Do not omit schema fields. Use generated object IDs only for the specification objects. Do not add unnecessary prose.`;

export async function generateDesignSpecification(
  brief: DesignBrief,
  catalogCandidates: CatalogCandidate[] = [],
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("AI_NOT_CONFIGURED");
  }

  const openai = new OpenAI({ apiKey });
  const catalogGrounding = catalogCandidates.length > 0
    ? `\n\nAvailable real catalog candidates:\n${JSON.stringify(catalogCandidates)}\n\nThe supplied catalog candidates are real available products for design grounding. Use their real title, dimensions, material, color, style, and RoomAI selling price when useful. Do not invent additional catalog identity or exact availability; catalog identity selection and persistence are not part of this milestone.`
    : "";
  const response = await openai.responses.parse({
    model: DESIGN_MODEL,
    input: [
      { role: "system", content: designInstructions },
      {
        role: "user",
        content: `Design brief:\n${JSON.stringify(brief)}\n\nGeometry summary:\n${brief.geometrySummary}${catalogGrounding}`,
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