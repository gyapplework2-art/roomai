"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

export function VisualizationSubmitButton({ hasVisualization }: { hasVisualization: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending
        ? "Generating visualization..."
        : hasVisualization
          ? "Refresh visualization"
          : "Generate visualization"}
    </Button>
  );
}
