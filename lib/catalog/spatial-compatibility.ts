import type { CatalogCandidate } from "@/lib/catalog/schema";
import {
  DOOR_EDGE_CLEARANCE_CM,
  getFreestandingLocalEnvelope,
  WINDOW_SILL_CLEARANCE_CM,
} from "@/lib/furniture-planning/room-constraints";
import { getOpeningWorldPosition } from "@/lib/geometry/openings";
import { isPointInsideOrOnPolygon } from "@/lib/geometry/point-in-polygon";
import { GEOMETRY_EPSILON } from "@/lib/geometry/dimensions";
import {
  createOrientedRectangle as rotatedFootprint,
  rectanglesOverlapWithPositiveArea as footprintsOverlapWithPositiveArea,
  segmentIntersectsPolygon as segmentIntersectsFootprint,
  type Point,
  type Rectangle as Footprint,
} from "@/lib/geometry/polygons";
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

function openingClearanceFootprint(start: Point, end: Point, clearanceCm: number): Footprint | null {
  const dx = end.xCm - start.xCm;
  const dy = end.yCm - start.yCm;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= GEOMETRY_EPSILON) return null;
  const center = { xCm: (start.xCm + end.xCm) / 2, yCm: (start.yCm + end.yCm) / 2 };
  const rotationDegrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  return rotatedFootprint(center, length + clearanceCm * 2, clearanceCm * 2, rotationDegrees);
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
