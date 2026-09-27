import type { CatalogCandidate } from "@/lib/catalog/schema";
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

const RELATIONSHIP_EVALUATORS: readonly RelationshipEvaluator[] = [
  evaluateSofaRug,
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
