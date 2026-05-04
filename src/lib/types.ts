export type DepthLevel = "surface" | "developing" | "deep" | "transfer";
export type RoutineStepLabel =
  | "See"
  | "Think"
  | "Wonder"
  | "Exit Ticket"
  | "Choice"
  | "Reasoning"
  | "Follow-up 1"
  | "Follow-up 2"
  | "Follow-up 3"
  | "Used to Think"
  | "Now I Think"
  | "Claim"
  | "Support"
  | "Question";
export type Tone = "engaged" | "neutral" | "disengaged" | "concerned";
export type Mindset = "growth" | "neutral" | "fixed";
export type AlertSeverity = "amber" | "red";

export type RoutineStep = {
  stepNumber: number;
  label: RoutineStepLabel;
  prompt: string;
  studentCue: string;
  followUpGuidance: string;
};

export type AnnotationNote = {
  id: string;
  x: number;
  y: number;
  text: string;
  mode: "voice" | "text";
};

export type SessionConfig = {
  aiFollowupsEnabled: boolean;
  voiceMinimumSeconds: number;
  annotationMode: boolean;
  responseMode: "voice" | "text" | "choice";
  showTranscription: boolean;
  studentResultsVisibility: "full" | "simplified" | "none";
  peerVotingEnabled?: boolean;
  headlineStepOverride?: RoutineStepLabel;
  celebrationAnimationEnabled?: boolean;
};

export type ReflectionStep = {
  label: RoutineStepLabel;
  prompt?: string;
  transcription: string;
  depthLevel?: DepthLevel;
  depthScore?: number;
  followUpQuestion?: string | null;
  directQuote?: string;
  rating?: number;
  ratingLabel?: DepthLevel;
  teacherSummary?: string;
  annotations?: AnnotationNote[];
};

export type AlertCategory =
  | "personal_safety"
  | "self_harm"
  | "violence"
  | "abuse"
  | "threat"
  | "profanity"
  | "low_depth"
  | "negative_tone";

export type SafetyAlert = {
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  matchedText?: string;
};

export type ThinkingMapCluster = {
  label: string;
  summary: string;
  studentIds: string[];
  representativeQuotes: string[];
};

export type ClassThinkingMap = {
  see: ThinkingMapCluster[];
  think: ThinkingMapCluster[];
  wonder: ThinkingMapCluster[];
};

export type VotingState =
  | "inactive"
  | "review_pending"
  | "round_1"
  | "finals_pending"
  | "finals"
  | "reveal"
  | "discuss"
  | "ended";

export type VotingPool = {
  eligibleReflectionIds: string[];
  excludedByRedAlertIds: string[];
  excludedByAmberAlertIds: string[];
  finalistReflectionIds?: string[];
  winnerReflectionId?: string;
  rankedTop3?: Array<{
    reflectionId: string;
    studentName: string;
    voteCount: number;
  }>;
};

export type PeerVote = {
  id: string;
  sessionId: string;
  voterStudentId: string;
  round: 1 | 2;
  votedForReflectionId: string;
  createdAt: Date;
  updatedAt?: Date;
};
