"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Rocket } from "lucide-react";
import { AccountMenu } from "../../account-menu";

const GRADES = [
  { id: "K-2", label: "Grades K–2" },
  { id: "3-5", label: "Grades 3–5" },
  { id: "6-8", label: "Grades 6–8" },
  { id: "9-12", label: "Grades 9–12" },
];

export default function IUsedToThinkPage() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [grade, setGrade] = useState(GRADES[1].id);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function launchSession() {
    setSubmitting(true);
    setError("");
    const gradeLabel = GRADES.find((g) => g.id === grade)?.label ?? grade;

    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routineId: "i-used-to-think",
        title: "I Used to Think… Now I Think",
        gradeBand: gradeLabel,
        learningTarget: topic.trim(),
        config: { voiceMinimumSeconds: 5 },
      }),
    });

    const data = await response.json();
    setSubmitting(false);

    if (!response.ok) {
      setError(data.error ?? "Could not launch this reflection.");
      return;
    }

    router.push(`/teacher/session/${data.session.id}/live`);
  }

  return (
    <main className="min-h-screen bg-[#fdcb40] px-5 py-6 text-black md:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/teacher"
            className="focus-ring inline-flex items-center justify-center gap-2 rounded-full border-2 border-black bg-white px-5 py-3 text-sm font-bold text-black transition hover:-translate-y-0.5"
          >
            <ArrowLeft size={16} />
            Dashboard
          </Link>
          <AccountMenu
            onSignOut={async () => {
              const { getFirebaseClientServices } = await import("@/lib/firebase/client");
              const { signOut } = await import("firebase/auth");
              const { auth } = getFirebaseClientServices();
              if (auth) await signOut(auth);
              await fetch("/api/auth/logout", { method: "POST" });
              router.push("/teacher");
            }}
          />
        </header>

        <section className="mt-10 grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
          <div>
            <h1 className="display-type max-w-3xl text-[4.8rem] font-bold leading-[0.84] md:text-[7.2rem]">
              I used
              <br />
              to think.
              <br />
              <span className="text-[#f780d4]">Now I
              <br />
              think.</span>
            </h1>
            <p className="mt-8 max-w-2xl text-2xl font-semibold leading-8">
              Students name what they believed before your lesson, then what
              they believe now — and what caused the shift.
            </p>

            <div className="mt-8 grid gap-4 rounded-[24px] border-2 border-black bg-white p-6">
              <div className="flex items-start gap-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-black bg-[#fff2b7] text-sm font-black">
                  1
                </div>
                <div>
                  <p className="font-black">Used to Think</p>
                  <p className="mt-1 text-sm font-semibold leading-5 text-black/60">
                    Before this lesson, what did you believe about this topic?
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-black bg-[#00b351] text-sm font-black text-white">
                  2
                </div>
                <div>
                  <p className="font-black">Now I Think</p>
                  <p className="mt-1 text-sm font-semibold leading-5 text-black/60">
                    How has your thinking changed? What caused the shift?
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="panel grid gap-5 p-6 md:p-8">
            <label className="grid gap-2">
              <span className="text-sm font-black uppercase tracking-[0.08em]">
                Grade band
              </span>
              <select
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="focus-ring rounded-[24px] border-2 border-black bg-[#fff2b7] px-5 py-4 text-xl font-black"
              >
                {GRADES.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-black uppercase tracking-[0.08em]">
                What did you just teach?
              </span>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Example: the water cycle, the causes of World War I, how fractions work..."
                className="focus-ring min-h-44 rounded-[24px] border-2 border-black bg-white px-5 py-4 text-xl font-semibold leading-7 placeholder:text-black/40"
              />
              <p className="text-sm font-bold text-black/50">
                This becomes the context for AI follow-up questions.
              </p>
            </label>

            {error ? <p className="font-black text-[#fd4401]">{error}</p> : null}

            <button
              onClick={launchSession}
              disabled={submitting || topic.trim().length < 4}
              className="focus-ring inline-flex items-center justify-center gap-2 rounded-full border-2 border-black bg-[#f780d4] px-7 py-5 text-xl font-black text-black transition hover:-translate-y-0.5 disabled:opacity-50"
            >
              <Rocket size={22} />
              {submitting ? "Launching..." : "Launch"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
