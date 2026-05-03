"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Sparkles } from "lucide-react";
import type { Reflection } from "@/lib/models";

export default function Snapshot({ reflectionId }: { reflectionId: string }) {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [reflection, setReflection] = useState<Reflection | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/reflections/${reflectionId}?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? "Could not load your snapshot.");
        }
        setReflection(data.reflection);
      })
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : "Could not load your snapshot."),
      );
  }, [reflectionId, token]);

  if (error) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fdcb40] p-8 text-black">
        <div className="panel max-w-lg p-6 text-center">
          <h1 className="display-type text-4xl font-bold">Snapshot unavailable</h1>
          <p className="mt-2 text-lg font-semibold">{error}</p>
        </div>
      </main>
    );
  }

  if (!reflection) {
    return <main className="min-h-screen bg-[#fdcb40] p-8 text-xl font-bold">Loading snapshot...</main>;
  }

  const depth = reflection.overallAnalysis?.overallDepthScore ?? 1;

  return (
    <main className="grid min-h-screen place-items-center bg-[#fdcb40] px-6 py-8 text-black">
      <section className="w-full max-w-3xl text-center">
        <div className="mx-auto grid size-20 place-items-center rounded-[24px] border-2 border-black bg-[#04c6c5] text-black">
          <CheckCircle2 size={32} />
        </div>
        <h1 className="display-type mx-auto mt-7 max-w-[340px] text-[4.1rem] font-bold leading-[0.82] sm:max-w-none sm:text-[5.6rem]">
          Your Thinking Snapshot
        </h1>
        <p className="mt-5 text-2xl font-semibold leading-8">
          Your teacher can now see your thinking live. Nice work.
        </p>

        <div className="panel mt-8 grid gap-5 p-6 text-left md:grid-cols-3">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.08em]">Depth meter</p>
            <p className="display-type mt-2 text-6xl font-bold">{depth}/4</p>
            <div className="mt-3 flex gap-1">
              {[1, 2, 3, 4].map((item) => (
                <div
                  key={item}
                  className={`h-4 flex-1 rounded-full border-2 border-black ${
                    item <= depth ? "bg-[#006cff]" : "bg-white"
                  }`}
                />
              ))}
            </div>
          </div>
          <div className="md:col-span-2">
            <p className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.08em]">
              <Sparkles size={16} />
              Strongest move
            </p>
            <p className="mt-2 text-2xl font-black leading-8">
              {reflection.studentFeedback?.strongestMove}
            </p>
            <p className="mt-5 text-sm font-black uppercase tracking-[0.08em]">
              Nudge for next time
            </p>
            <p className="mt-2 text-lg font-semibold leading-7">{reflection.studentFeedback?.nudge}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 text-left">
          {reflection.steps.map((step, index) => (
            <div key={`${step.label}-${index}`} className="soft-panel p-5 relative border-l-4 border-[#006cff]">
              <p className="display-type text-2xl font-bold">{step.label}</p>
              {step.prompt && (
                <p className="mt-1 text-sm font-black uppercase tracking-[0.08em] text-slate-500">
                  {step.prompt}
                </p>
              )}
              <p className="mt-2 text-lg font-semibold leading-7">
                &ldquo;{step.transcription}&rdquo;
              </p>
              
              {step.followUpQuestion && (
                <div className="mt-4 p-4 bg-white rounded-xl border-2 border-slate-200">
                  <p className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.08em] text-[#006cff]">
                    <Sparkles size={16} /> AI Follow-up
                  </p>
                  <p className="mt-1 font-bold">{step.followUpQuestion}</p>
                </div>
              )}
            </div>
          ))}
        </div>

        <Link
          href="/"
          className="focus-ring mt-8 inline-flex items-center justify-center gap-2 rounded-full border-2 border-black bg-[#fd4401] px-7 py-4 font-bold text-white transition hover:-translate-y-0.5"
        >
          Finish
        </Link>
      </section>
    </main>
  );
}
