import { RoomGeometryPreview } from "@/components/room-geometry/room-geometry-preview";
import { detectFloorPlanWarnings, type FloorPlanProjection } from "@/lib/designs/floor-plan";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";

export function DesignFloorPlan({
  geometry,
  openings,
  projection,
}: {
  geometry: RoomGeometry;
  openings: RoomOpening[];
  projection: FloorPlanProjection;
}) {
  const numbered = projection.objects.map((object, index) => ({ object, number: index + 1 }));
  const warnings = detectFloorPlanWarnings(projection.objects, geometry, openings);
  const isRug = (category: string | null) => category === "rug" || category === "area_rug";
  const layers = [...numbered].sort((first, second) => Number(isRug(second.object.category)) - Number(isRug(first.object.category)));
  return (
    <div>
      <RoomGeometryPreview geometry={geometry} openings={openings}>
        <g pointerEvents="none">
          {layers.map(({ object, number }) => (
            <g key={object.objectRef}>
              <title>{`${number}. ${object.label}, ${object.widthCm} x ${object.depthCm} cm, ${object.rotationDegrees} degrees`}</title>
              <polygon
                points={object.footprint.map((point) => `${point.xCm},${point.yCm}`).join(" ")}
                fill={isRug(object.category) ? "#eee4dd" : "#f2d285"}
                fillOpacity={0.8}
                stroke={isRug(object.category) ? "#997b67" : "#66511f"}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
              {Math.min(object.widthCm, object.depthCm) >= 15 && (
                <text
                  x={object.xCm}
                  y={object.yCm}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={Math.min(18, Math.min(object.widthCm, object.depthCm) * 0.4)}
                  fontWeight={600}
                  fill="#30291d"
                >{number}</text>
              )}
            </g>
          ))}
        </g>
      </RoomGeometryPreview>
      {numbered.length > 0 ? (
        <ol className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {numbered.map(({ object, number }) => (
            <li key={object.objectRef} className="min-w-0 text-sm">
              <span className="font-semibold text-slate-900">{number}. {object.label}</span>
              <span className="ml-2 text-xs text-slate-500">{object.widthCm} x {object.depthCm} cm</span>
            </li>
          ))}
        </ol>
      ) : <p className="mt-4 text-sm text-slate-500">No furniture positions available.</p>}
      {projection.skipped.length > 0 && (
        <p className="mt-4 text-sm text-amber-800">
          Missing or invalid placement data: {projection.skipped.map((object) => object.label).join(", ")}.
        </p>
      )}
      {warnings.length > 0 && (
        <div className="mt-4 border-l-2 border-amber-500 pl-3 text-sm text-amber-900">
          <p className="font-semibold">Saved placement needs review</p>
          <ul className="mt-2 space-y-1">
            {warnings.map((warning, index) => (
              <li key={index}>
                {warning.code === "overlap" ? `${warning.labels.join(" and ")} overlap.`
                  : warning.code === "outside_room" ? `${warning.labels[0]} extends outside the room.`
                    : `${warning.labels[0]} intersects a ${warning.labels[1]} opening; clearance needs review.`}
              </li>
            ))}
          </ul>
          <p className="mt-2">Positions are shown as saved. Door swings and full clearance are not certified.</p>
        </div>
      )}
    </div>
  );
}