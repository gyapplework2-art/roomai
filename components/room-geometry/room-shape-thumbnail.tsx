"use client";

import { RoomGeometryPreview } from "@/components/room-geometry/room-geometry-preview";
import type { RoomGeometry } from "@/lib/geometry/types";

export function RoomShapeThumbnail({ geometry }: { geometry: RoomGeometry }) {
  return <RoomGeometryPreview geometry={geometry} thumbnail />;
}
