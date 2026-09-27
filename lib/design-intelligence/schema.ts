import { z } from "zod";

import { catalogCandidateSchema } from "@/lib/catalog/schema";

export const designCompatibilitySchema = z.enum([
  "compatible",
  "mixed",
  "incompatible",
  "unknown",
]);

export const designIntelligenceDimensionSchema = z.enum([
  "scale_proportion",
  "style_harmony",
  "color_harmony",
  "material_harmony",
  "functional_relationship",
  "composition",
]);

export const designIntentSchema = z.object({
  roomType: z.string().trim().min(1).max(120),
  primaryStyle: z.string().trim().min(1).max(120).nullable(),
  secondaryStyle: z.string().trim().min(1).max(120).nullable(),
  colorMood: z.string().trim().min(1).max(120).nullable(),
  colors: z.object({
    primary: z.string().trim().min(1).max(120).nullable(),
    secondary: z.string().trim().min(1).max(120).nullable(),
    accent: z.string().trim().min(1).max(120).nullable(),
    metal: z.string().trim().min(1).max(120).nullable(),
  }),
  preferredMaterials: z.array(z.string().trim().min(1).max(120)),
  avoidMaterials: z.array(z.string().trim().min(1).max(120)),
  roomFunctions: z.array(z.string().trim().min(1).max(160)),
  householdSize: z.string().trim().min(1).max(120).nullable(),
  specialRequirements: z.array(z.string().trim().min(1).max(240)),
});

export const designRoleSchema = z.object({
  roleId: z.string().trim().min(1).max(120),
  furnitureTypeCode: z.string().trim().min(1).max(120),
  required: z.boolean(),
  approximatePosition: z
    .object({
      xCm: z.number().finite(),
      yCm: z.number().finite(),
    })
    .nullable(),
  sizeRange: z
    .object({
      widthMinCm: z.number().finite().positive(),
      widthMaxCm: z.number().finite().positive(),
      depthMinCm: z.number().finite().positive(),
      depthMaxCm: z.number().finite().positive(),
      heightMinCm: z.number().finite().positive(),
      heightMaxCm: z.number().finite().positive(),
    })
    .refine((range) => range.widthMinCm <= range.widthMaxCm, {
      path: ["widthMaxCm"],
      message: "widthMaxCm must be greater than or equal to widthMinCm.",
    })
    .refine((range) => range.depthMinCm <= range.depthMaxCm, {
      path: ["depthMaxCm"],
      message: "depthMaxCm must be greater than or equal to depthMinCm.",
    })
    .refine((range) => range.heightMinCm <= range.heightMaxCm, {
      path: ["heightMaxCm"],
      message: "heightMaxCm must be greater than or equal to heightMinCm.",
    }),
});

export const designIntelligenceCandidateSchema = z.object({
  roleId: z.string().trim().min(1).max(120),
  candidate: catalogCandidateSchema,
});

export const designIntelligenceContextSchema = z.object({
  contractVersion: z.literal("1.0"),
  intent: designIntentSchema,
  roles: z.array(designRoleSchema),
  candidates: z.array(designIntelligenceCandidateSchema),
});

export const designDimensionEvaluationSchema = z.object({
  dimension: designIntelligenceDimensionSchema,
  compatibility: designCompatibilitySchema,
  reasons: z.array(z.string().trim().min(1).max(500)),
});

export const candidateDesignEvaluationSchema = z.object({
  roleId: z.string().trim().min(1).max(120),
  variantId: z.string().uuid(),
  dimensions: z.array(designDimensionEvaluationSchema),
  overallCompatibility: designCompatibilitySchema,
});

export const relationshipEvaluationSchema = z.object({
  relationshipId: z.string().trim().min(1).max(120),
  roleIds: z.array(z.string().trim().min(1).max(120)).min(2),
  dimensions: z.array(designDimensionEvaluationSchema),
  overallCompatibility: designCompatibilitySchema,
});

export const designIntelligenceEvaluationSchema = z.object({
  contractVersion: z.literal("1.0"),
  candidateEvaluations: z.array(candidateDesignEvaluationSchema),
  relationshipEvaluations: z.array(relationshipEvaluationSchema),
  wholeRoomEvaluation: z.object({
    dimensions: z.array(designDimensionEvaluationSchema),
    overallCompatibility: designCompatibilitySchema,
    reasons: z.array(z.string().trim().min(1).max(500)),
  }),
});

export type DesignCompatibility = z.infer<typeof designCompatibilitySchema>;
export type DesignIntelligenceDimension = z.infer<
  typeof designIntelligenceDimensionSchema
>;
export type DesignIntent = z.infer<typeof designIntentSchema>;
export type DesignRole = z.infer<typeof designRoleSchema>;
export type DesignIntelligenceCandidate = z.infer<
  typeof designIntelligenceCandidateSchema
>;
export type DesignIntelligenceContext = z.infer<
  typeof designIntelligenceContextSchema
>;
export type DesignIntelligenceEvaluation = z.infer<
  typeof designIntelligenceEvaluationSchema
>;
