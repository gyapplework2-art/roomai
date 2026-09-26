import type { CatalogCandidate } from "@/lib/catalog/schema";
import {
  DOOR_EDGE_CLEARANCE_CM,
  getFreestandingLocalEnvelope,
  WINDOW_SILL_CLEARANCE_CM,
} from "@/lib/furniture-planning/room-constraints";
import { getOpeningWorldPosition } from "@/lib/geometry/openings";
import { isPointInsideOrOnPolygon } from "@/lib/geometry/point-in-polygon";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";
import type { Tables } from "@/types/database.types";

type DesignObjectSpatialFields = Pick<
  Tables<"design_objects">,
  "x_cm" | "y_cm"
> & { rotation_degrees: number | null };

export type NeighborSpatialFields = Pick<
  Tables<"design_objects">,
  "id" | "x_cm" | "y_cm" | "width_cm" | "depth_cm" | "rotation_degrees"
>;

export type SpatialCompatibilityResult = {
  status: "compatible" | "incompatible" | "unknown";
  candidateWidthCm: number | null;
  candidateDepthCm: number | null;
  availableWidthCm: number | null;
  availableDepthCm: number | null;
  reasons: string[];
};

function isFinitePositive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

type Point = { xCm: number; yCm: number };
type Footprint = [Point, Point, Point, Point];
const GEOMETRY_EPSILON = 1e-6;

function rotatedFootprint(
  center: Point,
  widthCm: number,
  depthCm: number,
  rotationDegrees: number,
): Footprint {
  const radians = (rotationDegrees * Math.PI) / 180;
  const widthAxis = { xCm: Math.cos(radians), yCm: Math.sin(radians) };
  const depthAxis = { xCm: -Math.sin(radians), yCm: Math.cos(radians) };
  const halfWidth = widthCm / 2;
  const halfDepth = depthCm / 2;
  return [
    { xCm: center.xCm - widthAxis.xCm * halfWidth - depthAxis.xCm * halfDepth, yCm: center.yCm - widthAxis.yCm * halfWidth - depthAxis.yCm * halfDepth },
    { xCm: center.xCm + widthAxis.xCm * halfWidth - depthAxis.xCm * halfDepth, yCm: center.yCm + widthAxis.yCm * halfWidth - depthAxis.yCm * halfDepth },
    { xCm: center.xCm + widthAxis.xCm * halfWidth + depthAxis.xCm * halfDepth, yCm: center.yCm + widthAxis.yCm * halfWidth + depthAxis.yCm * halfDepth },
    { xCm: center.xCm - widthAxis.xCm * halfWidth + depthAxis.xCm * halfDepth, yCm: center.yCm - widthAxis.yCm * halfWidth + depthAxis.yCm * halfDepth },
  ];
}

function projection(polygon: Footprint, axis: Point) {
  const values = polygon.map((point) => point.xCm * axis.xCm + point.yCm * axis.yCm);
  return { min: Math.min(...values), max: Math.max(...values) };
}

function footprintsOverlapWithPositiveArea(first: Footprint, second: Footprint): boolean {
  const axes = [first, second].flatMap((polygon) => [0, 1].map((index) => {
    const start = polygon[index];
    const end = polygon[index + 1];
    const edge = { xCm: end.xCm - start.xCm, yCm: end.yCm - start.yCm };
    const length = Math.hypot(edge.xCm, edge.yCm);
    return { xCm: -edge.yCm / length, yCm: edge.xCm / length };
  }));
  return axes.every((axis) => {
    const firstProjection = projection(first, axis);
    const secondProjection = projection(second, axis);
    return Math.min(firstProjection.max, secondProjection.max)
      - Math.max(firstProjection.min, secondProjection.min) > GEOMETRY_EPSILON;
  });
}

function openingClearanceFootprint(start: Point, end: Point, clearanceCm: number): Footprint | null {
  const dx = end.xCm - start.xCm;
  const dy = end.yCm - start.yCm;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= GEOMETRY_EPSILON) return null;
  const center = { xCm: (start.xCm + end.xCm) / 2, yCm: (start.yCm + end.yCm) / 2 };
  const rotationDegrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  return rotatedFootprint(center, length + clearanceCm * 2, clearanceCm * 2, rotationDegrees);
}

