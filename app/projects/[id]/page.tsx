import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

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
  const { data: project, error } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  if (error || !project) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[#f7f7f4] px-6 py-16 text-slate-950">
      <section className="mx-auto max-w-2xl border border-slate-200 bg-white p-8 text-center shadow-[0_12px_30px_rgba(15,23,42,0.04)] sm:p-12">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Project created successfully
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{project.name}</h1>
        <p className="mt-4 text-sm leading-6 text-slate-500">
          Your room details are ready for the next design step.
        </p>
        <Button asChild className="mt-8">
          <Link href="/dashboard">Back to Dashboard</Link>
        </Button>
      </section>
    </main>
  );
}