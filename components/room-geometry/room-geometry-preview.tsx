"use client";

import { useRef, useState } from "react";

import {
  GEOMETRY_EPSILON,
  getWallEndpoints,
  getWallLengthCm,
  getWallOrientation,
  wallDisplayLabel,
} from "@/lib/geometry/dimensions";
import { createDraggedGeometryCandidate, type DragPoint } from "@/lib/geometry/drag";
import { roomGeometrySchema } from "@/lib/geometry/schema";
import { normalizeGeometry } from "@/lib/geometry/transforms";
import { validateRoomGeometryStructure } from "@/lib/geometry/validation";
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

const wallColors = ["#173f3b", "#9a5b36", "#4d6475", "#7b4d67"];

export function RoomGeometryPreview({
  geometry,
  thumbnail = false,
  selectedWallId,
  onSelectWall,
  onGeometryChange,
  onDragActiveChange,
}: {
  geometry: RoomGeometry;
  thumbnail?: boolean;
  selectedWallId?: string | null;
  onSelectWall?: (wallId: string) => void;
  onGeometryChange?: (geometry: RoomGeometry) => void;
  onDragActiveChange?: (active: boolean) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    wallId: string;
    startGeometry: RoomGeometry;
    startPointer: DragPoint;
    startClientX: number;
    startClientY: number;
    lastValidGeometry: RoomGeometry;
    moved: boolean;
  } | null>(null);
  const [previewGeometry, setPreviewGeometry] = useState<RoomGeometry | null>(null);
  const [draggingWallId, setDraggingWallId] = useState<string | null>(null);
  const [dragError, setDragError] = useState("");
  const displayGeometry = previewGeometry ?? geometry;
  const view = bounds(displayGeometry);
  const points = displayGeometry.vertices.map((vertex) => `${vertex.xCm},${vertex.yCm}`).join(" ");
  const scale = Math.max(view.width, view.height);
  const labelFontSize = scale * 0.035;
  const labelLineHeight = labelFontSize * 1.2;
  const hitStrokeWidth = 18;
  const centroidX = displayGeometry.vertices.reduce((sum, vertex) => sum + vertex.xCm, 0) / displayGeometry.vertices.length;
  const centroidY = displayGeometry.vertices.reduce((sum, vertex) => sum + vertex.yCm, 0) / displayGeometry.vertices.length;

  function pointerToSvgPoint(event: React.PointerEvent<SVGElement>): DragPoint | null {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(matrix.inverse());
    return { xCm: transformed.x, yCm: transformed.y };
  }

  function isValidDragGeometry(candidate: RoomGeometry) {
    return roomGeometrySchema.safeParse(candidate).success
      && validateRoomGeometryStructure(candidate).valid;
  }

  function handlePointerDown(event: React.PointerEvent<SVGLineElement>, wallId: string) {
    if (!onGeometryChange || !onSelectWall) return;
    const wall = geometry.wallSegments.find((candidate) => candidate.id === wallId);
    const startPointer = pointerToSvgPoint(event);
    if (!wall || !startPointer) return;

    onSelectWall(wallId);
    event.currentTarget.setPointerCapture(event.pointerId);
    const startGeometry = {
      ...geometry,
      templateTransform: { ...geometry.templateTransform },
      vertices: geometry.vertices.map((vertex) => ({ ...vertex })),
      wallSegments: geometry.wallSegments.map((wallSegment) => ({ ...wallSegment })),
    };
    dragRef.current = {
      pointerId: event.pointerId,
      wallId,
      startGeometry,
      startPointer,
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastValidGeometry: startGeometry,
      moved: false,
    };
    setDragError("");
    setDraggingWallId(wallId);
    onDragActiveChange?.(true);
  }

  function handlePointerMove(event: React.PointerEvent<SVGLineElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const currentPointer = pointerToSvgPoint(event);
    if (!currentPointer) return;

    if (Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) < 4) return;
    const wall = drag.startGeometry.wallSegments.find((candidate) => candidate.id === drag.wallId);
    if (!wall) return;
    const candidate = createDraggedGeometryCandidate(drag.startGeometry, wall, drag.startPointer, currentPointer);
    if (!candidate || !isValidDragGeometry(candidate)) {
      setDragError("Wall cannot be moved farther in this direction.");
      return;
    }

    drag.moved = true;
    drag.lastValidGeometry = candidate;
    setDragError("");
    setPreviewGeometry(candidate);
  }

  function finishPointerDrag(event: React.PointerEvent<SVGLineElement>, cancelled: boolean) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!cancelled && drag.moved && onGeometryChange) {
      const normalized = normalizeGeometry(drag.lastValidGeometry);
      if (isValidDragGeometry(normalized)) onGeometryChange(normalized);
    }

    dragRef.current = null;
    setPreviewGeometry(null);
    setDraggingWallId(null);
    onDragActiveChange?.(false);
  }

  // Geometry y coordinates use SVG's native downward-positive convention.
  return (
    <div className="space-y-2">
      <svg
      ref={svgRef}
      aria-label={`${displayGeometry.shapeType} room preview`}
      className={thumbnail ? "h-24 w-full" : "h-80 w-full"}
      preserveAspectRatio="xMidYMid meet"
      viewBox={`${view.minX} ${view.minY} ${view.width} ${view.height}`}
    >
      <polygon points={points} fill="#d9e7e2" stroke="none" pointerEvents="none" />
      {!thumbnail && displayGeometry.wallSegments.map((wall, index) => {
        const endpoints = getWallEndpoints(displayGeometry, wall);
        if (!endpoints) return null;
        const { start, end } = endpoints;
        const length = getWallLengthCm(displayGeometry, wall) ?? 0;
        const midX = (start.xCm + end.xCm) / 2;
        const midY = (start.yCm + end.yCm) / 2;
        const outwardX = midX - centroidX;
        const outwardY = midY - centroidY;
        const outwardMagnitude = Math.sqrt(outwardX ** 2 + outwardY ** 2);
        const normalizedOutwardX = outwardMagnitude > GEOMETRY_EPSILON ? outwardX / outwardMagnitude : 0;
        const normalizedOutwardY = outwardMagnitude > GEOMETRY_EPSILON ? outwardY / outwardMagnitude : 0;
        const labelOffset = Math.max(view.width, view.height) * 0.055;
        const labelX = midX + normalizedOutwardX * labelOffset;
        const labelY = midY + normalizedOutwardY * labelOffset;
        const orientation = getWallOrientation(displayGeometry, wall);
        const textAnchor = orientation === "horizontal"
          ? "middle"
          : normalizedOutwardX > GEOMETRY_EPSILON
            ? "start"
            : normalizedOutwardX < -GEOMETRY_EPSILON
              ? "end"
              : "middle";
        const selected = wall.id === selectedWallId;
        return (
          <g key={wall.id}>
            {onSelectWall && (
              <line
                x1={start.xCm}
                y1={start.yCm}
                x2={end.xCm}
                y2={end.yCm}
                stroke="transparent"
                strokeWidth={hitStrokeWidth}
                vectorEffect="non-scaling-stroke"
                pointerEvents="stroke"
                role="button"
                tabIndex={0}
                aria-label={`${wallDisplayLabel(index)}, ${length.toFixed(1)} centimeters`}
                onClick={() => onSelectWall(wall.id)}
                onPointerDown={(event) => handlePointerDown(event, wall.id)}
                onPointerMove={handlePointerMove}
                onPointerUp={(event) => finishPointerDrag(event, false)}
                onPointerCancel={(event) => finishPointerDrag(event, true)}
                style={{ touchAction: "none", cursor: draggingWallId === wall.id ? "grabbing" : "move" }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onSelectWall(wall.id);
                }}
                className="cursor-pointer"
              />
            )}
            <line
              x1={start.xCm}
              y1={start.yCm}
              x2={end.xCm}
              y2={end.yCm}
              stroke={selected ? "#0f172a" : wallColors[index % wallColors.length]}
              strokeWidth={selected ? "5" : "3"}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
            {onSelectWall && (
              <text x={labelX} y={labelY} textAnchor={textAnchor} fontSize={labelFontSize} fontWeight="500" className="fill-slate-700" pointerEvents="none">
                <tspan x={labelX} dy="0">{wallDisplayLabel(index)}</tspan>
                <tspan x={labelX} dy={labelLineHeight}>{length.toFixed(1)} cm</tspan>
              </text>
            )}
          </g>
        );
      })}
      </svg>
      {dragError && !thumbnail && <p className="mt-2 text-xs text-amber-700" aria-live="polite">{dragError}</p>}
    </div>
  );
}
