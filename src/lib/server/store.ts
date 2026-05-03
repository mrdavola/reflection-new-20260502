import { randomUUID } from "node:crypto";
import { generateJoinCode, normalizeJoinCode } from "@/lib/codes";
import type { DashboardPayload, Participant, Reflection, Session, Stimulus } from "@/lib/models";
import { DEFAULT_SESSION_CONFIG } from "@/lib/routines";
import { buildThinkingMap } from "@/lib/thinking-map";
import type { ReflectionStep, SafetyAlert, SessionConfig } from "@/lib/types";
import { getBaseUrl } from "./env";
import { getAdminDb } from "./firebase-admin";

type CreateSessionInput = {
  title?: string;
  learningTarget?: string;
  gradeBand?: string;
  routineId?: Session["routineId"];
  exitTicketQuestion?: string;
  exitTicketContext?: string;
  exitTicketMaxTurns?: number;
  wyrOptions?: Session["wyrOptions"];
  config?: Partial<SessionConfig>;
  stimulus?: Stimulus;
};

type PilotStoreGlobal = {
  sessions: Map<string, Session>;
  participants: Map<string, Participant>;
  reflections: Map<string, Reflection>;
};

const pilotStore = globalThis as typeof globalThis & {
  __reflectAiPilotStore?: PilotStoreGlobal;
};

pilotStore.__reflectAiPilotStore ??= {
  sessions: new Map<string, Session>(),
  participants: new Map<string, Participant>(),
  reflections: new Map<string, Reflection>(),
};

const { sessions, participants, reflections } = pilotStore.__reflectAiPilotStore;

function getDbOrThrowForProd() {
  const db = getAdminDb();
  if (!db && process.env.NODE_ENV === "production") {
    throw new Error("Firestore is required in production pilot mode.");
  }
  return db;
}

export async function createSession(input: CreateSessionInput) {
  const db = getDbOrThrowForProd();
  const id = `session_${randomUUID()}`;
  let joinCode = generateJoinCode();

  while ([...sessions.values()].some((session) => session.joinCode === joinCode)) {
    joinCode = generateJoinCode();
  }

  const session: Session = {
    id,
    teacherId: "pilot_teacher",
    routineId: input.routineId ?? "see-think-wonder",
    title:
      input.title?.trim() ||
      (input.routineId === "exit-ticket-conversation"
        ? "Exit Ticket Reflection"
        : input.routineId === "would-you-rather"
          ? "Would You Rather"
          : input.routineId === "quick-spin"
            ? "Quick Spin Reflection"
            : input.routineId === "i-used-to-think"
              ? "I Used to Think… Now I Think"
              : input.routineId === "claim-support-question"
                ? "Claim Support Question"
                : "See Think Wonder Reflection"),
    learningTarget: input.learningTarget?.trim() || "",
    gradeBand: input.gradeBand ?? "",
    exitTicketQuestion: input.exitTicketQuestion?.trim() ?? "",
    exitTicketContext: input.exitTicketContext?.trim() ?? "",
    exitTicketMaxTurns: input.exitTicketMaxTurns ?? 4,
    wyrOptions: input.wyrOptions,
    stimulus: input.stimulus ?? { kind: "none", value: "" },
    config: { ...DEFAULT_SESSION_CONFIG, ...input.config },
    joinCode,
    joinLink: `${getBaseUrl()}/join/${joinCode}`,
    status: "active",
    joinedCount: 0,
    reflectingCount: 0,
    doneCount: 0,
    alertCount: 0,
    summaryStatus: "idle",
    classSummary: null,
    classThinkingMap: { see: [], think: [], wonder: [] },
    createdAt: new Date().toISOString(),
  };

  if (db) {
    // JSON round-trip strips undefined keys that Firestore rejects
    await db.collection("sessions").doc(id).set(JSON.parse(JSON.stringify(session)));
    return session;
  }

  sessions.set(id, session);
  return session;
}

