"use client";

import Link from "next/link";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { signInWithPopup, signOut } from "firebase/auth";
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
  const [pilotUsername, setPilotUsername] = useState("teacher");
  const [pilotPassword, setPilotPassword] = useState("");

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

  async function refreshSessionsAfterSignIn() {
    setIsTeacherSession(true);
    setLoading(true);
    const sessionsResponse = await fetch("/api/sessions", { cache: "no-store" });
    if (sessionsResponse.ok) {
      const data = await sessionsResponse.json();
      setSessions(data.sessions ?? []);
    }
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
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      const idToken = await credential.user.getIdToken();
      const sessionResponse = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const sessionData = await sessionResponse.json();
      if (!sessionResponse.ok) {
        throw new Error(sessionData.error ?? "Could not start teacher session.");
      }
      // Fetch sessions directly — don't call loadSessions() which can override
      // isTeacherSession back to false if the cookie hasn't propagated yet
      await refreshSessionsAfterSignIn();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not sign in.";
      if (message.includes("popup-blocked") || message.includes("popup_blocked")) {
        setAuthError("Sign-in popup was blocked. Please allow popups for this site in your browser settings, then try again.");
      } else if (message.includes("popup-closed") || message.includes("popup_closed")) {
        setAuthError("Sign-in was cancelled. Try again.");
      } else {
        setAuthError(message);
      }
    } finally {
      setAuthenticating(false);
    }
  }

  async function signInPilot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthenticating(true);
    setAuthError("");
    try {
      const sessionResponse = await fetch("/api/auth/pilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: pilotUsername,
          password: pilotPassword,
        }),
      });
      const sessionData = await sessionResponse.json();
      if (!sessionResponse.ok) {
        throw new Error(sessionData.error ?? "Could not start pilot session.");
      }
      await refreshSessionsAfterSignIn();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setAuthenticating(false);
    }
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
    // Pre-warm Firebase so getAuth() is already initialized when the user clicks Sign In.
    // Without this, the first signInWithPopup call has to wait for SDK init,
    // which gives browsers enough of a delay to classify the popup as unsolicited and block it.
    getFirebaseClientServices();

    let active = true;
    fetch("/api/sessions", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          setIsTeacherSession(false);
          setLoading(false);
          return null;
        }
        return response.json();
      })
      .then((data) => {
        if (!data) return;
        if (!active) return;
        setIsTeacherSession(true);
        setSessions(data.sessions ?? []);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="min-h-dvh bg-[#fdcb40] px-5 py-5 text-black sm:py-6 md:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-[16px] border-2 border-black bg-[#04c6c5] text-black">
              <Sparkles size={20} />
            </div>
            <span className="display-type text-3xl font-bold">ReflectAI</span>
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            {isTeacherSession ? (
              <AccountMenu onSignOut={signOutTeacher} />
            ) : (
              <button
                onClick={signInTeacher}
                disabled={authenticating}
                className="focus-ring inline-flex items-center justify-center gap-2 rounded-full border-2 border-black bg-[#006cff] px-5 py-2 text-sm font-bold text-white transition hover:-translate-y-0.5 disabled:opacity-50"
              >
                {authenticating ? "Signing in..." : "Google sign in"}
              </button>
            )}
          </div>
        </header>

        <div>
          <h1 className="display-type mt-10 max-w-4xl text-[4.15rem] font-bold leading-[0.85] sm:text-[5.8rem] md:text-[6.8rem]">
            Make thinking visible.
          </h1>
          <p className="mt-6 max-w-3xl text-xl font-semibold leading-8 sm:text-2xl">
            Launch a reflection, project the join code, and watch thinking
            patterns emerge while students finish.
          </p>
        </div>

        {isTeacherSession ? (
          <>
          <section className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
            <div className="panel grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_420px] lg:p-10">
              <div>
                <p className="display-type text-4xl font-bold sm:text-5xl">
                  Teacher sign-in required
                </p>
                <p className="mt-3 max-w-xl text-lg font-semibold leading-7 sm:text-xl">
                  Use the pilot login for now, or your Google school account when
                  popups are available. The pilot login works cleanly on phones,
                  tablets, and laptops.
                </p>
                <div className="mt-5 rounded-[22px] border-2 border-black bg-[#fff2b7] p-4 text-base font-black leading-6">
                  Pilot username: <span className="font-black">teacher</span>
                  <br />
                  Pilot password: <span className="font-black">reflect</span>
                </div>
              </div>

              <form onSubmit={signInPilot} className="rounded-[24px] border-2 border-black bg-[#fff2b7] p-5">
                <p className="text-sm font-black uppercase tracking-[0.08em]">
                  Simple pilot login
                </p>
                <label className="mt-4 grid gap-2">
                  <span className="text-sm font-black uppercase tracking-[0.08em]">
                    Username
                  </span>
                  <input
                    value={pilotUsername}
                    onChange={(event) => setPilotUsername(event.target.value)}
                    className="focus-ring w-full rounded-full border-2 border-black bg-white px-5 py-3 text-lg font-black"
                    autoCapitalize="none"
                    autoComplete="username"
                  />
                </label>
                <label className="mt-4 grid gap-2">
                  <span className="text-sm font-black uppercase tracking-[0.08em]">
                    Password
                  </span>
                  <input
                    value={pilotPassword}
                    onChange={(event) => setPilotPassword(event.target.value)}
                    className="focus-ring w-full rounded-full border-2 border-black bg-white px-5 py-3 text-lg font-black"
                    type="password"
                    autoComplete="current-password"
                  />
                </label>
                <button
                  type="submit"
                  disabled={authenticating || pilotUsername.trim().length === 0 || pilotPassword.length === 0}
                  className="focus-ring mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full border-2 border-black bg-[#fd4401] px-7 py-4 font-black text-white transition hover:-translate-y-0.5 disabled:opacity-50"
                >
                  {authenticating ? "Signing in..." : "Enter dashboard"}
                  <ArrowRight size={18} />
                </button>
              </form>

              {authError ? (
                <p className="text-sm font-black text-[#fd4401] lg:col-span-2">{authError}</p>
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
