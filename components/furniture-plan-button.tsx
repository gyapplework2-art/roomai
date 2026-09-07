"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { generateFurniturePlanForProject } from "@/lib/furniture-planning/actions";
import type { FurniturePlan } from "@/lib/furniture-planning/types";
import { furnitureMarkets, type FurnitureMarket } from "@/lib/furniture-planning/market-types";
import { normalizeFurniturePlanForMarket } from "@/lib/furniture-planning/normalize-plan";
import { constrainFurniturePlanToRoom } from "@/lib/furniture-planning/room-constraints";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";

function errorMessage(error: "not_found" | "missing_layout" | "invalid_layout" | "not_configured" | "provider_failure" | "invalid_response") {
  switch (error) {
    case "missing_layout": return "Set up the room layout before planning furniture.";
    case "invalid_layout": return "Fix the room layout before planning furniture.";
    case "not_configured": return "AI generation is not configured.";
    case "invalid_response": return "The AI returned an invalid furniture plan.";
    case "not_found": return "This project could not be found.";
    default: return "Furniture planning failed. Please try again.";
  }
}

export function FurniturePlanButton({ projectId }: { projectId: string }) {
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState("");
  const [plan, setPlan] = useState<FurniturePlan | null>(null);
  const [market, setMarket] = useState<FurnitureMarket>("north_america");
  const [geometry, setGeometry] = useState<RoomGeometry | null>(null);
  const [openings, setOpenings] = useState<RoomOpening[]>([]);

  async function handleGenerate() {
    if (isPending) return;
    setIsPending(true);
    setMessage("");
    try {
      const result = await generateFurniturePlanForProject(projectId);
      if (result.success) {
        setPlan(result.plan);
        setGeometry(result.geometry);
        setOpenings(result.openings);
      }
      else setMessage(errorMessage(result.error));
    } catch {
      setMessage("Furniture planning failed. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  const normalized = plan ? normalizeFurniturePlanForMarket(plan, market) : null;
  const constrained = normalized && geometry ? constrainFurniturePlanToRoom(normalized, geometry, openings) : null;

  function rangeText(range: { widthMinCm: number; widthMaxCm: number; depthMinCm: number; depthMaxCm: number; heightMinCm: number; heightMaxCm: number }) {
    return `${range.widthMinCm}-${range.widthMaxCm} × ${range.depthMinCm}-${range.depthMaxCm} × ${range.heightMinCm}-${range.heightMaxCm} cm`;
  }

  return (
    <section className="mt-8 border border-dashed border-slate-300 bg-slate-50 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Development planning preview</p>
          <h2 className="mt-2 text-lg font-semibold">Furniture Plan</h2>
        </div>
        <Button type="button" variant="outline" onClick={handleGenerate} disabled={isPending}>
          {isPending ? "Planning Furniture..." : "Generate Furniture Plan"}
        </Button>
      </div>
      <label className="mt-4 block max-w-xs text-sm font-medium text-slate-700">
        Market
        <select value={market} onChange={(event) => setMarket(event.target.value as FurnitureMarket)} className="mt-2 h-10 w-full rounded-md border border-input bg-white px-3">
          {furnitureMarkets.map((value) => <option key={value} value={value}>{value.replace("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}</option>)}
        </select>
      </label>
      {message && <p className="mt-4 text-sm text-slate-700">{message}</p>}
      {plan && (
        <div className="mt-6 space-y-4">
          <p className="text-sm leading-6 text-slate-700">{plan.roomIntent}</p>
          <div className="space-y-3">
            {constrained?.items.map((normalizedItem) => {
              const { item } = normalizedItem;
              return (
              <article key={item.id} className="border border-slate-200 bg-white p-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{item.category}{item.subtype ? ` · ${item.subtype}` : ""}</h3>
                  <span className="text-xs uppercase tracking-[0.12em] text-slate-500">{item.priority}</span>
                </div>
                <p className="mt-2 text-slate-600">{item.placement.anchorWallId ?? item.placement.preferredZone ?? "Flexible placement"}</p>
                <p className="mt-2 text-slate-700"><strong>Preferred:</strong> {rangeText(normalizedItem.preferredRange)}</p>
                <p className="mt-1 text-slate-700"><strong>{market.replace("_", " ")} market:</strong> {normalizedItem.marketRange ? rangeText(normalizedItem.marketRange) : "No market rule yet"}</p>
                <p className="mt-1 text-slate-700"><strong>Search range:</strong> {normalizedItem.searchRange ? rangeText(normalizedItem.searchRange) : "Unavailable"}</p>
                <p className="mt-1 text-slate-700"><strong>Room:</strong> {normalizedItem.roomConstraint?.maxWidthCm ? `max width ${normalizedItem.roomConstraint.maxWidthCm.toFixed(1)} cm` : "No room envelope"}{normalizedItem.roomConstraint?.maxDepthCm ? ` · max depth ${normalizedItem.roomConstraint.maxDepthCm.toFixed(1)} cm` : ""}</p>
                <p className="mt-1 text-slate-700"><strong>Final search range:</strong> {normalizedItem.finalSearchRange ? rangeText(normalizedItem.finalSearchRange) : "Unavailable"}</p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Status: {normalizedItem.status === "range_conflict" ? `Range conflict (${normalizedItem.conflictDimension})` : normalizedItem.roomStatus === "unsupported_category" ? "No market rule yet" : normalizedItem.roomStatus === "market_range_conflict" ? "Market range conflict" : normalizedItem.roomStatus === "room_conflict" ? "Needs re-plan" : normalizedItem.roomStatus === "needs_replan" ? "Needs re-plan" : normalizedItem.roomStatus === "invalid_anchor_wall" ? "Invalid anchor wall" : normalizedItem.roomStatus === "missing_placement" ? "Missing placement" : "Ready"}</p>
                <p className="mt-2 leading-6 text-slate-600">{item.reasoning}</p>
              </article>
              );
            })}
          </div>
          {plan.notes.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">{plan.notes.map((note) => <li key={note}>{note}</li>)}</ul>}
        </div>
      )}
    </section>
  );
}
