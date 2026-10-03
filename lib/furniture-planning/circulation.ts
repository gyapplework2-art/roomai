import { GEOMETRY_EPSILON, getGeometryBounds } from "@/lib/geometry/dimensions";
import { isPointInsideOrOnPolygon } from "@/lib/geometry/point-in-polygon";
import { pointPolygonBoundaryDistance, pointPolygonDistance, minimumSegmentPolygonBoundaryDistance, minimumSegmentPolygonDistance, segmentInsidePolygon, type Point } from "@/lib/geometry/polygons";
import type { RoomGeometry } from "@/lib/geometry/types";
import { NORMAL_CIRCULATION_PROFILE } from "./clearance-rules";
import type { FurnitureFootprint } from "./footprints";
import { isValidFunctionalZone, type FunctionalZone } from "./zones";

export type CirculationUnavailableReason = "NO_DOORS" | "NO_PRIMARY_ZONE" | "INVALID_PRIMARY_ZONE" | "AMBIGUOUS_PRIMARY_ZONE" | "GRID_LIMIT_EXCEEDED" | "ALL_DOORS_EXCLUDED" | "INVALID_FOOTPRINTS";
export type CirculationEntrance = {
  id: string;
  start: Point;
  excludedReason: "PHYSICAL_DOOR_CONFLICT" | "DOOR_APPROACH_OBSTRUCTION" | null;
};
export type CirculationEvaluation = {
  status: "PASS" | "BLOCKED" | "NOT_EVALUATED";
  reason: CirculationUnavailableReason | null;
  profileId: string;
  minimumPassageWidthCm: number;
  targetZoneId: string | null;
  evaluatedDoorIds: string[];
  successfulDoorIds: string[];
  excludedDoors: Array<{ doorId: string; reason: NonNullable<CirculationEntrance["excludedReason"]> }>;
  doors: Array<{ doorId: string; start: Point; startCandidateCount: number; visitedNodeCount: number; status: "REACHABLE" | "UNREACHABLE" }>;
  gridNodeCount: number;
  targetCandidateCount: number;
};

export type CirculationGrid = {
  status: "READY";
  origin: Point;
  columns: number;
  rows: number;
  nodes: Array<{ point: Point; traversable: boolean }>;
} | { status: "GRID_LIMIT_EXCEEDED"; nodeCount: number };

const profile = NORMAL_CIRCULATION_PROFILE;
const radius = profile.minimumPassageWidthCm / 2;

export function isCirculationPointTraversable(point: Point, geometry: RoomGeometry, obstacles: readonly FurnitureFootprint[]): boolean {
  return isPointInsideOrOnPolygon(point, geometry.vertices)
    && pointPolygonBoundaryDistance(point, geometry.vertices) >= radius - GEOMETRY_EPSILON
    && obstacles.every((obstacle) => pointPolygonDistance(point, obstacle.polygon) >= radius - GEOMETRY_EPSILON);
}

export function isCirculationSegmentTraversable(start: Point, end: Point, geometry: RoomGeometry, obstacles: readonly FurnitureFootprint[]): boolean {
  return segmentInsidePolygon(start, end, geometry.vertices)
    && minimumSegmentPolygonBoundaryDistance(start, end, geometry.vertices) >= radius - GEOMETRY_EPSILON
    && obstacles.every((obstacle) => minimumSegmentPolygonDistance(start, end, obstacle.polygon) >= radius - GEOMETRY_EPSILON);
}

/** Row-major centers on the bounds-origin 10 cm lattice; blocked exterior cells remain nontraversable. */
export function buildCirculationGrid(geometry: RoomGeometry, obstacles: readonly FurnitureFootprint[]): CirculationGrid {
  const bounds = getGeometryBounds(geometry);
  const columns = Math.floor(bounds.widthCm / profile.gridResolutionCm) + 1;
  const rows = Math.floor(bounds.lengthCm / profile.gridResolutionCm) + 1;
  const nodeCount = columns * rows;
  if (!Number.isSafeInteger(nodeCount) || nodeCount > profile.maximumGridNodes) return { status: "GRID_LIMIT_EXCEEDED", nodeCount };
  const nodes: Array<{ point: Point; traversable: boolean }> = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const point = { xCm: bounds.minX + column * profile.gridResolutionCm, yCm: bounds.minY + row * profile.gridResolutionCm };
      nodes.push({ point, traversable: isCirculationPointTraversable(point, geometry, obstacles) });
    }
  }
  return { status: "READY", origin: { xCm: bounds.minX, yCm: bounds.minY }, columns, rows, nodes };
}