export async function listSessions() {
  const db = getDbOrThrowForProd();
  if (db) {
    const snapshot = await db
      .collection("sessions")
      .orderBy("createdAt", "desc")
      .get();
    return snapshot.docs.map((doc) => doc.data() as Session);
  }

  return [...sessions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getSession(sessionId: string) {
  const db = getDbOrThrowForProd();
  if (db) {
    const doc = await db.collection("sessions").doc(sessionId).get();
    return doc.exists ? (doc.data() as Session) : null;
  }

  return sessions.get(sessionId) ?? null;
}

export async function getSessionByJoinCode(joinCode: string) {
  const normalized = normalizeJoinCode(joinCode);
  const db = getDbOrThrowForProd();
  if (db) {
    const snapshot = await db
      .collection("sessions")
      .where("joinCode", "==", normalized)
      .limit(1)
      .get();
    return snapshot.empty ? null : (snapshot.docs[0].data() as Session);
  }

  return [...sessions.values()].find((session) => session.joinCode === normalized) ?? null;
}

export async function updateSession(sessionId: string, updates: Partial<Session>) {
  const db = getDbOrThrowForProd();
  if (db) {
    const session = await getSession(sessionId);
    if (!session) throw new Error("Session not found.");
    const updated: Session = { ...session, ...updates };
    await db.collection("sessions").doc(sessionId).set(updated);
    return updated;
  }

  const session = sessions.get(sessionId);
  if (!session) throw new Error("Session not found.");
  Object.assign(session, updates);
  return session;
}

export async function joinSession(joinCode: string, displayName: string) {
  const session = await getSessionByJoinCode(joinCode);

  if (!session || session.status !== "active") {
    throw new Error("Session is not available.");
  }

  const participant: Participant = {
    id: `student_${randomUUID()}`,
    sessionId: session.id,
    displayName: normalizeDisplayName(displayName),
    participantToken: randomUUID(),
    status: "joined",
    createdAt: new Date().toISOString(),
  };

  const reflection: Reflection = {
    id: `reflection_${randomUUID()}`,
    sessionId: session.id,
    participantId: participant.id,
    displayName: participant.displayName,
    steps: [],
    overallAnalysis: null,
    studentFeedback: null,
    contentAlerts: [],
    teacherNote: null,
    audioExpiresAt: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };

  const db = getDbOrThrowForProd();
  if (db) {
    await db
      .collection("sessions")
      .doc(session.id)
      .collection("participants")
      .doc(participant.id)
      .set(participant);
    await db
      .collection("sessions")
      .doc(session.id)
      .collection("reflections")
      .doc(reflection.id)
      .set(reflection);
    await recalculateFirestoreSession(session.id);
    return { session: (await getSession(session.id))!, participant, reflection };
  }

  participants.set(participant.id, participant);
  reflections.set(reflection.id, reflection);
  recalculateSession(session.id);

  return { session, participant, reflection };
}

export async function getReflection(reflectionId: string) {
  const db = getDbOrThrowForProd();
  if (db) {
    const sessionsSnapshot = await db.collection("sessions").get();
    for (const sessionDoc of sessionsSnapshot.docs) {
      const reflectionDoc = await sessionDoc.ref
        .collection("reflections")
        .doc(reflectionId)
        .get();
      if (reflectionDoc.exists) return reflectionDoc.data() as Reflection;
    }
    return null;
  }

  return reflections.get(reflectionId) ?? null;
}

export async function getParticipantByToken(sessionId: string, token: string) {
  const db = getDbOrThrowForProd();
  if (db) {
    const snapshot = await db
      .collection("sessions")
      .doc(sessionId)
      .collection("participants")
      .where("participantToken", "==", token)
      .limit(1)
      .get();
    return snapshot.empty ? null : (snapshot.docs[0].data() as Participant);
  }

  return (
    [...participants.values()].find(
      (participant) =>
        participant.sessionId === sessionId && participant.participantToken === token,
    ) ?? null
  );
}

export async function submitReflectionStep(input: {
  reflectionId: string;
  participantToken: string;
  step: ReflectionStep;
  alerts: SafetyAlert[];
  audioExpiresAt?: string | null;
}) {
  const db = getDbOrThrowForProd();
  if (db) {
    const reflection = await getReflection(input.reflectionId);
    if (!reflection) throw new Error("Reflection not found.");

    const participantRef = db
      .collection("sessions")
      .doc(reflection.sessionId)
      .collection("participants")
      .doc(reflection.participantId);
    const participantDoc = await participantRef.get();
    const participant = participantDoc.data() as Participant | undefined;
    if (!participant || participant.participantToken !== input.participantToken) {
      throw new Error("Invalid participant token.");
    }

    const steps = upsertStep(reflection.steps, input.step);
    const contentAlerts = dedupeAlerts([...reflection.contentAlerts, ...input.alerts]);
    const updated: Reflection = {
      ...reflection,
      steps,
      contentAlerts,
      audioExpiresAt: input.audioExpiresAt ?? reflection.audioExpiresAt,
    };

    await participantRef.set({ ...participant, status: "reflecting" });
    await db
      .collection("sessions")
      .doc(reflection.sessionId)
      .collection("reflections")
      .doc(reflection.id)
      .set(updated);
    await writeAlerts(reflection.sessionId, reflection.id, reflection.displayName, contentAlerts);
    await recalculateFirestoreSession(reflection.sessionId);

    return updated;
  }

  const reflection = reflections.get(input.reflectionId);
  if (!reflection) throw new Error("Reflection not found.");

  const participant = participants.get(reflection.participantId);
  if (!participant || participant.participantToken !== input.participantToken) {
    throw new Error("Invalid participant token.");
  }

  participant.status = "reflecting";
  reflection.steps = upsertStep(reflection.steps, input.step);

  reflection.contentAlerts = dedupeAlerts([
    ...reflection.contentAlerts,
    ...input.alerts,
  ]);
  reflection.audioExpiresAt = input.audioExpiresAt ?? reflection.audioExpiresAt;
  recalculateSession(reflection.sessionId);

  return reflection;
}

export async function completeReflection(input: {
  reflectionId: string;
  participantToken: string;
  analysis: NonNullable<Reflection["overallAnalysis"]>;
  feedback: NonNullable<Reflection["studentFeedback"]>;
}) {
  const db = getDbOrThrowForProd();
  if (db) {
    const reflection = await getReflection(input.reflectionId);
    if (!reflection) throw new Error("Reflection not found.");

    const participantRef = db
      .collection("sessions")
      .doc(reflection.sessionId)
      .collection("participants")
      .doc(reflection.participantId);
    const participantDoc = await participantRef.get();
    const participant = participantDoc.data() as Participant | undefined;
    if (!participant || participant.participantToken !== input.participantToken) {
      throw new Error("Invalid participant token.");
    }

    const updated: Reflection = {
      ...reflection,
      overallAnalysis: input.analysis,
      studentFeedback: input.feedback,
      completedAt: new Date().toISOString(),
    };

    await participantRef.set({ ...participant, status: "done" });
    await db
      .collection("sessions")
      .doc(reflection.sessionId)
      .collection("reflections")
      .doc(reflection.id)
      .set(updated);
    await recalculateFirestoreSession(reflection.sessionId);
    return updated;
  }

  const reflection = reflections.get(input.reflectionId);
  if (!reflection) throw new Error("Reflection not found.");

  const participant = participants.get(reflection.participantId);
  if (!participant || participant.participantToken !== input.participantToken) {
    throw new Error("Invalid participant token.");
  }

  participant.status = "done";
  reflection.overallAnalysis = input.analysis;
  reflection.studentFeedback = input.feedback;
  reflection.completedAt = new Date().toISOString();
  recalculateSession(reflection.sessionId);

  return reflection;
}

export async function getDashboard(sessionId: string): Promise<DashboardPayload | null> {
  const db = getDbOrThrowForProd();
  if (db) {
    const session = await getSession(sessionId);
    if (!session) return null;
    const [participantsSnapshot, reflectionsSnapshot, alertsSnapshot] = await Promise.all([
      db.collection("sessions").doc(sessionId).collection("participants").get(),
      db.collection("sessions").doc(sessionId).collection("reflections").get(),
      db.collection("sessions").doc(sessionId).collection("alerts").get(),
    ]);
    return {
      session,
      participants: participantsSnapshot.docs.map((doc) => doc.data() as Participant),
      reflections: reflectionsSnapshot.docs.map((doc) => doc.data() as Reflection),
      alerts: alertsSnapshot.docs.map(
        (doc) =>
          doc.data() as SafetyAlert & {
            id: string;
            reflectionId: string;
            displayName: string;
          },
      ),
    };
  }

  const session = sessions.get(sessionId);
  if (!session) return null;

  const sessionParticipants = [...participants.values()].filter(
    (participant) => participant.sessionId === sessionId,
  );
  const sessionReflections = [...reflections.values()].filter(
    (reflection) => reflection.sessionId === sessionId,
  );
  const alerts = sessionReflections.flatMap((reflection) =>
    reflection.contentAlerts.map((alert, index) => ({
      ...alert,
      id: `${reflection.id}_${index}`,
      reflectionId: reflection.id,
      displayName: reflection.displayName,
    })),
  );

  return { session, participants: sessionParticipants, reflections: sessionReflections, alerts };
}

export async function saveClassSummary(sessionId: string, summary: string) {
  const db = getDbOrThrowForProd();
  if (db) {
    const session = await getSession(sessionId);
    if (!session) throw new Error("Session not found.");
    const updated: Session = { ...session, classSummary: summary, summaryStatus: "generated" };
    await db.collection("sessions").doc(sessionId).set(updated);
    return updated;
  }

  const session = sessions.get(sessionId);
  if (!session) throw new Error("Session not found.");

  session.classSummary = summary;
  session.summaryStatus = "generated";
  return session;
}

export async function seedDemoSession() {
  const db = getDbOrThrowForProd();
  if (db) {
    const snapshot = await db
      .collection("sessions")
      .where("title", "==", "Demo: See Think Wonder")
      .limit(1)
      .get();
    if (!snapshot.empty) {
      return snapshot.docs[0].data() as Session;
    }
  }

  if ([...sessions.values()].some((session) => session.title.includes("Demo"))) {
    return [...sessions.values()].find((session) => session.title.includes("Demo"))!;
  }

  const session = await createSession({
    title: "Demo: See Think Wonder",
    learningTarget: "Students will observe a historical photo and explain their thinking with evidence.",
    stimulus: {
      kind: "text",
      value:
        "A black-and-white classroom photo shows children gathered around a table with a map, notebooks, and a window open to a rainy street.",
    },
  });

  const demoStudents = [
    ["Maya", "I see students leaning over a map.", "I think they are trying to solve a problem together.", "I wonder why the map matters to the rainy street outside."],
    ["Jordan", "I see notebooks and a big map.", "They might be planning a route because the weather changed.", "I wonder if they have enough information."],
    ["Sam", "I see a window and people at a table.", "I think the window shows the setting.", "I wonder what happened before this picture."],
  ];

  for (const [name, see, think, wonder] of demoStudents) {
    const joined = await joinSession(session.joinCode, name);
    const stepData = [
      { label: "See" as const, transcription: see },
      { label: "Think" as const, transcription: think },
      { label: "Wonder" as const, transcription: wonder },
    ];
    for (const step of stepData) {
      await submitReflectionStep({
        reflectionId: joined.reflection.id,
        participantToken: joined.participant.participantToken,
        step: {
          ...step,
          depthLevel: "developing",
          depthScore: 2,
          followUpQuestion: null,
        },
        alerts: [],
      });
    }
    await completeReflection({
      reflectionId: joined.reflection.id,
      participantToken: joined.participant.participantToken,
      analysis: {
        overallDepthScore: 2,
        strongestStep: "Wonder",
        mindset: "growth",
        tone: "engaged",
        keyQuotes: [wonder],
        crossCurricularConnections: ["Social studies", "Weather"],
        cognitiveMoves: ["observed details", "reasoned with evidence", "asked a question"],
      },
      feedback: {
        strongestMove: "Your Wonder question opened a path for investigation.",
        nudge: "Next time, connect your idea to one exact detail you noticed.",
        growthComparison: null,
      },
    });
  }

  await saveClassSummary(
    session.id,
    "Students are noticing concrete evidence in the image and beginning to connect it to collaboration, weather, and planning. Next, ask students to choose one observation and explain what makes them say that before moving into a written claim.",
  );

  return session;
}

function recalculateSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return;

  const sessionParticipants = [...participants.values()].filter(
    (participant) => participant.sessionId === sessionId,
  );
  const sessionReflections = [...reflections.values()].filter(
    (reflection) => reflection.sessionId === sessionId,
  );

  session.joinedCount = sessionParticipants.length;
  session.reflectingCount = sessionParticipants.filter(
    (participant) => participant.status === "reflecting",
  ).length;
  session.doneCount = sessionParticipants.filter(
    (participant) => participant.status === "done",
  ).length;
  session.alertCount = sessionReflections.reduce(
    (total, reflection) => total + reflection.contentAlerts.length,
    0,
  );
  session.summaryStatus =
    session.doneCount > 0 && session.doneCount / Math.max(session.joinedCount, 1) >= 0.75
      ? session.classSummary
        ? "generated"
        : "ready"
      : session.summaryStatus;
  session.classThinkingMap = buildThinkingMap(
    sessionReflections.map((reflection) => ({
      studentId: reflection.participantId,
      steps: reflection.steps.map((step) => ({
        label: step.label,
        transcription: step.transcription,
      })),
    })),
  );
}

async function recalculateFirestoreSession(sessionId: string) {
  const db = getAdminDb();
  if (!db) return;

  const session = await getSession(sessionId);
  if (!session) return;

  const [participantsSnapshot, reflectionsSnapshot] = await Promise.all([
    db.collection("sessions").doc(sessionId).collection("participants").get(),
    db.collection("sessions").doc(sessionId).collection("reflections").get(),
  ]);
  const sessionParticipants = participantsSnapshot.docs.map(
    (doc) => doc.data() as Participant,
  );
  const sessionReflections = reflectionsSnapshot.docs.map((doc) => doc.data() as Reflection);
  const doneCount = sessionParticipants.filter(
    (participant) => participant.status === "done",
  ).length;
  const joinedCount = sessionParticipants.length;
  const updated: Session = {
    ...session,
    joinedCount,
    reflectingCount: sessionParticipants.filter(
      (participant) => participant.status === "reflecting",
    ).length,
    doneCount,
    alertCount: sessionReflections.reduce(
      (total, reflection) => total + reflection.contentAlerts.length,
      0,
    ),
    summaryStatus:
      doneCount > 0 && doneCount / Math.max(joinedCount, 1) >= 0.75
        ? session.classSummary
          ? "generated"
          : "ready"
        : session.summaryStatus,
    classThinkingMap: buildThinkingMap(
      sessionReflections.map((reflection) => ({
        studentId: reflection.participantId,
        steps: reflection.steps.map((step) => ({
          label: step.label,
          transcription: step.transcription,
        })),
      })),
    ),
  };

  await db.collection("sessions").doc(sessionId).set(updated);
  await db
    .collection("sessions")
    .doc(sessionId)
    .collection("thinkingMap")
    .doc("current")
    .set(updated.classThinkingMap);
}

function normalizeDisplayName(displayName: string) {
  const normalized = displayName.replace(/[^\w\s.-]/g, "").trim();
  return normalized || "Student";
}

function dedupeAlerts(alerts: SafetyAlert[]) {
  const seen = new Set<string>();
  return alerts.filter((alert) => {
    const key = `${alert.severity}:${alert.category}:${alert.matchedText}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function upsertStep(steps: ReflectionStep[], nextStep: ReflectionStep) {
  const next = [...steps];
  const stepIndex = next.findIndex((step) => step.label === nextStep.label);

  if (stepIndex >= 0) {
    next[stepIndex] = nextStep;
  } else {
    next.push(nextStep);
  }

  return next;
}

async function writeAlerts(
  sessionId: string,
  reflectionId: string,
  displayName: string,
  alerts: SafetyAlert[],
) {
  const db = getAdminDb();
  if (!db) return;

  const collection = db.collection("sessions").doc(sessionId).collection("alerts");
  for (const [index, alert] of alerts.entries()) {
    await collection.doc(`${reflectionId}_${index}`).set({
      ...alert,
      id: `${reflectionId}_${index}`,
      reflectionId,
      displayName,
    });
  }
}
