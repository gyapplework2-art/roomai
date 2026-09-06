import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { RoomGeometrySetup } from "@/components/room-geometry/room-geometry-setup";
import { roomGeometrySchema } from "@/lib/geometry/schema";
import { validateRoomGeometryStructure } from "@/lib/geometry/validation";
import { createClient } from "@/lib/supabase/server";
import type { Json, Tables } from "@/types/database.types";

export const instant = false;

type Project = Tables<"projects">;

type GeometryRow = Tables<"room_geometries">;

function jsonValue(value: Json) {
  return value;
}

function parseGeometry(row: GeometryRow): ReturnType<typeof roomGeometrySchema.parse> | null {
  const result = roomGeometrySchema.safeParse({
    schemaVersion: row.schema_version,
    shapeType: row.shape_type,
    templateTransform: {
      rotationDegrees: row.template_rotation_degrees,
      mirroredHorizontal: row.template_mirrored_horizontal,
      mirroredVertical: row.template_mirrored_vertical,
    },
    ceilingHeightCm: row.ceiling_height_cm,
    vertices: jsonValue(row.vertices),
    wallSegments: jsonValue(row.wall_segments),
  });
  return result.success && validateRoomGeometryStructure(result.data).valid ? result.data : null;
}

export default async function RoomGeometryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims) redirect("/auth/login");

  const { id } = await params;
  const [projectResult, geometryResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, width_cm, length_cm, height_cm")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("room_geometries")
      .select("id, project_id, schema_version, shape_type, template_rotation_degrees, template_mirrored_horizontal, template_mirrored_vertical, vertices, wall_segments, ceiling_height_cm, created_at, updated_at")
      .eq("project_id", id)
      .maybeSingle(),
  ]);

  if (projectResult.error || !projectResult.data || geometryResult.error) notFound();

  const project = projectResult.data as Project;
  const storedGeometry = geometryResult.data ? parseGeometry(geometryResult.data as GeometryRow) : null;
  if (geometryResult.data && !storedGeometry) notFound();

  return (
    <main className="min-h-screen bg-[#f7f7f4] text-slate-950">
      <header className="border-b border-slate-200/80 bg-[#f7f7f4]/95">
        <div className="mx-auto flex min-h-20 max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4 lg:px-8">
          <Link href="/dashboard" className="text-xl font-semibold tracking-tight">RoomAI</Link>
          <Link href={`/projects/${project.id}`} className="text-sm text-slate-600 transition-colors hover:text-slate-950">Back to Project</Link>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-6 py-10 lg:px-8 lg:py-14">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Room geometry</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">{storedGeometry ? "Edit room shape" : "Set up room shape"}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">Choose and orient the room footprint used for future geometry editing.</p>
        </div>
        <section className="border border-slate-200 bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.04)] sm:p-10">
          <RoomGeometrySetup
            projectId={project.id}
            widthCm={project.width_cm}
            lengthCm={project.length_cm}
            ceilingHeightCm={project.height_cm}
            initialGeometry={storedGeometry}
          />
        </section>
      </div>
    </main>
  );
}
