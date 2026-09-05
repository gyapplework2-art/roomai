"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { generateDesign } from "@/lib/designs/actions";

function errorMessage(error: "not_configured" | "not_found" | "provider_failure" | "invalid_response" | "persistence_failed") {
  switch (error) {
    case "not_configured":
      return "AI generation is not configured.";
    case "not_found":
      return "This project could not be found.";
    case "invalid_response":
      return "The AI returned an invalid design. Please try again.";
    case "persistence_failed":
      return "The AI design was generated but could not be saved. Please try again.";
    default:
      return "AI generation failed. Please try again.";
  }
}

export function GenerateAiButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function handleGenerate() {
    if (isPending) return;

    setIsPending(true);
    setMessage("");
    const result = await generateDesign(projectId);
    if (result.success) {
      router.push(`/projects/${projectId}/designs/${result.designId}`);
    } else {
      setMessage(errorMessage(result.error));
    }
    setIsPending(false);
  }

  return (
    <>
      <div className="flex w-full flex-col items-start gap-3 sm:items-end">
      <Button
        type="button"
        size="lg"
        onClick={handleGenerate}
        disabled={isPending}
      >
        {isPending ? "Generating AI Design..." : "Generate AI Design"}
      </Button>
      {message && (
        <p className="max-w-xs text-right text-xs leading-5 text-slate-500">
          {message}
        </p>
      )}
      </div>
    </>
  );
}
