"use client";

import { RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { mirrorGeometryHorizontal, mirrorGeometryVertical, rotateGeometry90 } from "@/lib/geometry/transforms";
import type { RoomGeometry } from "@/lib/geometry/types";

export function RoomTransformControls({ geometry, onChange }: { geometry: RoomGeometry | null; onChange: (geometry: RoomGeometry) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" disabled={!geometry} onClick={() => geometry && onChange(rotateGeometry90(geometry))}>
        <RotateCw /> Rotate 90°
      </Button>
      <Button type="button" variant="outline" disabled={!geometry} onClick={() => geometry && onChange(mirrorGeometryHorizontal(geometry))}>
        Mirror Horizontally
      </Button>
      <Button type="button" variant="outline" disabled={!geometry} onClick={() => geometry && onChange(mirrorGeometryVertical(geometry))}>
        Mirror Vertically
      </Button>
      {geometry && <span className="text-sm text-slate-500">Rotation: {geometry.templateTransform.rotationDegrees}°</span>}
    </div>
  );
}
