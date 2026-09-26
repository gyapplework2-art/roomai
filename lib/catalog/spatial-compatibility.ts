import type { CatalogCandidate } from "@/lib/catalog/schema";
import { getFreestandingLocalEnvelope } from "@/lib/furniture-planning/room-constraints";
import { isPointInsideOrOnPolygon } from "@/lib/geometry/point-in-polygon";
import type { RoomGeometry } from "@/lib/geometry/types";
import type { Tables } from "@/types/database.types";

type DesignObjectSpatialFields = Pick<
  Tables<"design_objects">,
  "x_cm" | "y_cm"
> & { rotation_degrees: number | null };

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
