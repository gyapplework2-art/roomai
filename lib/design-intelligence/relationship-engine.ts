import type { CatalogCandidate } from "@/lib/catalog/schema";
import { evaluateBedNightstandRelationship } from "@/lib/design-intelligence/bed-nightstand-relationship";
import { evaluateDeskOfficeChairRelationship } from "@/lib/design-intelligence/desk-office-chair-relationship";
import { evaluateDiningTableChairRelationship } from "@/lib/design-intelligence/dining-table-chair-relationship";
import {
  relationshipEvaluationSchema,
  type DesignRole,
} from "@/lib/design-intelligence/schema";
import { evaluateSofaRugRelationship } from "@/lib/design-intelligence/sofa-rug-relationship";

export type RelationshipEvaluation = ReturnType<
  typeof relationshipEvaluationSchema.parse
>;

export type RelationshipInput = {
  firstRole: DesignRole;
  firstCandidate: CatalogCandidate;
  secondRole: DesignRole;
  secondCandidate: CatalogCandidate;
};

type RelationshipEvaluator = (
  input: RelationshipInput,
) => RelationshipEvaluation | null;

function evaluateSofaRug(
  input: RelationshipInput,
): RelationshipEvaluation | null {
  const result = evaluateSofaRugRelationship(
    input.firstRole,
    input.firstCandidate,
    input.secondRole,
    input.secondCandidate,
  );

  if (!result.applicable) return null;

  return relationshipEvaluationSchema.parse({
    relationshipId: "sofa_rug",
    roleIds: [
      result.seatingRoleId,
      result.rugRoleId,
    ],
    dimensions: [
      {
        dimension: "scale_proportion",
        compatibility: result.scaleProportion.compatibility,
        reasons: result.scaleProportion.reasons,
      },
      {
        dimension: "color_harmony",
        compatibility: result.colorHarmony.compatibility,
        reasons: result.colorHarmony.reasons,
      },
      {
        dimension: "composition",
        compatibility: result.composition.compatibility,
        reasons: result.composition.reasons,
      },
    ],
    overallCompatibility: result.overallCompatibility,
  });
}

function evaluateDiningTableChair(
  input: RelationshipInput,
): RelationshipEvaluation | null {
  const result = evaluateDiningTableChairRelationship(
    input.firstRole,
    input.firstCandidate,
    input.secondRole,
    input.secondCandidate,
  );

  if (!result.applicable) return null;

  return relationshipEvaluationSchema.parse({
    relationshipId: "dining_table_chair",
    roleIds: [
      result.tableRoleId,
      result.chairRoleId,
    ],
    dimensions: [
      {
        dimension: "scale_proportion",
        compatibility: result.scaleProportion.compatibility,
        reasons: result.scaleProportion.reasons,
      },
      {
        dimension: "functional_relationship",
        compatibility: result.functionalRelationship.compatibility,
        reasons: result.functionalRelationship.reasons,
      },
      {
        dimension: "color_harmony",
        compatibility: result.colorHarmony.compatibility,
        reasons: result.colorHarmony.reasons,
      },
    ],
    overallCompatibility: result.overallCompatibility,
  });
}

function evaluateBedNightstand(
  input: RelationshipInput,
): RelationshipEvaluation | null {
  const result = evaluateBedNightstandRelationship(
    input.firstRole,
    input.firstCandidate,
    input.secondRole,
    input.secondCandidate,
  );

  if (!result.applicable) return null;

  return relationshipEvaluationSchema.parse({
    relationshipId: "bed_nightstand",
    roleIds: [
      result.bedRoleId,
      result.nightstandRoleId,
    ],
    dimensions: [
      {
        dimension: "scale_proportion",
        compatibility: result.scaleProportion.compatibility,
        reasons: result.scaleProportion.reasons,
      },
      {
        dimension: "functional_relationship",
        compatibility: result.functionalRelationship.compatibility,
        reasons: result.functionalRelationship.reasons,
      },
      {
        dimension: "color_harmony",
        compatibility: result.colorHarmony.compatibility,
        reasons: result.colorHarmony.reasons,
      },
    ],
    overallCompatibility: result.overallCompatibility,
  });
}

function evaluateDeskOfficeChair(
  input: RelationshipInput,
): RelationshipEvaluation | null {
  const result = evaluateDeskOfficeChairRelationship(
    input.firstRole,
    input.firstCandidate,
    input.secondRole,
    input.secondCandidate,
  );

  if (!result.applicable) return null;

  return relationshipEvaluationSchema.parse({
    relationshipId: "desk_office_chair",
    roleIds: [
      result.deskRoleId,
      result.chairRoleId,
    ],
    dimensions: [
      {
        dimension: "scale_proportion",
        compatibility: result.scaleProportion.compatibility,
        reasons: result.scaleProportion.reasons,
      },
      {
        dimension: "functional_relationship",
        compatibility: result.functionalRelationship.compatibility,
        reasons: result.functionalRelationship.reasons,
      },
      {
        dimension: "color_harmony",
        compatibility: result.colorHarmony.compatibility,
        reasons: result.colorHarmony.reasons,
      },
    ],
    overallCompatibility: result.overallCompatibility,
  });
}

const RELATIONSHIP_EVALUATORS: readonly RelationshipEvaluator[] = [
  evaluateSofaRug,
  evaluateDiningTableChair,
  evaluateBedNightstand,
  evaluateDeskOfficeChair,
];

export function evaluateFurnitureRelationship(
  input: RelationshipInput,
): RelationshipEvaluation | null {
  for (const evaluator of RELATIONSHIP_EVALUATORS) {
    const evaluation = evaluator(input);

    if (evaluation) return evaluation;
  }

  return null;
}
