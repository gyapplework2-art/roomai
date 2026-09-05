"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

export function GenerateAiButton() {
  const [message, setMessage] = useState("");

  return (
    <div className="flex flex-col items-start gap-3 sm:items-end">
      <Button
        type="button"
        size="lg"
        onClick={() =>
          setMessage("AI Design generation will be connected in the next development step.")
        }
      >
        Generate AI Design
      </Button>
      {message && (
        <p className="max-w-xs text-right text-xs leading-5 text-slate-500">
          {message}
        </p>
      )}
    </div>
  );
}