function pointOnSegment(point: Point, start: Point, end: Point): boolean {
  const cross = (end.xCm - start.xCm) * (point.yCm - start.yCm)
    - (end.yCm - start.yCm) * (point.xCm - start.xCm);
  if (Math.abs(cross) > GEOMETRY_EPSILON) return false;
  return point.xCm >= Math.min(start.xCm, end.xCm) - GEOMETRY_EPSILON
    && point.xCm <= Math.max(start.xCm, end.xCm) + GEOMETRY_EPSILON
    && point.yCm >= Math.min(start.yCm, end.yCm) - GEOMETRY_EPSILON
    && point.yCm <= Math.max(start.yCm, end.yCm) + GEOMETRY_EPSILON;
}

function orientation(first: Point, second: Point, third: Point): number {
  return (second.xCm - first.xCm) * (third.yCm - first.yCm)
    - (second.yCm - first.yCm) * (third.xCm - first.xCm);
}

function segmentsIntersect(firstStart: Point, firstEnd: Point, secondStart: Point, secondEnd: Point): boolean {
  const firstA = orientation(firstStart, firstEnd, secondStart);
  const firstB = orientation(firstStart, firstEnd, secondEnd);
  const secondA = orientation(secondStart, secondEnd, firstStart);
  const secondB = orientation(secondStart, secondEnd, firstEnd);
  if (firstA * firstB < -GEOMETRY_EPSILON && secondA * secondB < -GEOMETRY_EPSILON) return true;
  return (Math.abs(firstA) <= GEOMETRY_EPSILON && pointOnSegment(secondStart, firstStart, firstEnd))
    || (Math.abs(firstB) <= GEOMETRY_EPSILON && pointOnSegment(secondEnd, firstStart, firstEnd))
    || (Math.abs(secondA) <= GEOMETRY_EPSILON && pointOnSegment(firstStart, secondStart, secondEnd))
    || (Math.abs(secondB) <= GEOMETRY_EPSILON && pointOnSegment(firstEnd, secondStart, secondEnd));
}

function segmentIntersectsFootprint(start: Point, end: Point, footprint: Footprint): boolean {
  const vertices = footprint.map((point, index) => ({ ...point, id: `footprint-${index}` }));
  if (isPointInsideOrOnPolygon(start, vertices) || isPointInsideOrOnPolygon(end, vertices)) return true;
  return footprint.some((corner, index) => segmentsIntersect(
    start,
    end,
    corner,
    footprint[(index + 1) % footprint.length],
  ));
}

export function evaluateCatalogReplacementSpatialCompatibility(
  designObject: DesignObjectSpatialFields,
  candidate: CatalogCandidate,
  geometry: RoomGeometry,
): SpatialCompatibilityResult {
  const candidateWidthCm = candidate.widthCm;
  const candidateDepthCm = candidate.depthCm;
  const unknownResult = (reasons: string[]): SpatialCompatibilityResult => ({
    status: "unknown",
    candidateWidthCm,
    candidateDepthCm,
    availableWidthCm: null,
    availableDepthCm: null,
    reasons,
  });

  if (!isFinitePositive(candidateWidthCm) || !isFinitePositive(candidateDepthCm)) {
    return unknownResult(["candidate_dimensions_missing_or_invalid"]);
  }
  if (
    designObject.x_cm === null
    || designObject.y_cm === null
    || !Number.isFinite(designObject.x_cm)
    || !Number.isFinite(designObject.y_cm)
  ) {
    return unknownResult(["saved_position_missing_or_invalid"]);
  }
  if (designObject.rotation_degrees === null || !Number.isFinite(designObject.rotation_degrees)) {
    return unknownResult(["saved_rotation_missing_or_invalid"]);
  }

  const point = { xCm: designObject.x_cm, yCm: designObject.y_cm };
  if (!isPointInsideOrOnPolygon(point, geometry.vertices)) {
    return {
      status: "incompatible",
      candidateWidthCm,
      candidateDepthCm,
      availableWidthCm: null,
      availableDepthCm: null,
      reasons: ["saved_position_outside_room"],
    };
  }

  const envelope = getFreestandingLocalEnvelope(
    point,
    geometry,
    designObject.rotation_degrees,
  );
  if (!envelope) {
    return unknownResult(["local_room_envelope_unavailable"]);
  }

  const widthFits = candidateWidthCm <= envelope.maxWidthCm;
  const depthFits = candidateDepthCm <= envelope.maxDepthCm;
  const reasons = [
    ...(!widthFits ? ["candidate_width_exceeds_available_width"] : []),
    ...(!depthFits ? ["candidate_depth_exceeds_available_depth"] : []),
  ];

  return {
    status: widthFits && depthFits ? "compatible" : "incompatible",
    candidateWidthCm,
    candidateDepthCm,
    availableWidthCm: envelope.maxWidthCm,
    availableDepthCm: envelope.maxDepthCm,
    reasons,
  };
}

