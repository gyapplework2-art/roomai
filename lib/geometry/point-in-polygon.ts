import { GEOMETRY_EPSILON } from "@/lib/geometry/dimensions";
import type { Vertex } from "@/lib/geometry/types";

const EPSILON = GEOMETRY_EPSILON;

export function isPointInsideOrOnPolygon(point: { xCm: number; yCm: number }, vertices: readonly Pick<Vertex, "xCm" | "yCm">[]) {
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index++) {
    const current = vertices[index];
    const prior = vertices[previous];
    const cross = (current.xCm - prior.xCm) * (point.yCm - prior.yCm)
      - (current.yCm - prior.yCm) * (point.xCm - prior.xCm);
    const length = Math.hypot(current.xCm - prior.xCm, current.yCm - prior.yCm);
    const onSegment = (length === 0 || Math.abs(cross / length) <= EPSILON)
      && point.xCm >= Math.min(prior.xCm, current.xCm) - EPSILON
      && point.xCm <= Math.max(prior.xCm, current.xCm) + EPSILON
      && point.yCm >= Math.min(prior.yCm, current.yCm) - EPSILON
      && point.yCm <= Math.max(prior.yCm, current.yCm) + EPSILON;
    if (onSegment) return true;

    const intersects = (prior.yCm > point.yCm) !== (current.yCm > point.yCm)
      && point.xCm < (current.xCm - prior.xCm) * (point.yCm - prior.yCm) / (current.yCm - prior.yCm) + prior.xCm;
    if (intersects) inside = !inside;
  }
  return inside;
}
