"use client";

import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Keyboard, MessageCircle, Mic, MousePointer2, Send, Square, StickyNote, X } from "lucide-react";
import { buildAnnotationTranscript, getAnnotationCue } from "@/lib/annotations";
import type { Session } from "@/lib/models";
import type { ExitTicketTurnAnalysis } from "@/lib/ai/schemas";
import { CLAIM_SUPPORT_QUESTION_ROUTINE, I_USED_TO_THINK_ROUTINE, SEE_THINK_WONDER_ROUTINE, WOULD_YOU_RATHER_ROUTINE } from "@/lib/routines";
import type { AnnotationNote, RoutineStepLabel } from "@/lib/types";

type Mode = "voice" | "text";
type StudentSessionPayload = {
  session: Pick<
    Session,
    | "id"
    | "routineId"
    | "title"
    | "learningTarget"
    | "config"
    | "stimulus"
    | "exitTicketQuestion"
    | "exitTicketMaxTurns"
    | "wyrOptions"
  >;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionResultEventLike = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

function getSpeechRecognition() {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function collectSpeechTranscript(event: SpeechRecognitionResultEventLike) {
  return Array.from(event.results)
    .map((result) => result[0]?.transcript ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export default function StudentRoutine({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reflectionId = searchParams.get("reflectionId") ?? "";
  const token = searchParams.get("token") ?? "";
  const [stepIndex, setStepIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("voice");
  const [text, setText] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [recording, setRecording] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [transcripts, setTranscripts] = useState<string[]>([]);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [error, setError] = useState("");
  const [studentSession, setStudentSession] = useState<StudentSessionPayload | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const speechRecognition = useRef<SpeechRecognitionLike | null>(null);
  const speechKeepAlive = useRef(false);
  const voiceTranscriptRef = useRef("");
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  const routineDef =
    studentSession?.session.routineId === "would-you-rather"
      ? WOULD_YOU_RATHER_ROUTINE
      : studentSession?.session.routineId === "i-used-to-think"
        ? I_USED_TO_THINK_ROUTINE
        : studentSession?.session.routineId === "claim-support-question"
          ? CLAIM_SUPPORT_QUESTION_ROUTINE
          : SEE_THINK_WONDER_ROUTINE;
  const step = routineDef.steps[stepIndex] ?? routineDef.steps[0];
  const voiceMinimumSeconds =
    studentSession?.session.config.voiceMinimumSeconds ?? 5;

  useEffect(() => {
    fetch(
      `/api/student/sessions/${sessionId}?reflectionId=${encodeURIComponent(reflectionId)}&token=${encodeURIComponent(token)}`,
      { cache: "no-store" },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data) setStudentSession(data);
      });

    return () => {
      speechKeepAlive.current = false;
      if (timer.current) window.clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
      speechRecognition.current?.stop();
    };
  }, [reflectionId, sessionId, token]);

  async function startRecording() {
    setError("");
    setVoiceTranscript("");
    voiceTranscriptRef.current = "";
    const SpeechRecognition = getSpeechRecognition();

    if (SpeechRecognition) {
      speechKeepAlive.current = true;
      const SpeechRecognitionClass = SpeechRecognition;

      function startRecognitionSession() {
        if (!speechKeepAlive.current) return;
        const recognition = new SpeechRecognitionClass();
        speechRecognition.current = recognition;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";
        recognition.onresult = (event) => {
          const transcript = collectSpeechTranscript(event);
          voiceTranscriptRef.current = transcript;
          setVoiceTranscript(transcript);
        };
        // Safari terminates the session after a few seconds even with continuous=true.
        // Restart automatically so the student doesn't have to tap again.
        recognition.onend = () => {
          if (speechKeepAlive.current) {
            try { startRecognitionSession(); } catch { /* ignore */ }
          }
        };
        recognition.onerror = (event) => {
          if (event.error === "no-speech") {
            // Transient silence — let onend restart the session silently
            return;
          }
          speechKeepAlive.current = false;
          if (timer.current) window.clearInterval(timer.current);
          setRecording(false);
          if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            setError("Microphone access was blocked. Allow it in your browser settings, or type instead.");
            setMode("text");
          } else if (event.error === "audio-capture") {
            setError("No microphone found on this device. Type instead.");
            setMode("text");
          } else {
            setError("Something went wrong with the microphone. We've switched to typing.");
            setMode("text");
          }
        };
        recognition.start();
      }

      startRecognitionSession();
      setRecording(true);
      setSeconds(0);
      timer.current = window.setInterval(() => setSeconds((value) => value + 1), 1000);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      recorder.current = mediaRecorder;
      mediaRecorder.ondataavailable = (event) => chunks.current.push(event.data);
      mediaRecorder.start();
      setRecording(true);
      setSeconds(0);
      timer.current = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    } catch {
      setError("Microphone permission was blocked. You can type your thinking instead.");
      setMode("text");
    }
  }

  async function stopAndSubmitAudio() {
    if (speechRecognition.current) {
      speechKeepAlive.current = false;
      speechRecognition.current.stop();
      speechRecognition.current = null;
      if (timer.current) window.clearInterval(timer.current);
      setRecording(false);
      const transcript = voiceTranscriptRef.current.trim();
      if (transcript.length < 3) {
        setError("We did not catch enough words. Try again or switch to typing.");
        return;
      }
      await submitRoutineText(transcript);
      return;
    }

    if (!recorder.current) return;
    setSubmitting(true);
    setRecording(false);
    if (timer.current) window.clearInterval(timer.current);

    const blob = await new Promise<Blob>((resolve) => {
      const activeRecorder = recorder.current!;
      activeRecorder.onstop = () => resolve(new Blob(chunks.current, { type: "audio/webm" }));
      activeRecorder.stop();
      activeRecorder.stream.getTracks().forEach((track) => track.stop());
    });

    const formData = new FormData();
    formData.append("participantToken", token);
    formData.append("audio", blob, `step-${step.stepNumber}.webm`);
    const response = await fetch(
      `/api/reflections/${reflectionId}/steps/${step.stepNumber}/audio`,
      { method: "POST", body: formData },
    );
    await handleStepResponse(response);
  }

  async function submitText() {
    await submitRoutineText(text);
  }

  async function submitRoutineText(transcription: string) {
    setSubmitting(true);
    setError("");
    const response = await fetch(
      `/api/reflections/${reflectionId}/steps/${step.stepNumber}/text`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantToken: token, transcription }),
      },
    );
    await handleStepResponse(response, transcription);
  }

  async function submitAnnotationStep(annotations: AnnotationNote[]) {
    const transcription = buildAnnotationTranscript(step.label, annotations);
    setSubmitting(true);
    setError("");
    const response = await fetch(
      `/api/reflections/${reflectionId}/steps/${step.stepNumber}/text`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantToken: token,
          transcription,
          annotations,
        }),
      },
    );
    await handleStepResponse(response, transcription);
  }

  async function handleStepResponse(response: Response, fallbackTranscript = text) {
    const data = await response.json();
    setSubmitting(false);

    if (!response.ok) {
      setError(data.error ?? "Could not submit this step.");
      return;
    }

    setTranscripts((items) => [...items, data.transcript ?? fallbackTranscript]);
    setText("");
    setVoiceTranscript("");
    voiceTranscriptRef.current = "";

    if (stepIndex < routineDef.steps.length - 1) {
      setStepIndex((index) => index + 1);
      setSeconds(0);
      return;
    }

    const completed = await fetch(`/api/reflections/${reflectionId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantToken: token }),
    });
    const completeData = await completed.json();
    if (!completed.ok) {
      setError(completeData.error ?? "Could not finish your reflection.");
      return;
    }

    router.push(`/student/reflection/${reflectionId}/snapshot?token=${token}`);
  }

  if (!reflectionId || !token) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fdcb40] p-6 text-black">
        <div className="panel max-w-lg p-6 text-center">
          <h1 className="display-type text-4xl font-bold">Join link expired</h1>
          <p className="mt-2 text-lg font-semibold">Please scan your teacher’s QR code again.</p>
        </div>
      </main>
    );
  }

  if (!studentSession) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fdcb40] p-6 text-black">
        <div className="panel max-w-lg p-6 text-center">
          <h1 className="display-type text-4xl font-bold">Loading reflection</h1>
          <p className="mt-2 text-lg font-semibold">Getting your teacher’s question...</p>
        </div>
      </main>
    );
  }

  if (studentSession.session.routineId === "exit-ticket-conversation" || studentSession.session.routineId === "quick-spin") {
    return (
      <ExitTicketConversation
        sessionId={sessionId}
        reflectionId={reflectionId}
        token={token}
        question={studentSession.session.exitTicketQuestion ?? "What are you thinking about today's lesson?"}
        maxTurns={studentSession.session.exitTicketMaxTurns ?? 4}
      />
    );
  }

  if (studentSession.session.routineId === "would-you-rather" && stepIndex === 0) {
    const opts = studentSession.session.wyrOptions;
    return (
      <main className="min-h-screen bg-[#fdcb40] px-5 py-6 text-black flex flex-col items-center justify-center" data-session-id={sessionId}>
        <div className="max-w-5xl w-full grid gap-6 md:grid-cols-2">
          <button 
            disabled={submitting}
            onClick={() => submitRoutineText(`Option A: ${opts?.optionA}`)}
            className="focus-ring group overflow-hidden rounded-[3rem] border-4 border-black bg-white hover:bg-[#04c6c5] transition-all hover:-translate-y-2 text-left disabled:opacity-50 min-h-[420px] flex flex-col shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]"
          >
            {opts?.optionAImageUrl ? (
              <img
                src={opts.optionAImageUrl}
                alt=""
                className="h-56 w-full border-b-4 border-black object-cover"
              />
            ) : null}
            <div className="flex flex-1 flex-col justify-center p-8">
              <span className="text-xl font-black uppercase tracking-widest text-slate-400 group-hover:text-black/50 mb-4 block">Option A</span>
              <p className="display-type text-3xl sm:text-4xl font-bold leading-tight group-hover:text-black">{opts?.optionA}</p>
            </div>
          </button>
          
          <button 
            disabled={submitting}
            onClick={() => submitRoutineText(`Option B: ${opts?.optionB}`)}
            className="focus-ring group overflow-hidden rounded-[3rem] border-4 border-black bg-white hover:bg-[#9b51e0] transition-all hover:-translate-y-2 text-left disabled:opacity-50 min-h-[420px] flex flex-col shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] hover:text-white"
          >
            {opts?.optionBImageUrl ? (
              <img
                src={opts.optionBImageUrl}
                alt=""
                className="h-56 w-full border-b-4 border-black object-cover"
              />
            ) : null}
            <div className="flex flex-1 flex-col justify-center p-8">
              <span className="text-xl font-black uppercase tracking-widest text-slate-400 group-hover:text-white/50 mb-4 block">Option B</span>
              <p className="display-type text-3xl sm:text-4xl font-bold leading-tight">{opts?.optionB}</p>
            </div>
          </button>
        </div>
        {submitting && <p className="mt-8 text-2xl font-black text-black animate-pulse">Locking in your choice...</p>}
      </main>
    );
  }

  const promptText =
    studentSession.session.routineId === "would-you-rather" && stepIndex === 1
      ? `You chose ${transcripts[0]?.split(": ")[1] ?? "that option"}. Explain your reasoning.`
      : step.prompt;
  const isIUTT = studentSession.session.routineId === "i-used-to-think";
  const usesAnnotationMode =
    studentSession.session.routineId === "see-think-wonder" &&
    studentSession.session.config.annotationMode &&
    studentSession.session.stimulus.kind === "image" &&
    Boolean(studentSession.session.stimulus.value);

  return (
    <main className="min-h-screen bg-[#fdcb40] px-5 py-6 text-black" data-session-id={sessionId}>
      <section className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_320px]">
        <div className="panel p-6 md:p-10">
          <p className={`inline-flex rounded-full border-2 border-black px-4 py-2 text-sm font-black uppercase tracking-[0.08em] ${
            isIUTT
              ? stepIndex === 0
                ? "bg-[#fff2b7]"
                : "bg-[#00b351] text-white"
              : "bg-[#04c6c5]"
          }`}>
            {isIUTT
              ? stepIndex === 0
                ? "Before this lesson"
                : "After this lesson"
              : `Step ${step.stepNumber} of ${routineDef.steps.length}`}
          </p>
          <h1 className="display-type mt-5 text-[3rem] font-bold leading-[0.85] sm:text-[4rem] md:text-[4.5rem]">
            {promptText}
          </h1>
          <p className="mt-6 max-w-2xl text-2xl font-semibold leading-8">
            {step.studentCue}
          </p>

          {isIUTT && stepIndex === 1 && transcripts[0] ? (
            <div className="mt-6 rounded-[24px] border-2 border-black bg-[#fff2b7] p-5">
              <p className="text-xs font-black uppercase tracking-[0.08em] text-black/50">
                You used to think
              </p>
              <p className="mt-2 text-xl font-bold leading-7">
                &ldquo;{transcripts[0]}&rdquo;
              </p>
            </div>
          ) : null}

          {usesAnnotationMode ? (
            <AnnotationWorkspace
              key={step.label}
              imageUrl={studentSession.session.stimulus.value}
              stepLabel={step.label}
              submitting={submitting}
              onSubmit={submitAnnotationStep}
            />
          ) : (
            <>
              <StimulusBlock stimulus={studentSession.session.stimulus} />

              <div className="mt-8 flex gap-2">
                <button
                  onClick={() => setMode("voice")}
                  className={`focus-ring inline-flex items-center gap-2 rounded-full border-2 border-black px-5 py-3 font-black ${
                    mode === "voice" ? "bg-[#006cff] text-white" : "bg-white"
                  }`}
                >
                  <Mic size={18} />
                  Voice
                </button>
                <button
                  onClick={() => setMode("text")}
                  className={`focus-ring inline-flex items-center gap-2 rounded-full border-2 border-black px-5 py-3 font-black ${
                    mode === "text" ? "bg-[#006cff] text-white" : "bg-white"
                  }`}
                >
                  <Keyboard size={18} />
                  Type
                </button>
              </div>

              {mode === "voice" ? (
                <div className="mt-8 rounded-[24px] border-2 border-black bg-[#fff2b7] p-6 text-center">
                  <button
                    onClick={recording ? stopAndSubmitAudio : startRecording}
                    disabled={submitting || (recording && seconds < voiceMinimumSeconds)}
                    className={`focus-ring mx-auto grid size-40 place-items-center rounded-full border-2 border-black text-white transition hover:-translate-y-0.5 ${
                      recording ? "bg-[#fd4401]" : "bg-[#006cff]"
                    } disabled:opacity-50`}
                  >
                    {recording ? <Square size={42} /> : <Mic size={48} />}
                  </button>
                  <p className="display-type mt-5 text-5xl font-bold">{seconds}s</p>
                  <p className="mt-2 text-lg font-bold">
                    {recording
                      ? seconds < voiceMinimumSeconds
                        ? `Keep going for at least ${voiceMinimumSeconds} seconds.`
                        : "You can stop when your thought feels complete."
                      : voiceMinimumSeconds > 0
                        ? `Tap the microphone and speak for at least ${voiceMinimumSeconds} seconds.`
                        : "Tap the microphone and speak your thinking."}
                  </p>
                  {voiceTranscript ? (
                    <div className="mt-5 rounded-[20px] border-2 border-black bg-white p-4 text-left">
                      <p className="text-xs font-black uppercase tracking-[0.08em]">
                        We heard
                      </p>
                      <p className="mt-2 text-lg font-bold leading-7">{voiceTranscript}</p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-8">
                  <textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    className="focus-ring min-h-56 w-full rounded-[24px] border-2 border-black bg-white p-5 text-xl font-semibold leading-8"
                    placeholder="Type your thinking here..."
                  />
                  <button
                    onClick={submitText}
                    disabled={submitting || text.trim().length < 3}
                    className="focus-ring mt-4 inline-flex items-center justify-center gap-2 rounded-full border-2 border-black bg-[#fd4401] px-7 py-4 font-bold text-white transition hover:-translate-y-0.5 disabled:opacity-50"
                  >
                    Submit step
                    <Send size={18} />
                  </button>
                </div>
              )}
            </>
          )}
          {submitting ? <p className="mt-4 font-black text-[#006cff]">Making your thinking visible...</p> : null}
          {error ? <p className="mt-4 font-black text-[#fd4401]">{error}</p> : null}
        </div>

        <aside className="panel p-5">
          <h2 className="display-type text-3xl font-bold">Your routine</h2>
          <div className="mt-4 space-y-3">
            {routineDef.steps.map((item, index) => (
              <div
                key={item.label}
                className={`rounded-[20px] border-2 p-4 ${
                  index === stepIndex
                    ? "border-black bg-[#04c6c5]"
                    : index < stepIndex
                      ? "border-black bg-[#00b351]"
                      : "border-black bg-white"
                }`}
              >
                <p className="font-black">{item.label}</p>
                <p className="mt-1 text-sm font-semibold">
                  {transcripts[index] ?? item.prompt}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-[20px] border-2 border-black bg-[#fff2b7] p-4 text-sm font-bold leading-6">
            <ArrowRight className="mb-2 text-[#fd4401]" size={18} />
            Your teacher sees patterns from the class, not a grade.
          </div>
        </aside>
      </section>
    </main>
  );
}

function StimulusBlock({
  stimulus,
}: {
  stimulus: { kind: "image" | "text" | "link" | "none"; value: string };
}) {
  if (stimulus.kind === "none" || !stimulus.value) return null;

  if (stimulus.kind === "image") {
    return (
      <div className="mt-8 rounded-[24px] border-2 border-black bg-white p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={stimulus.value}
          alt="Reflection stimulus"
          className="max-h-[420px] w-full rounded-[18px] object-cover"
        />
      </div>
    );
  }

  if (stimulus.kind === "link") {
    return (
      <a
        href={stimulus.value}
        target="_blank"
        rel="noreferrer"
        className="focus-ring mt-8 block rounded-[24px] border-2 border-black bg-[#fff2b7] p-5 text-xl font-black underline"
      >
        Open stimulus link
      </a>
    );
  }

  return (
    <div className="mt-8 rounded-[24px] border-2 border-black bg-[#fff2b7] p-5">
      <p className="text-sm font-black uppercase tracking-[0.08em]">Stimulus</p>
      <p className="mt-2 text-xl font-bold leading-8">{stimulus.value}</p>
    </div>
  );
}

function AnnotationWorkspace({
  imageUrl,
  stepLabel,
  submitting,
  onSubmit,
}: {
  imageUrl: string;
  stepLabel: RoutineStepLabel;
  submitting: boolean;
  onSubmit: (annotations: AnnotationNote[]) => Promise<void>;
}) {
  const [annotations, setAnnotations] = useState<AnnotationNote[]>([]);
  const [draftPoint, setDraftPoint] = useState<{ x: number; y: number } | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftMode, setDraftMode] = useState<Mode>("text");
  const [listening, setListening] = useState(false);
  const annotationsRef = useRef<AnnotationNote[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  function choosePoint(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    setDraftPoint({
      x: Math.min(100, Math.max(0, x)),
      y: Math.min(100, Math.max(0, y)),
    });
    setDraftText("");
    setDraftMode("text");
  }

  function chooseCenterPoint() {
    setDraftPoint({ x: 50, y: 50 });
    setDraftText("");
    setDraftMode("text");
  }

  function addNote() {
    if (!draftPoint || draftText.trim().length < 2) return;
    const nextNote = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${annotationsRef.current.length}`,
      x: Math.round(draftPoint.x * 10) / 10,
      y: Math.round(draftPoint.y * 10) / 10,
      text: draftText.trim(),
      mode: draftMode,
    };
    const nextAnnotations = [...annotationsRef.current, nextNote];
    annotationsRef.current = nextAnnotations;
    setAnnotations(nextAnnotations);
    setDraftPoint(null);
    setDraftText("");
  }

  function startDraftVoice() {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      setDraftMode("text");
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => setDraftText(collectSpeechTranscript(event));
    recognition.onend = () => setListening(false);
    recognition.start();
    setDraftMode("voice");
    setListening(true);
  }

  function stopDraftVoice() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  return (
    <div className="mt-8 grid gap-5">
      <div className="rounded-[24px] border-2 border-black bg-[#fff2b7] p-4">
        <p className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.08em]">
          <MousePointer2 size={18} />
          Annotation mode
        </p>
        <p className="mt-2 text-lg font-black leading-7">
          Tap the image, add a sticky note, then submit your {stepLabel} notes.
        </p>
      </div>

      <div
        className="relative overflow-hidden rounded-[24px] border-2 border-black bg-white"
        onClick={choosePoint}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            chooseCenterPoint();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={`Add a ${stepLabel} sticky note to the image`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="Reflection stimulus" className="w-full object-cover" />
        {annotations.map((annotation, index) => (
          <button
            key={annotation.id}
            type="button"
            onClick={(event) => event.stopPropagation()}
            className="absolute grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-black bg-[#fdcb40] text-sm font-black"
            style={{ left: `${annotation.x}%`, top: `${annotation.y}%` }}
            title={annotation.text}
          >
            {index + 1}
          </button>
        ))}
        {draftPoint ? (
          <div
            className="absolute grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-black bg-[#fd4401] text-sm font-black text-white"
            style={{ left: `${draftPoint.x}%`, top: `${draftPoint.y}%` }}
          >
            +
          </div>
        ) : null}
      </div>

      {draftPoint ? (
        <div className="rounded-[24px] border-2 border-black bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.08em]">
                <StickyNote size={18} />
                Sticky note
              </p>
              <p className="mt-2 text-lg font-black leading-7">
                {getAnnotationCue(stepLabel)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDraftPoint(null)}
              className="focus-ring grid size-10 place-items-center rounded-full border-2 border-black bg-white"
              aria-label="Cancel note"
            >
              <X size={18} />
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDraftMode("text")}
              className={`focus-ring inline-flex items-center gap-2 rounded-full border-2 border-black px-5 py-3 font-black ${
                draftMode === "text" ? "bg-[#006cff] text-white" : "bg-white"
              }`}
            >
              <Keyboard size={18} />
              Type
            </button>
            <button
              type="button"
              onClick={listening ? stopDraftVoice : startDraftVoice}
              className={`focus-ring inline-flex items-center gap-2 rounded-full border-2 border-black px-5 py-3 font-black ${
                draftMode === "voice" ? "bg-[#006cff] text-white" : "bg-white"
              }`}
            >
              <Mic size={18} />
              {listening ? "Stop voice" : "Voice"}
            </button>
          </div>

          <textarea
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            className="focus-ring mt-4 min-h-28 w-full rounded-[20px] border-2 border-black bg-[#fff2b7] p-4 text-lg font-black leading-7"
            placeholder="Add your sticky note here..."
          />
          <button
            type="button"
            onClick={addNote}
            disabled={draftText.trim().length < 2}
            className="focus-ring mt-3 rounded-full border-2 border-black bg-[#fd4401] px-6 py-3 font-black text-white disabled:opacity-50"
          >
            Save sticky note
          </button>
        </div>
      ) : null}

      <div className="grid gap-3">
        {annotations.map((annotation, index) => (
          <div
            key={annotation.id}
            className="rounded-[20px] border-2 border-black bg-white p-4"
          >
            <p className="text-xs font-black uppercase tracking-[0.08em]">
              Note {index + 1} · {annotation.mode}
            </p>
            <p className="mt-2 text-lg font-black leading-7">{annotation.text}</p>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onSubmit(annotationsRef.current)}
        disabled={submitting || annotations.length === 0}
        className="focus-ring inline-flex items-center justify-center gap-2 rounded-full border-2 border-black bg-[#fd4401] px-7 py-4 font-black text-white disabled:opacity-50"
      >
        {submitting ? "Submitting notes..." : `Submit ${stepLabel} notes`}
        <Send size={18} />
      </button>
    </div>
  );
}

