import type {
  ClassThinkingMap,
  ReflectionStep,
  SafetyAlert,
  SessionConfig,
} from "./types";

export type SessionStatus = "setup" | "active" | "closed";
export type SummaryStatus = "idle" | "ready" | "generated";

export type Stimulus = {
  kind: "image" | "text" | "link" | "none";
  value: string;
};

export type Session = {
  id: string;
  teacherId: string;
  routineId: "see-think-wonder" | "exit-ticket-conversation" | "quick-spin" | "would-you-rather" | "i-used-to-think";
  title: string;
  learningTarget: string;
  gradeBand?: string;
  wyrOptions?: {
    optionA: string;
    optionB: string;
    optionAImageUrl?: string;
    optionBImageUrl?: string;
  };
  exitTicketQuestion?: string;
  exitTicketContext?: string;
  exitTicketMaxTurns?: number;
  stimulus: Stimulus;
  config: SessionConfig;
  joinCode: string;
  joinLink: string;
  status: SessionStatus;
  joinedCount: number;
  reflectingCount: number;
  doneCount: number;
  alertCount: number;
  summaryStatus: SummaryStatus;
  classSummary: string | null;
  classThinkingMap: ClassThinkingMap;
  createdAt: string;
};

export type Participant = {
  id: string;
  sessionId: string;
  displayName: string;
  participantToken: string;
  status: "joined" | "reflecting" | "done";
  createdAt: string;
};

export type StudentFeedback = {
  strongestMove: string;
  nudge: string;
  growthComparison: string | null;
};

export type Reflection = {
  id: string;
  sessionId: string;
  participantId: string;
  displayName: string;
  steps: ReflectionStep[];
  overallAnalysis: {
    overallDepthScore: number;
    strongestStep: string;
    mindset: "growth" | "neutral" | "fixed";
    tone: "engaged" | "neutral" | "disengaged" | "concerned";
    keyQuotes: string[];
    crossCurricularConnections: string[];
    cognitiveMoves: string[];
  } | null;
  studentFeedback: StudentFeedback | null;
  contentAlerts: SafetyAlert[];
  teacherNote: string | null;
  audioExpiresAt: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type DashboardPayload = {
  session: Session;
  participants: Participant[];
  reflections: Reflection[];
  alerts: Array<SafetyAlert & { id: string; reflectionId: string; displayName: string }>;
};
