import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { GenerateAiButton } from "@/components/generate-ai-button";
import { FurniturePlanButton } from "@/components/furniture-plan-button";
import { Badge } from "@/components/ui/badge";
import { labelize } from "@/lib/projects/validation";
import { createClient } from "@/lib/supabase/server";
import type { Json, Tables } from "@/types/database.types";

export const instant = false;

type Project = Tables<"projects">;
type RoomPreferences = Tables<"room_preferences">;

function formatDimension(value: number) {
  return Number(value.toFixed(1)).toString();
}

function formatDimensions(project: Project) {
  return [project.width_cm, project.length_cm, project.height_cm]
    .filter((value): value is number => value !== null)
    .map(formatDimension)
    .join(" × ");
}

function formatValue(value: string | null) {
  return value ? labelize(value) : null;
}

function jsonStrings(value: Json | null | undefined) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function DisplayList({ values }: { values: string[] }) {
  if (!values.length) return <p className="text-sm text-slate-500">None selected</p>;

  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <span key={value} className="border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700">
          {labelize(value)}
        </span>
      ))}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;

  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</dt>
      <dd className="mt-2 text-sm text-slate-900">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-200 py-8 first:border-t-0 first:pt-0">
      <h2 className="mb-6 text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError || !claims?.claims) {
    redirect("/auth/login");
  }

  const { id } = await params;
  const [projectResult, preferencesResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, room_type, status, width_cm, length_cm, height_cm, currency, budget_min, budget_max, created_at, updated_at, user_id")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("room_preferences")
      .select("id, project_id, primary_style, secondary_style, color_mood, primary_color, secondary_color, accent_color, metal_color, preferred_materials, avoid_materials, room_functions, must_have_items, nice_to_have_items, household_size, special_requirements, additional_notes, priority, created_at, updated_at")
      .eq("project_id", id)
      .maybeSingle(),
  ]);
  const geometryResult = await supabase
    .from("room_geometries")
    .select("id")
    .eq("project_id", id)
    .maybeSingle();

  if (projectResult.error || !projectResult.data || preferencesResult.error || geometryResult.error) {
    notFound();
  }

  const project = projectResult.data as Project;
  const preferences = preferencesResult.data as RoomPreferences | null;
  const priority = preferences?.priority ? labelize(preferences.priority) : null;

  return (
    <main className="min-h-screen bg-[#f7f7f4] text-slate-950">
      <header className="border-b border-slate-200/80 bg-[#f7f7f4]/95">
        <div className="mx-auto flex min-h-20 max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4 lg:px-8">
          <Link href="/dashboard" className="text-xl font-semibold tracking-tight">RoomAI</Link>
          <div className="flex items-center gap-5 text-sm">
            <Link href="/projects/new" className="text-slate-600 transition-colors hover:text-slate-950">New Design</Link>
            <a href="/dashboard" className="text-slate-600 transition-colors hover:text-slate-950">Back to Dashboard</a>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10 lg:px-8 lg:py-14">
        <div className="flex flex-col gap-6 border-b border-slate-200 pb-10 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Room project</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h1 className="text-4xl font-semibold tracking-tight">{project.name}</h1>
              <Badge variant="outline">{labelize(project.status)}</Badge>
            </div>
            <p className="mt-3 text-sm text-slate-500">{formatValue(project.room_type)}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Link href={`/projects/${project.id}/room`} className="border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-950 hover:text-slate-950">
              {geometryResult.data ? "Edit Room Shape" : "Set Up Room Shape"}
            </Link>
            <GenerateAiButton projectId={project.id} />
          </div>
        </div>

        <div className="mt-8 border border-slate-200 bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.04)] sm:p-10">
          <Section title="Room">
            <dl className="grid gap-6 sm:grid-cols-2">
              <Detail label="Room type" value={formatValue(project.room_type)} />
              <Detail label="Dimensions" value={`${formatDimensions(project)} cm`} />
            </dl>
          </Section>

          {preferences && (
            <>
              <Section title="Function">
                <div className="space-y-6">
                  <div><h3 className="mb-3 text-sm font-medium">Room functions</h3><DisplayList values={jsonStrings(preferences.room_functions)} /></div>
                  <dl className="grid gap-6 sm:grid-cols-2"><Detail label="Household size" value={preferences.household_size} /><Detail label="Additional notes" value={preferences.additional_notes} /></dl>
                  <div><h3 className="mb-3 text-sm font-medium">Special requirements</h3><DisplayList values={jsonStrings(preferences.special_requirements)} /></div>
                </div>
              </Section>

              <Section title="Style & Colors">
                <dl className="grid gap-6 sm:grid-cols-2"><Detail label="Primary style" value={preferences.primary_style} /><Detail label="Secondary style" value={preferences.secondary_style} /><Detail label="Color mood" value={formatValue(preferences.color_mood)} /><Detail label="Primary color" value={preferences.primary_color} /><Detail label="Secondary color" value={preferences.secondary_color} /><Detail label="Accent color" value={preferences.accent_color} /><Detail label="Metal color" value={preferences.metal_color} /></dl>
              </Section>

              <Section title="Materials">
                <div className="grid gap-6 sm:grid-cols-2"><div><h3 className="mb-3 text-sm font-medium">Preferred Materials</h3><DisplayList values={jsonStrings(preferences.preferred_materials)} /></div><div><h3 className="mb-3 text-sm font-medium">Avoid Materials</h3><DisplayList values={jsonStrings(preferences.avoid_materials)} /></div></div>
              </Section>

              <Section title="Furniture">
                <div className="grid gap-6 sm:grid-cols-2"><div><h3 className="mb-3 text-sm font-medium">Must Have</h3><DisplayList values={jsonStrings(preferences.must_have_items)} /></div><div><h3 className="mb-3 text-sm font-medium">Nice to Have</h3><DisplayList values={jsonStrings(preferences.nice_to_have_items)} /></div></div>
              </Section>

              <Section title="Budget">
                <dl className="grid gap-6 sm:grid-cols-2"><Detail label="Currency" value={project.currency} /><Detail label="Minimum" value={project.budget_min === null ? null : `${project.currency} ${project.budget_min}`} /><Detail label="Maximum" value={project.budget_max === null ? null : `${project.currency} ${project.budget_max}`} /><Detail label="Priority" value={priority} /></dl>
              </Section>

              {preferences.additional_notes && <Section title="Notes"><p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{preferences.additional_notes}</p></Section>}
            </>
          )}
        </div>
        <FurniturePlanButton projectId={project.id} />
      </div>
    </main>
  );
}
