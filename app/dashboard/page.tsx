import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Plus } from "lucide-react";

import type { Tables } from "@/types/database.types";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { DashboardSignOut } from "@/components/dashboard-sign-out";

type Project = Tables<"projects">;

export const instant = false;

function formatRoomType(roomType: string) {
  return roomType
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function formatStatus(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDimension(value: number) {
  return Number(value.toFixed(1)).toString();
}

function formatDimensions(project: Project) {
  const dimensions = [project.width_cm, project.length_cm, project.height_cm]
    .filter((value): value is number => value !== null)
    .map(formatDimension)
    .join(" × ");

  return `${dimensions} cm`;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
}

async function getProjects() {
  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError || !claims?.claims) {
    redirect("/auth/login");
  }

  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, name, room_type, status, width_cm, length_cm, height_cm, created_at",
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Unable to load projects.");
  }

  return (data ?? []) as Project[];
}

export default async function DashboardPage() {
  const projects = await getProjects();

  return (
    <main className="min-h-screen bg-[#f7f7f4] text-slate-950">
      <header className="border-b border-slate-200/80 bg-[#f7f7f4]/95">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6 lg:px-10">
          <Link href="/dashboard" className="text-xl font-semibold tracking-tight">
            RoomAI
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-slate-600 md:flex">
            <Link href="/dashboard" className="font-medium text-slate-950">
              My Designs
            </Link>
            <Link href="/projects/new" className="transition-colors hover:text-slate-950">
              New Design
            </Link>
            <Link href="/dashboard/account" className="transition-colors hover:text-slate-950">
              Account
            </Link>
          </nav>
          <DashboardSignOut />
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-10 lg:py-16">
        <div className="flex flex-col gap-6 border-b border-slate-200 pb-10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Your creative workspace
            </p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              My Designs
            </h1>
          </div>
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href="/projects/new">
              <Plus />
              New Design
            </Link>
          </Button>
        </div>

        {projects.length === 0 ? (
          <section className="flex min-h-[28rem] flex-col items-center justify-center py-16 text-center">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-slate-950 text-2xl font-semibold text-white">
              R
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">
              You haven&apos;t created a room design yet.
            </h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-slate-500">
              Start with a room, then shape the space around the way you live.
            </p>
            <Button asChild className="mt-8">
              <Link href="/projects/new">Create Your First Design</Link>
            </Button>
          </section>
        ) : (
          <section className="grid gap-5 pt-10 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <article
                key={project.id}
                className="flex min-h-64 flex-col justify-between border border-slate-200 bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.04)]"
              >
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                        {formatRoomType(project.room_type)}
                      </p>
                      <h2 className="mt-3 text-xl font-semibold tracking-tight">
                        {project.name}
                      </h2>
                    </div>
                    <span className="shrink-0 border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600">
                      {formatStatus(project.status)}
                    </span>
                  </div>
                  <dl className="mt-8 grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <dt className="text-slate-500">Dimensions</dt>
                      <dd className="mt-1 font-medium text-slate-900">
                        {formatDimensions(project)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Created</dt>
                      <dd className="mt-1 font-medium text-slate-900">
                        {formatDate(project.created_at)}
                      </dd>
                    </div>
                  </dl>
                </div>
                <Button asChild variant="link" className="mt-8 w-fit px-0">
                  <Link href={`/projects/${project.id}`}>
                    Open Design
                    <ArrowUpRight />
                  </Link>
                </Button>
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}