import Link from "next/link";
import { redirect } from "next/navigation";

import { ProjectWizard } from "@/components/project-wizard";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

export default async function NewProjectPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  return (
    <main className="min-h-screen bg-[#f7f7f4] text-slate-950">
      <header className="border-b border-slate-200/80 bg-[#f7f7f4]/95">
        <div className="mx-auto flex h-20 max-w-5xl items-center justify-between px-6 lg:px-8">
          <Link href="/dashboard" className="text-xl font-semibold tracking-tight">
            RoomAI
          </Link>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-950"
          >
            Back to My Designs
          </Link>
        </div>
      </header>
      <ProjectWizard />
    </main>
  );
}