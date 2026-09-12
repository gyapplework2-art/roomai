"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { roomGeometrySchema, roomOpeningSchema } from "@/lib/geometry/schema";
import { saveRoomGeometry } from "@/lib/geometry/actions";
import { createClient } from "@/lib/supabase/server";
import {
  COLOR_MOODS,
  FURNITURE,
  MATERIAL_GROUPS,
  PRIORITIES,
  ROOM_FUNCTIONS,
  ROOM_TYPES,
  SPECIAL_REQUIREMENTS,
  STYLES,
  type WizardData,
} from "@/lib/projects/validation";

const materials = MATERIAL_GROUPS.flatMap((group) => group.items);

const optionalNumericString = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || (Number.isFinite(Number(value)) && Number(value) >= 0),
    "Must be a non-negative number.",
  );

const positiveNumericString = z
  .string()
  .trim()
  .refine(
    (value) => Number.isFinite(Number(value)) && Number(value) > 0,
    "Must be greater than 0.",
  );

const wizardPayloadSchema = z
  .object({
    room: z.object({
      projectName: z.string().trim().min(1).max(120),
      roomType: z.enum(ROOM_TYPES),
      width: positiveNumericString,
      length: positiveNumericString,
      height: optionalNumericString,
      units: z.enum(["imperial", "metric"]),
    }),
    function: z.object({
      roomFunctions: z.array(z.enum(ROOM_FUNCTIONS)).max(ROOM_FUNCTIONS.length),
      householdSize: z
        .string()
        .trim()
        .refine(
          (value) =>
            value === "" || (/^\d+$/.test(value) && Number(value) > 0),
          "Household size must be a positive integer.",
        ),
      specialRequirements: z
        .array(z.enum(SPECIAL_REQUIREMENTS))
        .max(SPECIAL_REQUIREMENTS.length),
      additionalNotes: z.string().trim().max(2000),
    }),
    style: z.object({
      primaryStyle: z.enum(STYLES),
      secondaryStyle: z.string().refine(
        (value) => value === "" || (STYLES as readonly string[]).includes(value),
        "Unsupported secondary style.",
      ),
      colorMood: z.string().refine(
        (value) => value === "" || (COLOR_MOODS as readonly string[]).includes(value),
        "Unsupported color mood.",
      ),
      primaryColor: z.string().trim().max(100),
      secondaryColor: z.string().trim().max(100),
      accentColor: z.string().trim().max(100),
      metalColor: z.string().trim().max(100),
    }),
    materials: z.object({
      preferred: z.array(z.enum(materials as [string, ...string[]])).max(materials.length),
      avoid: z.array(z.enum(materials as [string, ...string[]])).max(materials.length),
    }),
    furniture: z.object({
      mustHave: z.array(z.enum(FURNITURE)).max(FURNITURE.length),
      niceToHave: z.array(z.enum(FURNITURE)).max(FURNITURE.length),
    }),
    budget: z.object({
      currency: z.enum(["USD", "CAD"]),
      minimum: optionalNumericString,
      maximum: optionalNumericString,
      priority: z.string().refine(
        (value) => value === "" || PRIORITIES.some((priority) => priority.value === value),
        "Unsupported priority.",
      ),
    }),
    geometry: roomGeometrySchema.nullable(),
    openings: z.array(roomOpeningSchema).max(64),
  })
  .superRefine((payload, context) => {
    if (payload.style.secondaryStyle === payload.style.primaryStyle) {
      context.addIssue({
        code: "custom",
        path: ["style", "secondaryStyle"],
        message: "Secondary style must differ from primary style.",
      });
    }

    if (payload.materials.preferred.some((item) => payload.materials.avoid.includes(item))) {
      context.addIssue({
        code: "custom",
        path: ["materials"],
        message: "A material cannot be both preferred and avoided.",
      });
    }

    if (payload.furniture.mustHave.some((item) => payload.furniture.niceToHave.includes(item))) {
      context.addIssue({
        code: "custom",
        path: ["furniture"],
        message: "An item cannot be both must-have and nice-to-have.",
      });
    }

    if (
      payload.budget.minimum !== "" &&
      payload.budget.maximum !== "" &&
      Number(payload.budget.maximum) < Number(payload.budget.minimum)
    ) {
      context.addIssue({
        code: "custom",
        path: ["budget", "maximum"],
        message: "Maximum budget must be greater than or equal to minimum budget.",
      });
    }
  });