/** Free in-zone nodes within 75 cm of its reference center are targets; the exact center need not be free. */
export function evaluateCirculation(
  geometry: RoomGeometry,
  zones: readonly FunctionalZone[],
  obstacles: readonly FurnitureFootprint[],
  entrances: readonly CirculationEntrance[],
  invalidFootprintIds: readonly string[] = [],
): CirculationEvaluation {
  const primaryZones = zones.filter((zone) => zone.type === "PRIMARY_SEATING");
  const zone = primaryZones.length === 1 ? primaryZones[0] : undefined;
  const orderedEntrances = [...entrances].sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
  const result: CirculationEvaluation = {
    status: "NOT_EVALUATED", reason: null, profileId: profile.id, minimumPassageWidthCm: profile.minimumPassageWidthCm,
    targetZoneId: zone?.id ?? null, evaluatedDoorIds: [], successfulDoorIds: [],
    excludedDoors: [], doors: [], gridNodeCount: 0, targetCandidateCount: 0,
  };
  const unavailable = (reason: CirculationUnavailableReason) => ({ ...result, reason });
  if (orderedEntrances.length === 0) return unavailable("NO_DOORS");
  if (primaryZones.length === 0) return unavailable("NO_PRIMARY_ZONE");
  if (!zone) return unavailable("AMBIGUOUS_PRIMARY_ZONE");
  if (!isValidFunctionalZone(zone, geometry)) return unavailable("INVALID_PRIMARY_ZONE");
  if (invalidFootprintIds.length > 0) return unavailable("INVALID_FOOTPRINTS");
  const usable = orderedEntrances.filter((entrance) => {
    if (entrance.excludedReason) {
      result.excludedDoors.push({ doorId: entrance.id, reason: entrance.excludedReason });
      return false;
    }
    return true;
  });
  if (usable.length === 0) return unavailable("ALL_DOORS_EXCLUDED");
  const grid = buildCirculationGrid(geometry, obstacles);
  if (grid.status !== "READY") return unavailable("GRID_LIMIT_EXCEEDED");
  result.gridNodeCount = grid.nodes.length;
  const targets = new Set<number>();
  grid.nodes.forEach((node, index) => {
    if (node.traversable && isPointInsideOrOnPolygon(node.point, zone.polygon)
      && Math.hypot(node.point.xCm - zone.center.xCm, node.point.yCm - zone.center.yCm) <= profile.targetSearchRadiusCm + GEOMETRY_EPSILON) targets.add(index);
  });
  result.targetCandidateCount = targets.size;

  for (const entrance of usable) {
    result.evaluatedDoorIds.push(entrance.id);
    const queue: number[] = [];
    if (isCirculationPointTraversable(entrance.start, geometry, obstacles)) {
      grid.nodes.forEach((node, index) => {
        if (node.traversable && Math.hypot(node.point.xCm - entrance.start.xCm, node.point.yCm - entrance.start.yCm) <= Math.SQRT2 * profile.gridResolutionCm + GEOMETRY_EPSILON
          && isCirculationSegmentTraversable(entrance.start, node.point, geometry, obstacles)) queue.push(index);
      });
    }
    const startCandidateCount = queue.length;
    const seen = new Set(queue);
    let reached = false;
    let visitedNodeCount = 0;
    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head];
      visitedNodeCount += 1;
      if (targets.has(index)) { reached = true; break; }
      const column = index % grid.columns;
      const row = Math.floor(index / grid.columns);
      const neighbors = [
        column + 1 < grid.columns ? index + 1 : -1,
        row + 1 < grid.rows ? index + grid.columns : -1,
        column > 0 ? index - 1 : -1,
        row > 0 ? index - grid.columns : -1,
      ];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || seen.has(neighbor) || !grid.nodes[neighbor].traversable) continue;
        if (!isCirculationSegmentTraversable(grid.nodes[index].point, grid.nodes[neighbor].point, geometry, obstacles)) continue;
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
    result.doors.push({ doorId: entrance.id, start: { ...entrance.start }, startCandidateCount, visitedNodeCount, status: reached ? "REACHABLE" : "UNREACHABLE" });
    if (reached) result.successfulDoorIds.push(entrance.id);
  }
  result.status = result.successfulDoorIds.length > 0 ? "PASS" : "BLOCKED";
  return result;
}