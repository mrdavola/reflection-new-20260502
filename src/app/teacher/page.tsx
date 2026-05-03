"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { getRedirectResult, signInWithRedirect, signOut } from "firebase/auth";
import {
  ArrowRight,
  Brain,
  FlaskConical,
  ImagePlus,
  MessageCircle,
  Play,
  Sparkles,
  Zap,
} from "lucide-react";
import { AccountMenu } from "./account-menu";
import { getFirebaseClientServices } from "@/lib/firebase/client";
import type { Session } from "@/lib/models";

export default function TeacherPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [isTeacherSession, setIsTeacherSession] = useState(false);
  const [authError, setAuthError] = useState("");

  async function loadSessions() {
    const response = await fetch("/api/sessions", { cache: "no-store" });
    if (response.status === 401) {
      setIsTeacherSession(false);
      setLoading(false);
      return;
    }
    const data = await response.json();
    setIsTeacherSession(true);
    setSessions(data.sessions ?? []);
    setLoading(false);
  }

  async function signInTeacher() {
    const { auth, googleProvider } = getFirebaseClientServices();
    if (!auth || !googleProvider) {
      setAuthError("Firebase Auth is not configured in this environment.");
      return;
    }
    setAuthenticating(true);
    setAuthError("");
    // Redirect-based auth works on all browsers — no popup blocked errors
    await signInWithRedirect(auth, googleProvider);
    // Page navigates away; the useEffect below handles the result on return
  }

  async function signOutTeacher() {
    const { auth } = getFirebaseClientServices();
    if (auth) {
      await signOut(auth);
    }
    await fetch("/api/auth/logout", { method: "POST" });
    setIsTeacherSession(false);
    setSessions([]);
    setLoading(false);
  }

  async function seedDemo() {
    setLoading(true);
    const response = await fetch("/api/demo/seed", { method: "POST" });
    const data = await response.json();
    await loadSessions();
    if (data.session?.id) {
      window.location.href = `/teacher/session/${data.session.id}/live`;
    }
  }

  useEffect(() => {
    let active = true;

    async function init() {
      // Handle Google redirect sign-in return
      const { auth, googleProvider } = getFirebaseClientServices();
      if (auth && googleProvider) {
        try {
          const result = await getRedirectResult(auth);
          if (result && active) {
            const idToken = await result.user.getIdToken();
            const sessionResponse = await fetch("/api/auth/session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ idToken }),
            });
            if (!sessionResponse.ok) {
              const data = await sessionResponse.json();
              setAuthError(data.error ?? "Could not start teacher session.");
            }
          }
        } catch (error) {
          if (active) {
            setAuthError(error instanceof Error ? error.message : "Could not sign in.");
          }
        }
      }

      // Load sessions (works whether we just redirected back or already signed in)
      const response = await fetch("/api/sessions", { cache: "no-store" });
      if (!active) return;
      if (response.status === 401) {
        setIsTeacherSession(false);
        setLoading(false);
        return;
      }
      const data = await response.json();
      if (!active) return;
      setIsTeacherSession(true);
      setSessions(data.sessions ?? []);
      setLoading(false);
    }

    init();

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#fdcb40] px-5 py-6 text-black md:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-[16px] border-2 border-black bg-[#04c6c5] text-black">
              <Sparkles size={20} />
            </div>
            <span className="display-type text-3xl font-bold">ReflectAI</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {isTeacherSession ? (
              <AccountMenu onSignOut={signOutTeacher} />
            ) : (
              <button
                onClick={signInTeacher}
                disabled={authenticating}
                className="focus-ring inline-flex items-center justify-center gap-2 rounded-full border-2 border-black bg-[#006cff] px-5 py-2 text-sm font-bold text-white transition hover:-translate-y-0.5 disabled:opacity-50"
              >
                {authenticating ? "Signing in..." : "Sign in"}
              </button>
            )}
          </div>
        </header>

        <div>
          <h1 className="display-type mt-10 max-w-4xl text-[4.6rem] font-bold leading-[0.85] md:text-[7rem]">
            Make thinking visible.
          </h1>
          <p className="mt-6 max-w-2xl text-2xl font-semibold leading-8">
            Launch a reflection, project the join code, and watch thinking
            patterns emerge while students finish.
          </p>
        </div>

        {isTeacherSession ? (
          <>
          <section className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <LaunchCard
              href="/teacher/spin/new"
              icon={<Sparkles size={26} />}
              title="Quick Spin"
              kicker="Randomized prompt"
              body="Project a spinner, select a category, and generate a random reflection question to launch."
              color="bg-[#04c6c5] text-black"
            />
            <LaunchCard
              href="/teacher/exit-ticket/new"
              icon={<MessageCircle size={26} />}
              title="Quick Reflection"
              kicker="One question, three follow-ups"
              body="Generate an exit ticket from the lesson you taught, approve it, and let AI ask quote-based follow-ups."
              color="bg-[#006cff] text-white"
            />
            <LaunchCard
              href="/teacher/new"
              icon={<ImagePlus size={26} />}
              title="See Think Wonder"
              kicker="Thinking routine"
              body="Launch the visible thinking routine with an uploaded, linked, text, or AI-generated stimulus."
              color="bg-[#fd4401] text-white"
            />
            <LaunchCard
              href="/teacher/wyr/new"
              icon={<Zap size={26} />}
              title="Would You Rather"
              kicker="AI lesson starter"
              body="Generate a curriculum-aligned Would You Rather scenario to spark debate and reasoning."
              color="bg-[#9b51e0] text-white"
            />
            <LaunchCard
              href="/teacher/iusedtothink/new"
              icon={<Brain size={26} />}
              title="I Used to Think"
              kicker="Metacognition routine"
              body="Students name their prior belief, then what changed — and what caused the shift."
              color="bg-[#f780d4] text-black"
            />
            <LaunchCard
              href="/teacher/csq/new"
              icon={<FlaskConical size={26} />}
              title="Claim Support Question"
              kicker="Argumentation routine"
              body="Students make a claim, back it with evidence, and name a question their claim raises."
              color="bg-[#00b351] text-white"
            />
          </section>
          <section className="mt-5">
            <button
              onClick={seedDemo}
              disabled={!isTeacherSession || loading}
              className="focus-ring w-full rounded-[28px] border-2 border-black bg-white p-7 text-left transition hover:-translate-y-0.5 disabled:opacity-50"
            >
              <div className="flex flex-wrap items-center gap-6">
                <div className="grid size-14 place-items-center rounded-[18px] border-2 border-black bg-[#fff2b7]">
                  <Play size={26} />
                </div>
                <div>
                  <p className="text-sm font-black uppercase tracking-[0.08em]">
                    Sample dashboard
                  </p>
                  <h2 className="display-type mt-1 text-4xl font-bold leading-none">
                    Demo Class
                  </h2>
                </div>
                <p className="ml-auto max-w-md text-lg font-bold leading-7">
                  Fill a session with sample student thinking so you can preview the
                  live dashboard without a room full of students.
                </p>
              </div>
            </button>
          </section>
          </>
        ) : null}

        <section className="mt-10 grid gap-4">
          {!isTeacherSession ? (
            <div className="panel p-10">
              <p className="display-type text-4xl font-bold">Teacher sign-in required</p>
              <p className="mt-3 max-w-xl text-xl font-semibold leading-7">
                Use your Google school account to open pilot sessions. Please sign in using the button in the top right corner.
              </p>
              {authError ? (
                <p className="mt-4 text-sm font-black text-[#fd4401]">{authError}</p>
              ) : null}
            </div>
          ) : null}
          {!isTeacherSession ? null : loading ? (
            <div className="panel p-8 text-xl font-bold">Loading sessions...</div>
          ) : sessions.length === 0 ? (
            <div className="panel p-10">
              <p className="display-type text-4xl font-bold">No sessions yet</p>
              <p className="mt-3 max-w-xl text-xl font-semibold leading-7">
                Start with Quick Reflection for the fastest classroom loop, or
                use Demo Class to see the dashboard already filled in.
              </p>
            </div>
          ) : (
            <>
              <h2 className="display-type text-4xl font-bold">Recent sessions</h2>
              {sessions.map((session) => (
                <Link
                  key={session.id}
                  href={`/teacher/session/${session.id}/live`}
                  className="panel flex flex-wrap items-center justify-between gap-4 p-7 transition hover:-translate-y-0.5 hover:bg-[#fff2b7]"
                >
                  <div>
                    <p className="display-type text-4xl font-bold">{session.title}</p>
                    <p className="mt-2 text-lg font-bold">
                      {session.doneCount} done · {session.joinedCount} joined · Code{" "}
                      {session.joinCode}
                    </p>
                  </div>
                  <ArrowRight className="text-[#006cff]" />
                </Link>
              ))}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function LaunchCard({
  href,
  icon,
  title,
  kicker,
  body,
  color,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  kicker: string;
  body: string;
  color: string;
}) {
  return (
    <Link
      href={href}
      className={`focus-ring rounded-[28px] border-2 border-black p-7 transition hover:-translate-y-0.5 ${color}`}
    >
      <div className="grid size-14 place-items-center rounded-[18px] border-2 border-black bg-white text-black">
        {icon}
      </div>
      <p className="mt-5 text-sm font-black uppercase tracking-[0.08em]">
        {kicker}
      </p>
      <h2 className="display-type mt-2 text-4xl font-bold leading-none">{title}</h2>
      <p className="mt-4 text-lg font-bold leading-7">{body}</p>
      <span className="mt-6 inline-flex items-center gap-2 rounded-full border-2 border-black bg-white px-5 py-3 text-sm font-black text-black">
        Launch <ArrowRight size={16} />
      </span>
    </Link>
  );
}
