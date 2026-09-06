"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { getWallLengthCm, wallDisplayLabel } from "@/lib/geometry/dimensions";
import { validateOpeningFitsWall, validateRoomOpenings } from "@/lib/geometry/openings";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";

function defaultOpening(type: "door" | "window", geometry: RoomGeometry, wallId: string): RoomOpening {
  const wall = geometry.wallSegments.find((segment) => segment.id === wallId);
  const wallLength = wall ? getWallLengthCm(geometry, wall) ?? 0 : 0;
  const width = type === "door" ? Math.min(90, Math.max(1, wallLength)) : Math.min(120, Math.max(1, wallLength));
  return {
    id: crypto.randomUUID(),
    openingType: type,
    wallSegmentId: wallId,
    offsetCm: Math.max(0, Math.min(20, wallLength - width)),
    widthCm: width,
    heightCm: type === "door" ? 210 : 120,
    sillHeightCm: type === "door" ? null : 90,
    hingeSide: type === "door" ? "left" : null,
    swingDirection: type === "door" ? "inward" : null,
  };
}

export function RoomOpeningsEditor({
  geometry,
  openings,
  placementType,
  onPlacementTypeChange,
  selectedWallId,
  onChange,
}: {
  geometry: RoomGeometry;
  openings: RoomOpening[];
  placementType: "door" | "window" | null;
  onPlacementTypeChange: (type: "door" | "window" | null) => void;
  selectedWallId: string | null;
  onChange: (openings: RoomOpening[]) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RoomOpening | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (editingId) {
      setDraft(openings.find((opening) => opening.id === editingId) ?? null);
    }
  }, [editingId, openings]);

  useEffect(() => {
    if (placementType && selectedWallId) {
      setDraft(defaultOpening(placementType, geometry, selectedWallId));
      onPlacementTypeChange(null);
      setError("");
    }
  }, [geometry, onPlacementTypeChange, placementType, selectedWallId]);

  function beginPlacement(type: "door" | "window") {
    setError("");
    setEditingId(null);
    setDraft(null);
    onPlacementTypeChange(type);
  }

  function updateDraft(key: keyof RoomOpening, value: string | null) {
    if (!draft) return;
    const numericKeys = new Set(["offsetCm", "widthCm", "heightCm", "sillHeightCm"]);
    setDraft({ ...draft, [key]: numericKeys.has(key) ? (value === null ? null : Number(value)) : value });
    setError("");
  }

  function commitDraft() {
    if (!draft) return;
    const fit = validateOpeningFitsWall(geometry, draft);
    const overlap = validateRoomOpenings(geometry, openings.filter((opening) => opening.id !== draft.id).concat(draft));
    if (!fit.valid) {
      setError(fit.error === "opening_out_of_bounds" ? "This opening does not fit on the selected wall." : "Enter valid opening dimensions.");
      return;
    }
    if (!overlap.valid) {
      setError(overlap.error === "opening_overlap" ? "This opening overlaps another opening on the wall." : "Enter valid opening dimensions.");
      return;
    }
    onChange(openings.some((opening) => opening.id === draft.id)
      ? openings.map((opening) => opening.id === draft.id ? draft : opening)
      : [...openings, draft]);
    setDraft(null);
    setEditingId(null);
    setError("");
  }

  const displayCounts = { door: 0, window: 0 };
  return (
    <section className="border-t border-slate-200 pt-8">
      <h2 className="text-xl font-semibold tracking-tight">Doors & Windows</h2>
      <p className="mt-2 text-sm text-slate-500">Openings attach to wall IDs and are measured from each wall&apos;s start vertex.</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={() => beginPlacement("door")}>Add Door</Button>
        <Button type="button" variant="outline" onClick={() => beginPlacement("window")}>Add Window</Button>
      </div>
      {placementType && <p className="mt-4 text-sm text-slate-700">Select a wall for this {placementType}.</p>}
      {draft && (
        <div className="mt-5 border border-slate-200 bg-slate-50 p-5">
          <h3 className="font-semibold">{draft.openingType === "door" ? "Add Door" : "Add Window"}</h3>
          <p className="mt-2 text-sm text-slate-600">{wallDisplayLabel(geometry.wallSegments.findIndex((wall) => wall.id === draft.wallSegmentId))} · {getWallLengthCm(geometry, geometry.wallSegments.find((wall) => wall.id === draft.wallSegmentId)!)?.toFixed(1)} cm</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">Wall<select value={draft.wallSegmentId} onChange={(event) => updateDraft("wallSegmentId", event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-white px-3">{geometry.wallSegments.map((wall, index) => <option key={wall.id} value={wall.id}>{wallDisplayLabel(index)}</option>)}</select></label>
            {([["offsetCm", "Position from wall start"], ["widthCm", "Width"], ["heightCm", "Height"], ...(draft.openingType === "window" ? [["sillHeightCm", "Sill height"]] : [])] as [keyof RoomOpening, string][]).map(([key, label]) => (
              <label key={String(key)} className="text-sm font-medium text-slate-700">{label} (cm)<input type="number" min="0" step="any" value={draft[key] ?? ""} onChange={(event) => updateDraft(key, event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-white px-3" /></label>
            ))}
            {draft.openingType === "door" && <><label className="text-sm font-medium text-slate-700">Hinge<select value={draft.hingeSide ?? ""} onChange={(event) => updateDraft("hingeSide", event.target.value || null)} className="mt-2 h-10 w-full rounded-md border border-input bg-white px-3"><option value="">None</option><option value="left">Left</option><option value="right">Right</option></select></label><label className="text-sm font-medium text-slate-700">Swing<select value={draft.swingDirection ?? ""} onChange={(event) => updateDraft("swingDirection", event.target.value || null)} className="mt-2 h-10 w-full rounded-md border border-input bg-white px-3"><option value="">None</option><option value="inward">Inward</option><option value="outward">Outward</option></select></label></>}
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <div className="mt-5 flex gap-3"><Button type="button" onClick={commitDraft}>{editingId ? "Save Opening" : `Add ${draft.openingType === "door" ? "Door" : "Window"}`}</Button><Button type="button" variant="ghost" onClick={() => { setDraft(null); setEditingId(null); }}>Cancel</Button></div>
        </div>
      )}
      <div className="mt-5 space-y-3">
        {openings.map((opening) => {
          displayCounts[opening.openingType] += 1;
          return <div key={opening.id} className="flex flex-wrap items-center justify-between gap-3 border border-slate-200 px-4 py-3 text-sm"><span><strong>{opening.openingType === "door" ? `Door ${displayCounts.door}` : `Window ${displayCounts.window}`}</strong> · {wallDisplayLabel(geometry.wallSegments.findIndex((wall) => wall.id === opening.wallSegmentId))} · {opening.widthCm} × {opening.heightCm} cm · offset {opening.offsetCm} cm</span><span className="flex gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => { setEditingId(opening.id ?? null); setDraft(opening); }}>Edit</Button><Button type="button" variant="ghost" size="sm" onClick={() => onChange(openings.filter((candidate) => candidate.id !== opening.id))}>Delete</Button></span></div>;
        })}
      </div>
      {openings.length === 0 && <p className="mt-5 text-sm text-slate-500">No doors or windows added.</p>}
      <p className="mt-5 text-xs text-slate-500">Wall dragging is disabled while selecting a wall for an opening.</p>
      <div className="hidden">{displayCounts.door}</div>
    </section>
  );
}