export function evaluateCatalogReplacementContextCompatibility(
  currentObjectId: string,
  designObject: DesignObjectSpatialFields,
  current: CatalogCandidate,
  candidate: CatalogCandidate,
  geometry: RoomGeometry,
  openings: RoomOpening[],
  neighbors: NeighborSpatialFields[],
): SpatialCompatibilityResult {
  const envelopeResult = evaluateCatalogReplacementSpatialCompatibility(designObject, candidate, geometry);
  if (envelopeResult.status !== "compatible") return envelopeResult;

  const point = { xCm: designObject.x_cm!, yCm: designObject.y_cm! };
  const candidateFootprint = rotatedFootprint(
    point,
    candidate.widthCm!,
    candidate.depthCm!,
    designObject.rotation_degrees!,
  );

  const currentFootprint =
    isFinitePositive(current.widthCm) && isFinitePositive(current.depthCm)
      ? rotatedFootprint(
          point,
          current.widthCm,
          current.depthCm,
          designObject.rotation_degrees!,
        )
      : null;

  for (const opening of openings) {
    const worldPosition = getOpeningWorldPosition(geometry, opening);
    if (!worldPosition) {
      return { ...envelopeResult, status: "unknown", reasons: ["opening_geometry_unavailable"] };
    }
    if (opening.openingType === "door") {
      const clearance = openingClearanceFootprint(
        worldPosition.start,
        worldPosition.end,
        DOOR_EDGE_CLEARANCE_CM,
      );
      if (!clearance) {
        return { ...envelopeResult, status: "unknown", reasons: ["opening_geometry_unavailable"] };
      }
      if (footprintsOverlapWithPositiveArea(candidateFootprint, clearance)) {
        return { ...envelopeResult, status: "incompatible", reasons: ["candidate_intersects_door_clearance"] };
      }
    } else if (segmentIntersectsFootprint(worldPosition.start, worldPosition.end, candidateFootprint)) {
      if (
        !isFinitePositive(candidate.heightCm)
        || opening.sillHeightCm === null
        || !Number.isFinite(opening.sillHeightCm)
      ) {
        return { ...envelopeResult, status: "unknown", reasons: ["window_clearance_unavailable"] };
      }
      if (candidate.heightCm > opening.sillHeightCm - WINDOW_SILL_CLEARANCE_CM) {
        return { ...envelopeResult, status: "incompatible", reasons: ["candidate_blocks_window"] };
      }
    }
  }

  for (const neighbor of neighbors) {
    if (neighbor.id === currentObjectId) continue;
    if (
      neighbor.x_cm === null
      || neighbor.y_cm === null
      || !Number.isFinite(neighbor.x_cm)
      || !Number.isFinite(neighbor.y_cm)
      || !isFinitePositive(neighbor.width_cm)
      || !isFinitePositive(neighbor.depth_cm)
      || !Number.isFinite(neighbor.rotation_degrees)
    ) continue;
    const neighborFootprint = rotatedFootprint(
      { xCm: neighbor.x_cm, yCm: neighbor.y_cm },
      neighbor.width_cm,
      neighbor.depth_cm,
      neighbor.rotation_degrees,
    );
    const candidateOverlaps =
      footprintsOverlapWithPositiveArea(candidateFootprint, neighborFootprint);

    if (!candidateOverlaps) continue;

    const currentAlreadyOverlaps =
      currentFootprint !== null
      && footprintsOverlapWithPositiveArea(currentFootprint, neighborFootprint);

    if (!currentAlreadyOverlaps) {
      return {
        ...envelopeResult,
        status: "incompatible",
        reasons: ["candidate_overlaps_neighbor"],
      };
    }
  }

  return envelopeResult;
}
