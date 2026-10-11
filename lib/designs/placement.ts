import type { DesignSpecification } from "@/lib/designs/types";
import { designSpecificationSchema } from "@/lib/designs/schema";
import { resolveSemanticPlan, findTargetFrontUnit } from "@/lib/furniture-planning/semantic-resolver";
import { normalizeFurnitureCategory } from "@/lib/furniture-planning/normalize-plan";
import { inferFurnitureRole } from "@/lib/furniture-planning/semantic-normalize";
import { marketFurnitureRules } from "@/lib/furniture-planning/market-rules";
import { resolveFurnitureTypeCode } from "@/lib/catalog/integration";
import { repairSpatialPlan } from "@/lib/furniture-planning/spatial-repair";
import { validateSpatialPlan } from "@/lib/furniture-planning/spatial-validator";
import type { FurniturePlanV11 } from "@/lib/furniture-planning/types";
import { deriveFunctionalZones } from "@/lib/furniture-planning/zones";
import { getOpeningWorldPosition } from "@/lib/geometry/openings";
import { createOrientedRectangle, segmentIntersectsPolygon } from "@/lib/geometry/polygons";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";

export type PlacementDiagnostic = { code: string; itemIds: string[] };
export type DesignPlacementResult =
  | { ok: true; specification: DesignSpecification; changedItemIds: string[]; diagnostics: PlacementDiagnostic[] }
  | { ok: false; diagnostics: PlacementDiagnostic[] };