function ExitTicketConversation({
  sessionId,
  reflectionId,
  token,
  question,
  maxTurns,
}: {
  sessionId: string;
  reflectionId: string;
  token: string;
  question: string;
  maxTurns: number;
}) {
  const router = useRouter();
  const [turnIndex, setTurnIndex] = useState(0);
  const [prompt, setPrompt] = useState(question);
  const [mode, setMode] = useState<Mode>("voice");
  const [text, setText] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [listening, setListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [lastAnalysis, setLastAnalysis] = useState<ExitTicketTurnAnalysis | null>(null);
  const [conversation, setConversation] = useState<
    Array<{ prompt: string; response: string; analysis: ExitTicketTurnAnalysis }>
  >([]);
  const speechRecognition = useRef<SpeechRecognitionLike | null>(null);
  const voiceTranscriptRef = useRef("");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      speechRecognition.current?.stop();
      if (timer.current) window.clearInterval(timer.current);
    };
  }, []);

  function startVoiceTurn() {
    setError("");
    setVoiceTranscript("");
    voiceTranscriptRef.current = "";
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      setError("Voice is not available in this browser. Type your response instead.");
      setMode("text");
      return;
    }

    const recognition = new SpeechRecognition();
    speechRecognition.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const transcript = collectSpeechTranscript(event);
      voiceTranscriptRef.current = transcript;
      setVoiceTranscript(transcript);
    };
    recognition.onerror = (event) => {
      if (timer.current) window.clearInterval(timer.current);
      setListening(false);
      if (event.error === "no-speech") {
        setError("We couldn't hear anything. We've switched to typing — you can tap Voice to try again.");
        setMode("text");
      } else if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone access was blocked. Allow it in your browser settings, or type instead.");
        setMode("text");
      } else if (event.error === "audio-capture") {
        setError("No microphone found on this device. Type instead.");
        setMode("text");
      } else {
        setError("Something went wrong with the microphone. We've switched to typing.");
        setMode("text");
      }
    };
    recognition.start();
    setListening(true);
    setSeconds(0);
    timer.current = window.setInterval(() => setSeconds((value) => value + 1), 1000);
  }

  async function stopVoiceTurn() {
    speechRecognition.current?.stop();
    speechRecognition.current = null;
    if (timer.current) window.clearInterval(timer.current);
    setListening(false);

    const transcript = voiceTranscriptRef.current.trim();
    if (transcript.length < 3) {
      setError("We did not catch enough words. Try again or switch to typing.");
      return;
    }

    await submitTurn(transcript);
  }

  async function submitTurn(responseText = text) {
    setSubmitting(true);
    setError("");
    const response = await fetch(`/api/reflections/${reflectionId}/exit-ticket/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantToken: token,
        prompt,
        response: responseText,
        turnIndex,
      }),
    });
    const data = await response.json();
    setSubmitting(false);

    if (!response.ok) {
      setError(data.error ?? "Could not submit your reflection.");
      return;
    }

    setLastAnalysis(data.analysis);
    setConversation((items) => [
      ...items,
      { prompt, response: responseText, analysis: data.analysis },
    ]);
    setText("");
    setVoiceTranscript("");
    voiceTranscriptRef.current = "";

    if (data.complete) {
      router.push(`/student/reflection/${reflectionId}/snapshot?token=${token}`);
      return;
    }

    setPrompt(data.analysis.followUpQuestion ?? question);
    setTurnIndex((index) => index + 1);
  }

  return (
    <main className="min-h-screen bg-[#fdcb40] px-4 py-4 text-black sm:px-5 sm:py-6" data-session-id={sessionId}>
      <section className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="panel p-4 md:p-6">
          <div className="sticky top-3 z-20 rounded-[22px] border-2 border-black bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="inline-flex rounded-full border-2 border-black bg-[#04c6c5] px-4 py-2 text-xs font-black uppercase tracking-[0.08em]">
                Turn {turnIndex + 1} of {maxTurns}
              </p>
              <p className="text-xs font-black uppercase tracking-[0.08em] text-black/50">
                Current question
              </p>
            </div>
            <h1 className="display-type mt-3 text-[1.55rem] font-bold leading-[1.08] sm:text-[1.9rem] md:text-[2.15rem]">
              {prompt}
            </h1>
          </div>

          {lastAnalysis ? (
            <div className="mt-4 rounded-[22px] border-2 border-black bg-[#fff2b7] p-4">
              <p className="text-sm font-black uppercase tracking-[0.08em]">
                ReflectAI noticed
              </p>
              <p className="mt-2 text-lg font-black leading-6">
                “{lastAnalysis.directQuote}”
              </p>
              <div className="mt-4 flex items-center gap-2">
                {[1, 2, 3, 4].map((rating) => (
                  <div
                    key={rating}
                    className={`h-4 flex-1 rounded-full border-2 border-black ${
                      rating <= lastAnalysis.rating ? "bg-[#006cff]" : "bg-white"
                    }`}
                  />
                ))}
                <span className="ml-2 text-sm font-black uppercase">
                  {lastAnalysis.ratingLabel}
                </span>
              </div>
            </div>
          ) : null}

          <div className="mt-5 flex gap-2">
            <button
              onClick={() => setMode("voice")}
              className={`focus-ring inline-flex items-center gap-2 rounded-full border-2 border-black px-5 py-3 font-black ${
                mode === "voice" ? "bg-[#006cff] text-white" : "bg-white"
              }`}
            >
              <Mic size={18} />
              Voice
            </button>
            <button
              onClick={() => setMode("text")}
              className={`focus-ring inline-flex items-center gap-2 rounded-full border-2 border-black px-5 py-3 font-black ${
                mode === "text" ? "bg-[#006cff] text-white" : "bg-white"
              }`}
            >
              <Keyboard size={18} />
              Type
            </button>
          </div>

          <div className="mt-4">
            {mode === "voice" ? (
              <div className="rounded-[24px] border-2 border-black bg-[#fff2b7] p-5 text-center">
                <button
                  onClick={listening ? stopVoiceTurn : startVoiceTurn}
                  disabled={submitting}
                  className={`focus-ring mx-auto grid size-32 place-items-center rounded-full border-2 border-black text-white transition hover:-translate-y-0.5 ${
                    listening ? "bg-[#fd4401]" : "bg-[#006cff]"
                  } disabled:opacity-50`}
                >
                  {listening ? <Square size={36} /> : <Mic size={42} />}
                </button>
                <p className="display-type mt-5 text-5xl font-bold">{seconds}s</p>
                <p className="mt-2 text-lg font-bold">
                  {listening
                    ? "Stop when your thought feels complete."
                    : "Tap the microphone and answer in your own words."}
                </p>
                {voiceTranscript ? (
                  <div className="mt-5 rounded-[20px] border-2 border-black bg-white p-4 text-left">
                    <p className="text-xs font-black uppercase tracking-[0.08em]">
                      We heard
                    </p>
                    <p className="mt-2 text-lg font-bold leading-7">
                      {voiceTranscript}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  className="focus-ring min-h-40 w-full rounded-[24px] border-2 border-black bg-white p-5 text-lg font-semibold leading-7"
                  placeholder="Type your thinking here..."
                />
                <button
                  onClick={() => submitTurn()}
                  disabled={submitting || text.trim().length < 3}
                  className="focus-ring mt-4 inline-flex items-center justify-center gap-2 rounded-full border-2 border-black bg-[#fd4401] px-7 py-4 font-bold text-white transition hover:-translate-y-0.5 disabled:opacity-50"
                >
                  {submitting ? "Thinking..." : turnIndex >= maxTurns - 1 ? "Finish" : "Send"}
                  <Send size={18} />
                </button>
              </>
            )}
          </div>
          {error ? <p className="mt-4 font-black text-[#fd4401]">{error}</p> : null}
        </div>

        <aside className="panel p-5">
          <h2 className="display-type flex items-center gap-2 text-3xl font-bold">
            <MessageCircle size={26} />
            Your conversation
          </h2>
          <div className="mt-4 space-y-3">
            {conversation.length === 0 ? (
              <p className="rounded-[20px] border-2 border-black bg-[#fff2b7] p-4 text-sm font-bold leading-6">
                Answer the first question. ReflectAI will ask a follow-up based
                on your own words.
              </p>
            ) : (
              conversation.map((turn, index) => (
                <div
                  key={`${turn.prompt}-${index}`}
                  className="rounded-[20px] border-2 border-black bg-white p-4"
                >
                  <p className="text-xs font-black uppercase tracking-[0.08em]">
                    Turn {index + 1} · {turn.analysis.ratingLabel}
                  </p>
                  <p className="mt-2 text-sm font-bold leading-6">“{turn.analysis.directQuote}”</p>
                </div>
              ))
            )}
          </div>
          <div className="mt-5 rounded-[20px] border-2 border-black bg-[#04c6c5] p-4 text-sm font-bold leading-6">
            Your teacher sees your quote, rating, and follow-up path.
          </div>
        </aside>
      </section>
    </main>
  );
}