type CreateProjectResult = { error?: string };

function toCentimeters(value: string, units: WizardData["room"]["units"]) {
  const numericValue = Number(value);
  const centimeters = units === "metric" ? numericValue * 100 : numericValue * 30.48;

  if (!Number.isFinite(centimeters) || centimeters <= 0) {
    throw new Error("Invalid room dimension.");
  }

  return centimeters;
}

function optionalCentimeters(value: string, units: WizardData["room"]["units"]) {
  return value === "" ? null : toCentimeters(value, units);
}

function optionalBudget(value: string) {
  return value === "" ? null : Number(value);
}

export async function createProject(payload: unknown): Promise<CreateProjectResult> {
  const parsed = wizardPayloadSchema.safeParse(payload);

  if (!parsed.success) {
    return { error: "Please review your project details and try again." };
  }

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;

  if (claimsError || !userId) {
    return { error: "Your session has expired. Please sign in again." };
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      user_id: userId,
      name: parsed.data.room.projectName,
      room_type: parsed.data.room.roomType,
      status: "draft",
      width_cm: toCentimeters(parsed.data.room.width, parsed.data.room.units),
      length_cm: toCentimeters(parsed.data.room.length, parsed.data.room.units),
      height_cm: optionalCentimeters(parsed.data.room.height, parsed.data.room.units),
      currency: parsed.data.budget.currency,
      budget_min: optionalBudget(parsed.data.budget.minimum),
      budget_max: optionalBudget(parsed.data.budget.maximum),
    })
    .select("id")
    .single();

  if (projectError || !project) {
    return { error: "We could not create your project. Please try again." };
  }

  const { error: preferencesError } = await supabase.from("room_preferences").insert({
    project_id: project.id,
    primary_style: parsed.data.style.primaryStyle,
    secondary_style: parsed.data.style.secondaryStyle || null,
    color_mood: parsed.data.style.colorMood || null,
    primary_color: parsed.data.style.primaryColor || null,
    secondary_color: parsed.data.style.secondaryColor || null,
    accent_color: parsed.data.style.accentColor || null,
    metal_color: parsed.data.style.metalColor || null,
    preferred_materials: parsed.data.materials.preferred,
    avoid_materials: parsed.data.materials.avoid,
    room_functions: parsed.data.function.roomFunctions,
    must_have_items: parsed.data.furniture.mustHave,
    nice_to_have_items: parsed.data.furniture.niceToHave,
    household_size: parsed.data.function.householdSize || null,
    special_requirements: parsed.data.function.specialRequirements,
    additional_notes: parsed.data.function.additionalNotes || null,
    priority: parsed.data.budget.priority || null,
  });

  if (preferencesError) {
    await supabase.from("projects").delete().eq("id", project.id).eq("user_id", userId);
    return { error: "We could not finish creating your project. Please try again." };
  }

  if (!parsed.data.geometry) {
    await supabase.from("projects").delete().eq("id", project.id).eq("user_id", userId);
    return { error: "Choose a room shape before creating your project." };
  }

  const geometryResult = await saveRoomGeometry(project.id, parsed.data.geometry, parsed.data.openings);
  if (!geometryResult.success) {
    await supabase.from("projects").delete().eq("id", project.id).eq("user_id", userId);
    return { error: "We could not save your room shape. Please try again." };
  }

  redirect(`/projects/${project.id}`);
}