export function correctGeneratedDesignPlacement(
  specification: DesignSpecification,
  semanticPlan: FurniturePlanV11,
  geometry: RoomGeometry,
  openings: readonly RoomOpening[],
): DesignPlacementResult {
  const validated = designSpecificationSchema.safeParse(specification);
  if (!validated.success) return { ok: false, diagnostics: [{ code: "INVALID_DESIGN", itemIds: [] }] };
  const objectsById = new Map(specification.furniture.map((object) => [object.objectId, object]));
  const planById = new Map(semanticPlan.items.map((item) => [item.id, item]));
  const diagnostics: PlacementDiagnostic[] = [];
  if (planById.size !== semanticPlan.items.length) diagnostics.push({ code: "DUPLICATE_PLAN_ID", itemIds: [] });
  for (const object of specification.furniture) {
    if (!planById.has(object.objectId)) diagnostics.push({ code: "UNBOUND_FURNITURE", itemIds: [object.objectId] });
    const item = planById.get(object.objectId);
    if (item) {
      const planned = normalizeFurnitureCategory(item.category, item.subtype);
      const generated = normalizeFurnitureCategory(object.category);
      const canonicalCategory = planned === "area_rug" ? "rug" : planned === "sectional_sofa" ? "sectional" : planned === "accent_chair" ? "armchair" : planned;
      const supported = marketFurnitureRules.some((rule) => rule.category === canonicalCategory);
      const role = item.semanticPlacement.role;
      const expectedRole = inferFurnitureRole(canonicalCategory);
      const isSeating = ["PRIMARY_SEATING", "SECONDARY_SEATING"].includes(expectedRole);
      const isLighting = ["TASK_LIGHTING", "AMBIENT_LIGHTING"].includes(expectedRole);
      const compatibleRole = isSeating ? ["PRIMARY_SEATING", "SECONDARY_SEATING"].includes(role)
        : isLighting ? ["TASK_LIGHTING", "AMBIENT_LIGHTING"].includes(role) : role === expectedRole;
      if (!supported || !compatibleRole || ((planned === "rug" || planned === "area_rug") !== (role === "AREA_RUG"))) {
        diagnostics.push({ code: "SEMANTIC_OCCUPANCY_MISMATCH", itemIds: [object.objectId] });
      }
      if ((resolveFurnitureTypeCode(planned) ?? planned) !== (resolveFurnitureTypeCode(generated) ?? generated)) {
        diagnostics.push({ code: "FURNITURE_TYPE_MISMATCH", itemIds: [object.objectId] });
      }
    }
  }
  for (const item of semanticPlan.items) {
    if (item.priority === "required" && !objectsById.has(item.id)) diagnostics.push({ code: "REQUIRED_FURNITURE_MISSING", itemIds: [item.id] });
    if (objectsById.has(item.id)) {
      for (const relationship of item.semanticPlacement.relationships) {
        if (!objectsById.has(relationship.targetItemId)) diagnostics.push({ code: "RELATIONSHIP_TARGET_MISSING", itemIds: [item.id, relationship.targetItemId] });
      }
    }
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  const exactPlan: FurniturePlanV11 = {
    ...semanticPlan,
    items: specification.furniture.map((object) => {
      const item = planById.get(object.objectId)!;
      return {
        ...item,
        placement: {
          ...item.placement,
          approximatePosition: { xCm: object.position.xCm, yCm: object.position.yCm },
          preferredOrientationDegrees: object.rotationDegrees,
        },
        sizeRange: {
          widthMinCm: object.dimensions.widthCm, widthMaxCm: object.dimensions.widthCm,
          depthMinCm: object.dimensions.depthCm, depthMaxCm: object.dimensions.depthCm,
          heightMinCm: object.dimensions.heightCm, heightMaxCm: object.dimensions.heightCm,
        },
      };
    }),
  };
  const zones = deriveFunctionalZones(geometry);
  const evaluate = (plan: FurniturePlanV11) => {
    const report = validateSpatialPlan(plan, geometry, openings, zones);
    const failures: PlacementDiagnostic[] = report.violations.map((violation) => ({ code: violation.type, itemIds: violation.itemIds }));
    const coverage: PlacementDiagnostic[] = [];
    if (openings.some((opening) => opening.openingType === "door") && report.circulation.status === "NOT_EVALUATED") {
      failures.push({ code: `CIRCULATION_UNRESOLVED:${report.circulation.reason}`, itemIds: [] });
    }
    for (const item of plan.items) {
      if (item.semanticPlacement.mode === "CENTERED_IN_ZONE"
        && !zones.some((zone) => zone.id === item.semanticPlacement.zoneId)) {
        failures.push({ code: "ZONE_CONTEXT_UNRESOLVED", itemIds: [item.id] });
      }
      for (const relationship of item.semanticPlacement.relationships) {
        if (relationship.type !== "IN_FRONT_OF") continue;
        const target = plan.items.find((candidate) => candidate.id === relationship.targetItemId)!;
        const front = findTargetFrontUnit(target, geometry);
        const sourceCenter = item.placement.approximatePosition;
        const targetCenter = target.placement.approximatePosition;
        if (!front) {
          const diagnostic = { code: "RELATIONSHIP_DIRECTION_UNRESOLVED", itemIds: [item.id, target.id] };
          if (target.semanticPlacement.mode === "FLOATING") coverage.push(diagnostic);
          else failures.push(diagnostic);
        } else if (!sourceCenter || !targetCenter
          || (sourceCenter.xCm - targetCenter.xCm) * front.xCm + (sourceCenter.yCm - targetCenter.yCm) * front.yCm <= 0) {
          failures.push({ code: "RELATIONSHIP_DIRECTION_INVALID", itemIds: [item.id, target.id] });
        }
      }
    }
    for (const item of plan.items) {
      const object = objectsById.get(item.id)!;
      const center = item.placement.approximatePosition;
      const rotation = item.placement.preferredOrientationDegrees;
      if (!center || rotation === null) continue;
      const footprint = createOrientedRectangle(center, object.dimensions.widthCm, object.dimensions.depthCm, rotation);
      for (const opening of openings) {
        if (opening.openingType !== "window") continue;
        const span = getOpeningWorldPosition(geometry, opening);
        if (span && segmentIntersectsPolygon(span.start, span.end, footprint)
          && (opening.sillHeightCm === null || object.position.zCm + object.dimensions.heightCm > opening.sillHeightCm)) {
          failures.push({ code: "WINDOW_OBSTRUCTION", itemIds: [item.id] });
        }
      }
    }
    return { failures, coverage };
  };
  let finalPlan = exactPlan;
  let evaluation = evaluate(finalPlan);
  if (evaluation.failures.length) {
    const preferredPlan: FurniturePlanV11 = {
      ...exactPlan, items: exactPlan.items.map((item) => ({
        ...item, placement: {
          ...item.placement,
          approximatePosition: planById.get(item.id)!.placement.approximatePosition ?? item.placement.approximatePosition,
          preferredOrientationDegrees: planById.get(item.id)!.placement.preferredOrientationDegrees ?? item.placement.preferredOrientationDegrees,
        },
      })),
    };
    const resolved = resolveSemanticPlan(preferredPlan, geometry, [...openings], zones);
    finalPlan = repairSpatialPlan(resolved, geometry, openings, zones, { limits: { maxTotalCandidateEvaluations: 100 } }).repairedPlan;
    evaluation = evaluate(finalPlan);
    if (evaluation.failures.length) {
      const fallback = repairSpatialPlan(exactPlan, geometry, openings, zones, { limits: { maxTotalCandidateEvaluations: 100 } }).repairedPlan;
      const fallbackEvaluation = evaluate(fallback);
      if (fallbackEvaluation.failures.length < evaluation.failures.length) {
        finalPlan = fallback;
        evaluation = fallbackEvaluation;
      }
    }
  }
  evaluation = evaluate(finalPlan);
  if (evaluation.failures.length) return { ok: false, diagnostics: evaluation.failures };
  const positions = new Map(finalPlan.items.map((item) => [item.id, item.placement]));
  const changedItemIds: string[] = [];
  const furniture = specification.furniture.map((object) => {
    const placement = positions.get(object.objectId)!;
    const position = placement.approximatePosition!;
    const rotationDegrees = placement.preferredOrientationDegrees!;
    if (position.xCm !== object.position.xCm || position.yCm !== object.position.yCm || rotationDegrees !== object.rotationDegrees) changedItemIds.push(object.objectId);
    return { ...object, position: { ...object.position, xCm: position.xCm, yCm: position.yCm }, rotationDegrees };
  });
  const warnings = evaluation.coverage.map((diagnostic) => `Directional placement not verified for ${diagnostic.itemIds.join(" and ")}: no wall-derived front direction is available.`);
  return {
    ok: true, specification: designSpecificationSchema.parse({ ...specification, furniture, warnings: [...specification.warnings, ...warnings] }),
    changedItemIds: changedItemIds.sort(), diagnostics: evaluation.coverage,
  };
}