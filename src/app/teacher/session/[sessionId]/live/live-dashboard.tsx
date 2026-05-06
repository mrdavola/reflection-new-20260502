"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCopy,
  Lightbulb,
  QrCode,
  Users,
} from "lucide-react";
import { AccountMenu } from "@/app/teacher/account-menu";
import { getPriorityCards, getTeacherNextMove } from "@/lib/actionability";
import { getRoutineDashboardPanels } from "@/lib/dashboard-panels";
import { getRoutine } from "@/lib/routines";
import type { DashboardPayload } from "@/lib/models";
import type {
  ClassThinkingMap,
  RoutineStepLabel,
  SafetyAlert,
  VotingState,
} from "@/lib/types";
import VotingControls from "../voting-controls";
import AmberModal from "../voting-amber-modal";
import VotingResults from "../voting-results";

interface AmberResponse {
  id: string;
  transcription: string;
  alert: SafetyAlert;
}

export default function LiveDashboard({ sessionId }: { sessionId: string }) {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [qr, setQr] = useState("");
  const [browserOrigin] = useState(() =>
    typeof window !== "undefined" ? window.location.origin : "",
  );
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [votingState, setVotingState] = useState<VotingState>("inactive");
  const [amberResponses, setAmberResponses] = useState<AmberResponse[]>([]);
  const [votingError, setVotingError] = useState<string | null>(null);
  const [authorsRevealed, setAuthorsRevealed] = useState(false);

  const loadDashboard = useCallback(async () => {
    const response = await fetch(`/api/sessions/${sessionId}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    setDashboard(data);
    setVotingState(data.session.votingState || "inactive");
  }, [sessionId]);

  const handleStartVoting = async () => {
    try {
      const res = await fetch(`/api/session/${sessionId}/voting/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.skipped) {
          setVotingError(data.reason || "Voting skipped");
          setVotingState("ended");
        } else {
          setVotingState("review_pending");
          if (data.amberFlaggedResponses && data.amberFlaggedResponses.length > 0) {
            setAmberResponses(data.amberFlaggedResponses);
          } else {
            setVotingState("round_1");
          }
        }
      } else {
        const errorData = await res.json();
        setVotingError(errorData.message || "Failed to start voting");
      }
    } catch {
      setVotingError("Network error starting voting");
    }
  };

  const handleAmberResolved = () => {
    setAmberResponses([]);
    setVotingState("round_1");
    void loadDashboard();
  };

  const handleStateChange = (newState: VotingState) => {
    setVotingState(newState);
    setVotingError(null);
    void loadDashboard();
  };

  const handleVotingAdvance = async (action: string) => {
    try {
      const res = await fetch(`/api/session/${sessionId}/voting/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        const newState =
          data.votingState || (action === "reveal_to_discuss" ? "discuss" : "ended");
        setVotingState(newState as VotingState);
        setVotingError(null);
      } else {
        const errorData = await res.json();
        setVotingError(errorData.message || "Failed to advance voting");
      }
    } catch {
      setVotingError("Network error advancing voting");
    }
  };

  const handleRevealAuthors = async () => {
    try {
      const res = await fetch(`/api/session/${sessionId}/voting/reveal-authors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        setAuthorsRevealed(true);
      } else {
        const errorData = await res.json();
        setVotingError(errorData.message || "Failed to reveal authors");
      }
    } catch {
      setVotingError("Network error revealing authors");
    }
  };

  async function generateSummary() {
    setLoadingSummary(true);
    await fetch(`/api/sessions/${sessionId}/summary`, { method: "POST" });
    setLoadingSummary(false);
    await loadDashboard();
  }

  useEffect(() => {
    fetch(`/api/sessions/${sessionId}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data) setDashboard(data);
      });
    const timer = window.setInterval(loadDashboard, 2000);
    return () => window.clearInterval(timer);
  }, [loadDashboard, sessionId]);

  const shareUrl = useMemo(() => {
    if (!dashboard) return "";
    const origin =
      browserOrigin || (typeof window !== "undefined" ? window.location.origin : "");
    if (!origin) return dashboard.session.joinLink;
    return `${origin}/join/${dashboard.session.joinCode}`;
  }, [browserOrigin, dashboard]);

  const codeEntryUrl = useMemo(() => {
    const origin = browserOrigin || (typeof window !== "undefined" ? window.location.origin : "");
    return origin ? `${origin}/join` : "/join";
  }, [browserOrigin]);

  useEffect(() => {
    if (!shareUrl) return;
    QRCode.toDataURL(shareUrl, {
      margin: 1,
      width: 220,
      color: { dark: "#000000", light: "#ffffff" },
    }).then(setQr);
  }, [shareUrl]);

  async function copyShare(value: string, kind: "code" | "link") {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1400);
  }

  const progress = useMemo(() => {
    if (!dashboard) return 0;
    return Math.round(
      (dashboard.session.doneCount / Math.max(dashboard.session.joinedCount, 1)) * 100,
    );
  }, [dashboard]);

  if (!dashboard) {
    return (
      <main className="min-h-screen bg-[#fdcb40] p-8 text-xl font-bold text-black">
        Loading dashboard...
      </main>
    );
  }

  const { session, participants, reflections } = dashboard;
  const nextMove = getTeacherNextMove(dashboard);
  const priorityCards = getPriorityCards(dashboard);

  return (
    <main className="min-h-screen bg-[#fdcb40] px-5 py-5 text-black">
      <div className="mx-auto max-w-[1500px]">
        <div className="flex w-full justify-end pb-2">
          <AccountMenu
            onSignOut={async () => {
              const { getFirebaseClientServices } = await import("@/lib/firebase/client");
              const { signOut } = await import("firebase/auth");
              const { auth } = getFirebaseClientServices();
              if (auth) {
                await signOut(auth);
              }
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.href = "/teacher";
            }}
          />
        </div>
        {session.routineId === "would-you-rather" ? (
          <WyrScoreboard session={session} reflections={reflections} qr={qr} copyShare={copyShare} shareUrl={shareUrl} copied={copied} />
        ) : (
          <header className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-black pb-5">
            <div>
              <Link
                href="/teacher"
                className="focus-ring inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold"
              >
                <ArrowLeft size={16} />
                Sessions
              </Link>
              <h1 className="display-type mt-4 text-5xl font-bold leading-[0.9]">
                {session.title}
              </h1>
              <p className="mt-2 max-w-2xl text-xl font-semibold">
                {session.learningTarget || "No learning target set"}
              </p>
            </div>
            <div className="flex items-center gap-4 rounded-[24px] border-2 border-black bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {qr ? <img src={qr} alt="Student join QR code" className="size-32" /> : null}
              <div>
                <p className="text-sm font-black uppercase tracking-[0.08em]">Join code</p>
                <p className="display-type text-5xl font-bold tracking-[0.12em]">
                  {session.joinCode}
                </p>
                <button
                  onClick={() => copyShare(shareUrl, "link")}
                  className="focus-ring mt-2 inline-flex items-center gap-2 rounded-full text-sm font-bold text-[#006cff]"
                >
                  <ClipboardCopy size={14} />
                  {copied === "link" ? "Copied" : "Copy link"}
                </button>
              </div>
            </div>
          </header>
        )}

        <div className="mt-5 grid gap-5 xl:grid-cols-[320px_1fr_360px]">
          <aside className="space-y-5">
            <section className={`rounded-[24px] border-2 border-black p-5 ${
              nextMove.tone === "urgent"
                ? "bg-[#fd4401] text-white"
                : nextMove.tone === "setup"
                  ? "bg-[#006cff] text-white"
                  : "bg-[#fff2b7]"
            }`}>
              <p className="text-sm font-black uppercase tracking-[0.08em]">
                Next 5-minute move
              </p>
              <h2 className="display-type mt-2 text-3xl font-bold leading-none">
                {nextMove.title}
              </h2>
              <p className="mt-4 text-lg font-black leading-6">{nextMove.action}</p>
              <p className="mt-3 text-sm font-bold leading-6 opacity-80">
                {nextMove.detail}
              </p>
            </section>

            <section className="rounded-[24px] border-2 border-black bg-[#006cff] p-5 text-white">
              <div className="flex items-center justify-between gap-3">
                <h2 className="display-type text-3xl font-bold leading-none">
                  Student entry
                </h2>
                <QrCode size={24} />
              </div>
              <p className="mt-4 text-sm font-black uppercase tracking-[0.08em]">
                Board instructions
              </p>
              <p className="mt-2 text-lg font-bold leading-6">
                Go to <span className="underline decoration-2">{codeEntryUrl.replace(/^https?:\/\//, "")}</span>
                <br />
                Enter code <span className="tracking-[0.12em]">{session.joinCode}</span>
              </p>
              <div className="mt-5 grid gap-2">
                <button
                  onClick={() => copyShare(session.joinCode, "code")}
                  className="focus-ring rounded-full border-2 border-black bg-white px-4 py-3 text-sm font-black text-black"
                >
                  {copied === "code" ? "Code copied" : "Copy code"}
                </button>
                <button
                  onClick={() => copyShare(shareUrl, "link")}
                  className="focus-ring rounded-full border-2 border-black bg-[#fd4401] px-4 py-3 text-sm font-black text-white"
                >
                  {copied === "link" ? "Link copied" : "Copy student link"}
                </button>
              </div>
            </section>

            {session.routineId === "see-think-wonder" ? (
              <StimulusPreview stimulus={session.stimulus} />
            ) : null}

            <section className="panel p-5">
              <div className="flex items-center justify-between">
                <h2 className="display-type text-2xl font-bold">Class pulse</h2>
                <Users size={20} className="text-[#006cff]" />
              </div>
              <p className="display-type mt-4 text-6xl font-bold leading-none">
                {session.doneCount}/{Math.max(session.joinedCount, 1)}
              </p>
              <p className="text-base font-bold">students complete</p>
              <div className="mt-5 h-5 overflow-hidden rounded-full border-2 border-black bg-white">
                <div className="h-full bg-[#00b351]" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2 text-center text-sm">
                <Metric label="Joined" value={session.joinedCount} />
                <Metric label="Reflecting" value={session.reflectingCount} />
                <Metric label="Alerts" value={session.alertCount} />
              </div>
            </section>

            <section className="panel p-5">
              <h2 className="display-type text-2xl font-bold">Students</h2>
              <div className="mt-4 space-y-2">
                {participants.length === 0 ? (
                  <p className="text-sm font-bold">Waiting for students...</p>
                ) : (
                  participants.map((participant) => (
                    <div
                      key={participant.id}
                      className="flex items-center justify-between rounded-full border-2 border-black bg-[#fff2b7] px-4 py-3"
                    >
                      <span className="font-bold">{participant.displayName}</span>
                      <span className="text-xs font-black uppercase">
                        {participant.status}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>

          {session.routineId === "i-used-to-think" ? (
            <section className="panel p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="display-type text-4xl font-bold">
                    I Used to Think… Now I Think
                  </h2>
                  <p className="mt-1 text-base font-semibold">
                    Before and after thinking, updated live as students reflect.
                  </p>
                </div>
                <Lightbulb className="text-[#f780d4]" />
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-[24px] border-2 border-black bg-[#fff2b7] p-4">
                  <p className="text-sm font-black uppercase tracking-[0.08em]">Used to Think</p>
                  <p className="mt-1 text-sm font-semibold text-black/60">Prior beliefs before the lesson</p>
                </div>
                <div className="rounded-[24px] border-2 border-black bg-[#00b351] p-4 text-white">
                  <p className="text-sm font-black uppercase tracking-[0.08em]">Now I Think</p>
                  <p className="mt-1 text-sm font-semibold text-white/70">How thinking changed</p>
                </div>
              </div>
              <div className="mt-4 grid gap-4">
                {reflections.length === 0 ? (
                  <p className="rounded-[24px] border-2 border-black bg-white p-5 font-bold">
                    Waiting for students to join.
                  </p>
                ) : (
                  reflections.map((reflection) => {
                    const usedToThink = reflection.steps.find((s) => s.label === "Used to Think");
                    const nowIThink = reflection.steps.find((s) => s.label === "Now I Think");
                    return (
                      <article
                        key={reflection.id}
                        className="rounded-[24px] border-2 border-black bg-white p-5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h3 className="display-type text-3xl font-bold">
                            {reflection.displayName}
                          </h3>
                          <span className="rounded-full border-2 border-black bg-[#04c6c5] px-3 py-1 text-sm font-black">
                            {reflection.completedAt ? "Done" : usedToThink ? "Step 2" : "Step 1"}
                          </span>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-[20px] border-2 border-black bg-[#fff2b7] p-4">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-xs font-black uppercase tracking-[0.08em]">Used to Think</p>
                              {usedToThink && <Rating rating={usedToThink.depthScore ?? 1} />}
                            </div>
                            {usedToThink ? (
                              <>
                                <p className="mt-3 text-lg font-black leading-6">
                                  &ldquo;{usedToThink.directQuote ?? usedToThink.transcription}&rdquo;
                                </p>
                                {usedToThink.followUpQuestion ? (
                                  <p className="mt-3 border-l-4 border-[#006cff] pl-3 text-sm font-black leading-6">
                                    {usedToThink.followUpQuestion}
                                  </p>
                                ) : null}
                              </>
                            ) : (
                              <p className="mt-3 text-sm font-bold text-black/50">Waiting…</p>
                            )}
                          </div>
                          <div className="rounded-[20px] border-2 border-black bg-[#00b351]/10 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-xs font-black uppercase tracking-[0.08em]">Now I Think</p>
                              {nowIThink && <Rating rating={nowIThink.depthScore ?? 1} />}
                            </div>
                            {nowIThink ? (
                              <>
                                <p className="mt-3 text-lg font-black leading-6">
                                  &ldquo;{nowIThink.directQuote ?? nowIThink.transcription}&rdquo;
                                </p>
                                {nowIThink.followUpQuestion ? (
                                  <p className="mt-3 border-l-4 border-[#00b351] pl-3 text-sm font-black leading-6">
                                    {nowIThink.followUpQuestion}
                                  </p>
                                ) : null}
                              </>
                            ) : (
                              <p className="mt-3 text-sm font-bold text-black/50">Waiting…</p>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          ) : session.routineId === "claim-support-question" ? (
            <section className="panel p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="display-type text-4xl font-bold">
                    Claim · Support · Question
                  </h2>
                  <p className="mt-1 text-base font-semibold">
                    Student arguments build live — claim first, then evidence, then a question.
                  </p>
                </div>
                <Lightbulb className="text-[#00b351]" />
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                {[
                  { label: "Claim", color: "bg-[#fff2b7]", textColor: "" },
                  { label: "Support", color: "bg-[#00b351]", textColor: "text-white" },
                  { label: "Question", color: "bg-[#006cff]", textColor: "text-white" },
                ].map(({ label, color, textColor }) => (
                  <div key={label} className={`rounded-[24px] border-2 border-black p-4 ${color} ${textColor}`}>
                    <p className="text-sm font-black uppercase tracking-[0.08em] opacity-80">{label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-4">
                {reflections.length === 0 ? (
                  <p className="rounded-[24px] border-2 border-black bg-white p-5 font-bold">
                    Waiting for students to join.
                  </p>
                ) : (
                  reflections.map((reflection) => {
                    const claim = reflection.steps.find((s) => s.label === "Claim");
                    const support = reflection.steps.find((s) => s.label === "Support");
                    const question = reflection.steps.find((s) => s.label === "Question");
                    const stepsDone = [claim, support, question].filter(Boolean).length;
                    return (
                      <article
                        key={reflection.id}
                        className="rounded-[24px] border-2 border-black bg-white p-5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h3 className="display-type text-3xl font-bold">
                            {reflection.displayName}
                          </h3>
                          <span className="rounded-full border-2 border-black bg-[#04c6c5] px-3 py-1 text-sm font-black">
                            {reflection.completedAt ? "Done" : `Step ${stepsDone + 1}/3`}
                          </span>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          {[
                            { step: claim, label: "Claim", bg: "bg-[#fff2b7]", border: "border-[#006cff]" },
                            { step: support, label: "Support", bg: "bg-[#00b351]/10", border: "border-[#00b351]" },
                            { step: question, label: "Question", bg: "bg-[#006cff]/10", border: "border-[#9b51e0]" },
                          ].map(({ step, label, bg, border }) => (
                            <div key={label} className={`rounded-[20px] border-2 border-black p-4 ${bg}`}>
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-xs font-black uppercase tracking-[0.08em]">{label}</p>
                                {step && <Rating rating={step.depthScore ?? 1} />}
                              </div>
                              {step ? (
                                <>
                                  <p className="mt-3 text-lg font-black leading-6">
                                    &ldquo;{step.directQuote ?? step.transcription}&rdquo;
                                  </p>
                                  {step.followUpQuestion ? (
                                    <p className={`mt-3 border-l-4 ${border} pl-3 text-sm font-black leading-6`}>
                                      {step.followUpQuestion}
                                    </p>
                                  ) : null}
                                </>
                              ) : (
                                <p className="mt-3 text-sm font-bold text-black/50">Waiting…</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          ) : session.routineId === "exit-ticket-conversation" ? (
            <section className="panel p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="display-type text-4xl font-bold">
                    Exit Ticket Conversations
                  </h2>
                  <p className="mt-1 text-base font-semibold">
                    Direct quotes, depth ratings, and follow-up paths update live.
                  </p>
                </div>
                <Lightbulb className="text-[#006cff]" />
              </div>
              <div className="mt-5 rounded-[24px] border-2 border-black bg-[#fff2b7] p-5">
                <p className="text-sm font-black uppercase tracking-[0.08em]">
                  Approved question
                </p>
                <p className="mt-2 text-2xl font-black leading-8">
                  {session.exitTicketQuestion}
                </p>
              </div>
              <div className="mt-5 grid gap-4">
                {reflections.length === 0 ? (
                  <p className="rounded-[24px] border-2 border-black bg-white p-5 font-bold">
                    Waiting for students to join.
                  </p>
                ) : (
                  reflections.map((reflection) => (
                    <article
                      key={reflection.id}
                      className="rounded-[24px] border-2 border-black bg-white p-5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="display-type text-3xl font-bold">
                          {reflection.displayName}
                        </h3>
                        <span className="rounded-full border-2 border-black bg-[#04c6c5] px-3 py-1 text-sm font-black">
                          {reflection.completedAt ? "Done" : `${reflection.steps.length}/4 turns`}
                        </span>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {reflection.steps.length === 0 ? (
                          <p className="font-bold">No response yet.</p>
                        ) : (
                          reflection.steps.map((step, index) => (
                            <div
                              key={`${reflection.id}-${step.label}-${index}`}
                              className="rounded-[20px] border-2 border-black bg-[#fff2b7] p-4"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-xs font-black uppercase tracking-[0.08em]">
                                  {step.label}
                                </p>
                                <Rating rating={step.rating ?? step.depthScore ?? 1} />
                              </div>
                              <p className="mt-3 text-lg font-black leading-6">
                                “{step.directQuote ?? step.transcription}”
                              </p>
                              <p className="mt-2 text-sm font-bold leading-6">
                                {step.teacherSummary}
                              </p>
                              {step.followUpQuestion ? (
                                <p className="mt-3 border-l-4 border-[#006cff] pl-3 text-sm font-black leading-6">
                                  Next: {step.followUpQuestion}
                                </p>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          ) : (
            <RoutineThinkingMapSection dashboard={dashboard} />
          )}

          <aside className="space-y-5">
            {getRoutine(session.routineId).peerVotingDefault && (
              <section className="panel p-5">
                <div className="flex items-center justify-between">
                  <h2 className="display-type text-2xl font-bold">Peer voting</h2>
                </div>
                {votingError && (
                  <div className="mt-3 rounded-[16px] border-2 border-black bg-[#fd4401] p-3 text-sm font-bold text-white">
                    {votingError}
                  </div>
                )}
                {votingState === "inactive" && (
                  <div className="mt-3">
                    <p className="text-sm font-semibold leading-6">
                      {session.joinedCount < 5
                        ? `Need at least 5 students to start voting (currently ${session.joinedCount})`
                        : "Ready to start peer voting."}
                    </p>
                    <button
                      onClick={handleStartVoting}
                      disabled={session.joinedCount < 5}
                      className="focus-ring mt-3 inline-flex w-full items-center justify-center rounded-full border-2 border-black bg-[#006cff] px-5 py-3 font-black text-white disabled:opacity-50"
                    >
                      Start voting
                    </button>
                  </div>
                )}
                {votingState !== "inactive" && (
                  <div className="mt-3 space-y-3">
                    <p className="text-xs font-black uppercase tracking-[0.08em]">
                      State: {votingState}
                    </p>
                    <VotingControls
                      sessionId={sessionId}
                      votingState={votingState}
                      reflectionCount={session.joinedCount}
                      onStateChange={handleStateChange}
                      onError={setVotingError}
                    />
                  </div>
                )}
                {votingState === "review_pending" && amberResponses.length > 0 && (
                  <AmberModal
                    responses={amberResponses}
                    sessionId={sessionId}
                    onResolve={handleAmberResolved}
                    onError={setVotingError}
                  />
                )}
                {votingState === "reveal" && session.votingPool?.rankedTop3 && (
                  <div className="mt-3">
                    <VotingResults
                      topThree={session.votingPool.rankedTop3.map((r) => {
                        const reflection = reflections.find((ref) => ref.id === r.reflectionId);
                        const transcription = reflection?.steps[0]?.transcription || "";
                        return {
                          reflectionId: r.reflectionId,
                          studentName: r.studentName,
                          voteCount: r.voteCount,
                          transcription,
                        };
                      })}
                      authorsRevealed={authorsRevealed}
                      onRevealAuthors={handleRevealAuthors}
                      onDiscuss={() => handleVotingAdvance("reveal_to_discuss")}
                      onEnd={() => handleVotingAdvance("discuss_to_ended")}
                    />
                  </div>
                )}
              </section>
            )}

            <section className="panel p-5">
              <div className="flex items-center justify-between">
                <h2 className="display-type text-2xl font-bold">Priority cards</h2>
                <AlertTriangle size={20} className="text-[#fd4401]" />
              </div>
              <div className="mt-4 space-y-3">
                {priorityCards.length > 0
                  ? priorityCards.map((card) => (
                      <div
                        key={card.id}
                        className={`rounded-[20px] border-2 border-black p-4 ${
                          card.kind === "urgent"
                            ? "bg-[#fd4401] text-white"
                            : card.kind === "celebrate"
                              ? "bg-[#04c6c5]"
                              : card.kind === "peer-match"
                                ? "bg-[#9b51e0] text-white"
                            : "bg-[#fff2b7]"
                        }`}
                      >
                        <p className="text-xs font-black uppercase tracking-[0.08em]">
                          {card.kind === "urgent"
                            ? "Review now"
                            : card.kind === "celebrate"
                              ? "Shareable thinking"
                              : card.kind === "peer-match"
                                ? "Peer Match"
                              : "Needs support"}
                        </p>
                        <p className="mt-1 font-black">{card.title}</p>
                        <p className="mt-2 text-sm font-semibold leading-5">
                          “{card.evidence}”
                        </p>
                        <p className="mt-3 border-l-4 border-black pl-3 text-sm font-black leading-5">
                          {card.action}
                        </p>
                      </div>
                    ))
                  : null}
                {priorityCards.length === 0 ? (
                  <p className="text-sm font-bold">Cards appear as students submit.</p>
                ) : null}
              </div>
            </section>

            <section className="panel p-5">
              <div className="flex items-center justify-between">
                <h2 className="display-type text-2xl font-bold">Class summary</h2>
                <CheckCircle2 size={20} className="text-[#00b351]" />
              </div>
              <p className="mt-3 whitespace-pre-line text-base font-semibold leading-7">
                {session.classSummary ?? "Generate once students have completed reflections."}
              </p>
              <button
                onClick={generateSummary}
                disabled={loadingSummary || session.doneCount === 0}
                className="focus-ring mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border-2 border-black bg-[#fd4401] px-7 py-4 font-bold text-white transition hover:-translate-y-0.5 disabled:opacity-50"
              >
                {loadingSummary ? "Generating..." : "Generate summary"}
              </button>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function StimulusPreview({
  stimulus,
}: {
  stimulus: { kind: "image" | "text" | "link" | "none"; value: string };
}) {
  if (stimulus.kind === "none" || !stimulus.value) return null;

  return (
    <section className="panel p-5">
      <h2 className="display-type text-2xl font-bold">Stimulus</h2>
      {stimulus.kind === "image" ? (
        <div className="mt-4 rounded-[20px] border-2 border-black bg-[#fff2b7] p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={stimulus.value}
            alt="See Think Wonder stimulus"
            className="max-h-56 w-full rounded-[14px] object-cover"
          />
        </div>
      ) : stimulus.kind === "link" ? (
        <a
          href={stimulus.value}
          target="_blank"
          rel="noreferrer"
          className="focus-ring mt-4 block rounded-[20px] border-2 border-black bg-[#fff2b7] p-4 text-sm font-black underline"
        >
          Open stimulus link
        </a>
      ) : (
        <p className="mt-4 rounded-[20px] border-2 border-black bg-[#fff2b7] p-4 text-sm font-bold leading-6">
          {stimulus.value}
        </p>
      )}
    </section>
  );
}

function RoutineThinkingMapSection({
  dashboard,
}: {
  dashboard: DashboardPayload;
}) {
  const { session, reflections } = dashboard;
  const config = getRoutineDashboardPanels(
    session.routineId,
    session.exitTicketMaxTurns ?? 4,
  );
  const gridClass =
    config.panels.length === 2
      ? "lg:grid-cols-2"
      : config.panels.length === 4
        ? "lg:grid-cols-2 2xl:grid-cols-4"
        : "lg:grid-cols-3";

  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="display-type text-4xl font-bold">{config.title}</h2>
          <p className="mt-1 text-base font-semibold">{config.subtitle}</p>
        </div>
        <Lightbulb className="text-[#006cff]" />
      </div>
      {session.routineId === "see-think-wonder" &&
      session.stimulus.kind === "image" ? (
        <AnnotationOverlay
          imageUrl={session.stimulus.value}
          reflections={reflections}
        />
      ) : null}
      {session.routineId === "quick-spin" || session.routineId === "exit-ticket-conversation" ? (
        <div className="mt-5 rounded-[24px] border-2 border-black bg-[#fff2b7] p-5">
          <p className="text-sm font-black uppercase tracking-[0.08em]">
            Teacher prompt
          </p>
          <p className="mt-2 text-2xl font-black leading-8">
            {session.exitTicketQuestion}
          </p>
        </div>
      ) : null}
      <div className={`mt-5 grid gap-4 ${gridClass}`}>
        {config.panels.map((panel) => (
          <div key={panel.label} className="soft-panel min-h-[360px] p-4">
            <div className={`rounded-[18px] border-2 border-black p-4 ${panel.accentClass}`}>
              <h3 className="display-type text-3xl font-bold">{panel.label}</h3>
              <p className="mt-1 text-sm font-black leading-5 opacity-80">
                {panel.description}
              </p>
            </div>
            <div className="mt-4 space-y-3">
              {session.routineId === "see-think-wonder" ? (
                <ThinkingMapClusters
                  map={session.classThinkingMap}
                  label={panel.stepLabels[0]}
                />
              ) : (
                <StepResponseCards
                  reflections={reflections}
                  labels={panel.stepLabels}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ThinkingMapClusters({
  map,
  label,
}: {
  map: ClassThinkingMap;
  label: RoutineStepLabel;
}) {
  const key = label === "See" ? "see" : label === "Think" ? "think" : "wonder";
  const clusters = map[key];

  if (clusters.length === 0) {
    return <p className="text-sm font-bold">No responses yet.</p>;
  }

  return clusters.map((cluster) => (
    <article
      key={cluster.label}
      className="rounded-[20px] border-2 border-black bg-white p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-lg font-black">{cluster.label}</p>
        <span className="rounded-full border-2 border-black bg-[#04c6c5] px-2 py-1 text-xs font-black">
          {cluster.studentIds.length}
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold leading-6">{cluster.summary}</p>
      <p className="mt-3 border-l-4 border-[#006cff] pl-3 text-sm font-bold">
        &ldquo;{cluster.representativeQuotes[0]}&rdquo;
      </p>
    </article>
  ));
}

function StepResponseCards({
  reflections,
  labels,
}: {
  reflections: DashboardPayload["reflections"];
  labels: RoutineStepLabel[];
}) {
  const responses = reflections.flatMap((reflection) =>
    reflection.steps
      .filter((step) => labels.includes(step.label))
      .map((step) => ({
        id: `${reflection.id}-${step.label}`,
        displayName: reflection.displayName,
        step,
      })),
  );

  if (responses.length === 0) {
    return <p className="text-sm font-bold">No responses yet.</p>;
  }

  return responses.map((response) => (
    <article
      key={response.id}
      className="rounded-[20px] border-2 border-black bg-white p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-black">{response.displayName}</p>
        <Rating rating={response.step.rating ?? response.step.depthScore ?? 1} />
      </div>
      <p className="mt-3 text-base font-black leading-6">
        &ldquo;{response.step.directQuote ?? response.step.transcription}&rdquo;
      </p>
      {response.step.teacherSummary ? (
        <p className="mt-2 text-sm font-bold leading-5 text-black/70">
          {response.step.teacherSummary}
        </p>
      ) : null}
      {response.step.followUpQuestion ? (
        <p className="mt-3 border-l-4 border-[#006cff] pl-3 text-sm font-black leading-5">
          Next: {response.step.followUpQuestion}
        </p>
      ) : null}
    </article>
  ));
}

function AnnotationOverlay({
  imageUrl,
  reflections,
}: {
  imageUrl: string;
  reflections: DashboardPayload["reflections"];
}) {
  const annotations = reflections.flatMap((reflection) =>
    reflection.steps.flatMap((step) =>
      (step.annotations ?? []).map((annotation) => ({
        ...annotation,
        label: step.label,
        displayName: reflection.displayName,
      })),
    ),
  );

  if (annotations.length === 0) {
    return (
      <div className="mt-5 rounded-[24px] border-2 border-black bg-[#fff2b7] p-5">
        <p className="text-sm font-black uppercase tracking-[0.08em]">
          Image annotations
        </p>
        <p className="mt-2 text-lg font-bold">
          Student sticky notes will appear on the stimulus image as they submit.
        </p>
      </div>
    );
  }

  const colors: Record<string, string> = {
    See: "bg-[#04c6c5]",
    Think: "bg-[#006cff] text-white",
    Wonder: "bg-[#f780d4]",
  };

  return (
    <div className="mt-5 rounded-[24px] border-2 border-black bg-[#fff2b7] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.08em]">
            Image annotations
          </p>
          <p className="text-lg font-black">
            {annotations.length} sticky notes across the class
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-black uppercase">
          {["See", "Think", "Wonder"].map((label) => (
            <span
              key={label}
              className={`rounded-full border-2 border-black px-3 py-1 ${colors[label]}`}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_260px]">
        <div className="relative overflow-hidden rounded-[20px] border-2 border-black bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="Annotated stimulus" className="w-full object-cover" />
          {annotations.map((annotation, index) => (
            <span
              key={`${annotation.id}-${index}`}
              className={`absolute grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-black text-xs font-black ${
                colors[annotation.label] ?? "bg-white"
              }`}
              style={{ left: `${annotation.x}%`, top: `${annotation.y}%` }}
              title={`${annotation.displayName}: ${annotation.text}`}
            >
              {index + 1}
            </span>
          ))}
        </div>
        <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
          {annotations.slice(0, 12).map((annotation, index) => (
            <article
              key={`${annotation.id}-list-${index}`}
              className="rounded-[18px] border-2 border-black bg-white p-3"
            >
              <p className="text-xs font-black uppercase tracking-[0.08em]">
                {index + 1}. {annotation.label} · {annotation.displayName}
              </p>
              <p className="mt-1 text-sm font-bold leading-5">{annotation.text}</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[18px] border-2 border-black bg-white p-3">
      <p className="display-type text-2xl font-bold">{value}</p>
      <p className="text-xs font-bold">{label}</p>
    </div>
  );
}

function Rating({ rating }: { rating: number }) {
  return (
    <div className="flex w-20 gap-1" aria-label={`Depth rating ${rating} of 4`}>
      {[1, 2, 3, 4].map((item) => (
        <span
          key={item}
          className={`h-2 flex-1 rounded-full border border-black ${
            item <= rating ? "bg-[#006cff]" : "bg-white"
          }`}
        />
      ))}
    </div>
  );
}

type WyrScoreboardProps = {
  session: DashboardPayload["session"];
  reflections: DashboardPayload["reflections"];
  qr: string;
  copyShare: (value: string, kind: "code" | "link") => Promise<void>;
  shareUrl: string;
  copied: "code" | "link" | null;
};

function WyrScoreboard({
  session,
  reflections,
  qr,
  copyShare,
  shareUrl,
  copied,
}: WyrScoreboardProps) {
  const opts = session.wyrOptions;
  let countA = 0;
  let countB = 0;
  reflections.forEach((r) => {
    const choice = r.steps[0]?.transcription;
    if (choice?.startsWith("Option A")) countA++;
    else if (choice?.startsWith("Option B")) countB++;
  });
  const total = countA + countB;
  const pctA = total === 0 ? 0 : Math.round((countA / total) * 100);
  const pctB = total === 0 ? 0 : Math.round((countB / total) * 100);

  return (
    <div className="mb-5 flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-black pb-5">
        <div>
          <Link href="/teacher" className="focus-ring inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold"><ArrowLeft size={16} />Sessions</Link>
          <h1 className="display-type mt-4 text-5xl font-bold leading-[0.9]">{session.title}</h1>
        </div>
        <div className="flex items-center gap-4 rounded-[24px] border-2 border-black bg-white p-3">
          {qr && <img src={qr} alt="QR code" className="size-32" />}
          <div>
            <p className="text-sm font-black uppercase tracking-[0.08em]">Join code</p>
            <p className="display-type text-5xl font-bold tracking-[0.12em]">{session.joinCode}</p>
            <button
              onClick={() => copyShare(shareUrl, "link")}
              className="focus-ring mt-2 inline-flex items-center gap-2 rounded-full text-sm font-bold text-[#006cff]"
            >
              <ClipboardCopy size={14} />
              {copied === "link" ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      </header>
      <div className="grid md:grid-cols-2 gap-0 border-4 border-black rounded-[3rem] overflow-hidden shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
        <div className="bg-[#04c6c5] flex flex-col text-center relative border-b-4 md:border-b-0 md:border-r-4 border-black min-h-[520px]">
          {opts?.optionAImageUrl ? (
            <img
              src={opts.optionAImageUrl}
              alt=""
              className="h-64 w-full border-b-4 border-black object-cover"
            />
          ) : null}
          <div className="flex flex-1 flex-col items-center justify-center p-8">
            <span className="text-xl font-black uppercase tracking-widest text-black/50 mb-2">Option A</span>
            <p className="display-type text-3xl sm:text-4xl font-bold mb-6">{opts?.optionA}</p>
          </div>
          <div className="px-8 pb-8">
            <span className="display-type text-8xl font-bold leading-none">{pctA}%</span>
            <p className="font-black text-2xl uppercase tracking-widest text-black/70 mt-2">{countA} votes</p>
          </div>
        </div>
        <div className="bg-[#9b51e0] text-white flex flex-col text-center relative min-h-[520px]">
          {opts?.optionBImageUrl ? (
            <img
              src={opts.optionBImageUrl}
              alt=""
              className="h-64 w-full border-b-4 border-black object-cover"
            />
          ) : null}
          <div className="flex flex-1 flex-col items-center justify-center p-8">
            <span className="text-xl font-black uppercase tracking-widest text-white/50 mb-2">Option B</span>
            <p className="display-type text-3xl sm:text-4xl font-bold mb-6">{opts?.optionB}</p>
          </div>
          <div className="px-8 pb-8">
            <span className="display-type text-8xl font-bold leading-none">{pctB}%</span>
            <p className="font-black text-2xl uppercase tracking-widest text-white/70 mt-2">{countB} votes</p>
          </div>
        </div>
      </div>
    </div>
  );
}
