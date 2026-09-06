"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  getGeometryBounds,
  getWallEndpoints,
  getWallLengthCm,
  getWallOrientation,
  updateWallLength,
  wallDisplayLabel,
} from "@/lib/geometry/dimensions";
import { roomGeometrySchema } from "@/lib/geometry/schema";
import { normalizeGeometry } from "@/lib/geometry/transforms";
import { validateRoomGeometryStructure } from "@/lib/geometry/validation";
import type { RoomGeometry } from "@/lib/geometry/types";

export function RoomWallDimensionEditor({
  geometry,
  selectedWallId,
  onChange,
}: {
  geometry: RoomGeometry;
  selectedWallId: string | null;
  onChange: (geometry: RoomGeometry) => void;
}) {
  const selectedIndex = geometry.wallSegments.findIndex((wall) => wall.id === selectedWallId);
  const selectedWall = selectedIndex >= 0 ? geometry.wallSegments[selectedIndex] : null;
  const [newLength, setNewLength] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedWall) {
      setNewLength("");
      setError("");
      return;
    }
    const currentLength = getWallLengthCm(geometry, selectedWall);
    setNewLength(currentLength === null ? "" : currentLength.toFixed(1));
    setError("");
  }, [geometry, selectedWall]);

  if (!selectedWall || selectedIndex < 0) {
    return (
      <div className="border border-slate-200 bg-white p-5 text-sm text-slate-600">
        Select a wall to refine its dimension.
      </div>
    );
  }

  const orientation = getWallOrientation(geometry, selectedWall);
  const currentLength = getWallLengthCm(geometry, selectedWall);
  const endpoints = getWallEndpoints(geometry, selectedWall);

  function applyDimension() {
    const committedGeometry: RoomGeometry = {
      ...geometry,
      templateTransform: { ...geometry.templateTransform },
      vertices: geometry.vertices.map((vertex) => ({ ...vertex })),
      wallSegments: geometry.wallSegments.map((wallSegment) => ({ ...wallSegment })),
    };
    const committedWall = committedGeometry.wallSegments.find((wall) => wall.id === selectedWallId);
    const numericLength = Number(newLength);
    if (!Number.isFinite(numericLength) || numericLength <= 0) {
      setError("Enter a finite length greater than 0 cm.");
      return;
    }
    if (!committedWall) {
      setError("This dimension could not be applied.");
      return;
    }

    const candidate = updateWallLength(committedGeometry, committedWall, numericLength);
    if (!candidate) {
      setError("This dimension could not be applied.");
      return;
    }

    const normalized = normalizeGeometry(candidate);
    if (!roomGeometrySchema.safeParse(normalized).success) {
      setError("This dimension would create an invalid room shape.");
      return;
    }

    const validation = validateRoomGeometryStructure(normalized);
    if (!validation.valid) {
      setError(validation.error === "self_intersection"
        ? "This dimension would cause room walls to cross."
        : "This dimension would create an invalid room shape.");
      return;
    }

    setError("");
    onChange(normalized);
  }

  const bounds = getGeometryBounds(geometry);

  return (
    <div className="border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Selected wall</p>
          <h3 className="mt-2 text-lg font-semibold">{wallDisplayLabel(selectedIndex)}</h3>
        </div>
        <dl className="grid grid-cols-2 gap-5 text-sm sm:grid-cols-3">
          <div><dt className="text-slate-500">Orientation</dt><dd className="mt-1 font-medium capitalize">{orientation}</dd></div>
          <div><dt className="text-slate-500">Current length</dt><dd className="mt-1 font-medium">{currentLength?.toFixed(1)} cm</dd></div>
          {endpoints && <div><dt className="text-slate-500">Anchored start</dt><dd className="mt-1 font-medium">{endpoints.start.id}</dd></div>}
        </dl>
      </div>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm font-medium text-slate-700">
            New length (cm)
            <input
              type="number"
              min="0"
              step="any"
              value={newLength}
              onChange={(event) => {
                setNewLength(event.target.value);
                setError("");
              }}
              className="mt-2 h-10 w-full rounded-md border border-input bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </label>
          <Button type="button" onClick={applyDimension}>Apply Dimension</Button>
        </div>
      {orientation === "diagonal" && <p className="mt-3 text-sm text-slate-600">Diagonal resizing preserves the wall&apos;s current angle.</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <p className="mt-5 text-xs leading-5 text-slate-500">Adjusting one wall may change an adjacent wall because they share a corner.</p>
      <p className="mt-1 text-xs text-slate-500">Current footprint: {bounds.widthCm.toFixed(1)} cm × {bounds.lengthCm.toFixed(1)} cm</p>
    </div>
  );
}
