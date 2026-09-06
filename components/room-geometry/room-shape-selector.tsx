"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { createRoomGeometryFromTemplate } from "@/lib/geometry/templates";
import { shapeTypes } from "@/lib/geometry/schema";
import type { RoomGeometry } from "@/lib/geometry/types";
import { RoomGeometryPreview } from "@/components/room-geometry/room-geometry-preview";
import { RoomShapeThumbnail } from "@/components/room-geometry/room-shape-thumbnail";
import { RoomTransformControls } from "@/components/room-geometry/room-transform-controls";
import { RoomWallDimensionEditor } from "@/components/room-geometry/room-wall-dimension-editor";

const labels: Record<(typeof shapeTypes)[number], string> = {
  rectangle: "Rectangle",
  l_shape: "L-Shape",
  clipped_corner: "Clipped Corner",
  t_shape: "T-Shape",
  u_shape: "U-Shape",
  stepped: "Stepped",
};

export function RoomShapeSelector({
  widthCm,
  lengthCm,
  ceilingHeightCm,
  initialGeometry = null,
  onChange,
  onDragActiveChange,
}: {
  widthCm: number;
  lengthCm: number;
  ceilingHeightCm: number | null;
  initialGeometry?: RoomGeometry | null;
  onChange: (geometry: RoomGeometry | null) => void;
  onDragActiveChange?: (active: boolean) => void;
}) {
  const [geometry, setGeometry] = useState<RoomGeometry | null>(initialGeometry);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  function selectShape(shapeType: (typeof shapeTypes)[number]) {
    const nextGeometry = createRoomGeometryFromTemplate(shapeType, widthCm, lengthCm, ceilingHeightCm);
    setGeometry(nextGeometry);
    setSelectedWallId(null);
    onChange(nextGeometry);
  }

  function updateGeometry(nextGeometry: RoomGeometry) {
    setGeometry(nextGeometry);
    onChange(nextGeometry);
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shapeTypes.map((shapeType) => {
          const thumbnail = createRoomGeometryFromTemplate(shapeType, 240, 180, null);
          const selected = geometry?.shapeType === shapeType;
          return (
            <button
              key={shapeType}
              type="button"
              aria-pressed={selected}
              onClick={() => selectShape(shapeType)}
              disabled={isDragging}
              className={`border p-3 text-left transition-colors ${selected ? "border-slate-950 bg-slate-100" : "border-slate-200 bg-white hover:border-slate-500"}`}
            >
              <RoomShapeThumbnail geometry={thumbnail} />
              <span className="mt-2 block text-sm font-medium">{labels[shapeType]}</span>
              <span className="mt-1 block text-xs text-slate-500">{selected ? "Selected" : "Choose shape"}</span>
            </button>
          );
        })}
        <button type="button" disabled className="border border-dashed border-slate-300 bg-slate-50 p-3 text-left text-slate-400">
          <div className="flex h-24 items-center justify-center text-sm">Floorplan upload</div>
          <span className="mt-2 block text-sm font-medium">Custom / Upload</span>
          <span className="mt-1 block text-xs">Coming Soon</span>
        </button>
      </div>

      {geometry ? (
        <div className="border border-slate-200 bg-slate-50 p-5 sm:p-8">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">{labels[geometry.shapeType]} preview</h2>
            <span className="text-xs uppercase tracking-[0.14em] text-slate-500">Canonical vertices</span>
          </div>
          <RoomGeometryPreview
            geometry={geometry}
            selectedWallId={selectedWallId}
            onSelectWall={setSelectedWallId}
            onGeometryChange={updateGeometry}
            onDragActiveChange={(active) => {
              setIsDragging(active);
              onDragActiveChange?.(active);
            }}
          />
          <RoomTransformControls geometry={geometry} onChange={updateGeometry} disabled={isDragging} />
          <RoomWallDimensionEditor
            geometry={geometry}
            selectedWallId={selectedWallId}
            onChange={updateGeometry}
          />
        </div>
      ) : (
        <p className="border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">Choose a room shape to preview and transform it.</p>
      )}
      <Button type="button" variant="ghost" disabled={isDragging} onClick={() => { setGeometry(null); setSelectedWallId(null); onChange(null); }}>Clear selection</Button>
    </div>
  );
}
