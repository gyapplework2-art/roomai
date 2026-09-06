"use client";

import type { RoomGeometry } from "@/lib/geometry/types";

function bounds(geometry: RoomGeometry) {
  const xs = geometry.vertices.map((vertex) => vertex.xCm);
  const ys = geometry.vertices.map((vertex) => vertex.yCm);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const padding = Math.max(maxX - minX, maxY - minY, 1) * 0.08;
  return { minX: minX - padding, minY: minY - padding, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 };
}

export function RoomGeometryPreview({ geometry, thumbnail = false }: { geometry: RoomGeometry; thumbnail?: boolean }) {
  const view = bounds(geometry);
  const points = geometry.vertices.map((vertex) => `${vertex.xCm},${vertex.yCm}`).join(" ");

  // Geometry y coordinates use SVG's native downward-positive convention.
  return (
    <svg
      aria-label={`${geometry.shapeType} room preview`}
      className={thumbnail ? "h-24 w-full" : "h-80 w-full"}
      preserveAspectRatio="xMidYMid meet"
      viewBox={`${view.minX} ${view.minY} ${view.width} ${view.height}`}
    >
      <polygon points={points} fill="#d9e7e2" stroke="#173f3b" strokeWidth={Math.max(view.width, view.height) * 0.018} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
