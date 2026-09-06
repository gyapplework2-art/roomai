"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { RoomShapeSelector } from "@/components/room-geometry/room-shape-selector";
import { saveRoomGeometry } from "@/lib/geometry/actions";
import type { RoomGeometry } from "@/lib/geometry/types";

export function RoomGeometrySetup({
  projectId,
  widthCm,
  lengthCm,
  ceilingHeightCm,
  initialGeometry,
}: {
  projectId: string;
  widthCm: number;
  lengthCm: number;
  ceilingHeightCm: number | null;
  initialGeometry: RoomGeometry | null;
}) {
  const router = useRouter();
  const [geometry, setGeometry] = useState<RoomGeometry | null>(initialGeometry);
  const [message, setMessage] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function handleSave() {
    if (!geometry || isPending) {
      if (!geometry) {
      setMessage("Choose a room shape before saving.");
      }
      return;
    }

    setIsPending(true);
    setMessage("");

    try {
      const result = await saveRoomGeometry(projectId, geometry);

      if (result.success) {
        router.push(`/projects/${projectId}`);
        return;
      }

      setMessage(result.error === "invalid_geometry" ? "The room geometry is invalid." : "We could not save the room shape. Please try again.");
    } catch {
      setMessage("We could not save the room shape. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-8">
      <RoomShapeSelector
        widthCm={widthCm}
        lengthCm={lengthCm}
        ceilingHeightCm={ceilingHeightCm}
        initialGeometry={initialGeometry}
        onChange={setGeometry}
      />
      {message && <p className="border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">{message}</p>}
      <div className="flex justify-end border-t border-slate-200 pt-6">
        <Button type="button" size="lg" onClick={handleSave} disabled={isPending || !geometry}>
          {isPending ? "Saving Room Shape..." : "Save Room Shape"}
        </Button>
      </div>
    </div>
  );
}
