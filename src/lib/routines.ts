import type { RoutineStep, SessionConfig } from "./types";

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  aiFollowupsEnabled: true,
  voiceMinimumSeconds: 5,
  annotationMode: false,
  responseMode: "choice",
  showTranscription: true,
  studentResultsVisibility: "full",
};

export const SEE_THINK_WONDER_ROUTINE = {
  id: "see-think-wonder",
  name: "See Think Wonder",
  description:
    "Students observe carefully, explain what they think, and name authentic questions.",
  bestForTags: ["observation", "curiosity", "stimulus"],
  config: DEFAULT_SESSION_CONFIG,
  steps: [
    {
      stepNumber: 1,
      label: "See",
      prompt: "What do you see?",
      studentCue: "Describe details you can point to. Try not to explain them yet.",
      followUpGuidance:
        "Probe for specificity, concrete details, and overlooked parts of the stimulus.",
    },
    {
      stepNumber: 2,
      label: "Think",
      prompt: "What do you think about that?",
      studentCue: "Explain what those details make you think and why.",
      followUpGuidance:
        "Push for reasoning, evidence, and a clear link between observation and interpretation.",
    },
    {
      stepNumber: 3,
      label: "Wonder",
      prompt: "What does it make you wonder?",
      studentCue: "Ask a question that could help you learn more.",
      followUpGuidance:
        "Celebrate curiosity and push toward investigable, meaningful questions.",
    },
  ] satisfies RoutineStep[],
};

export const WOULD_YOU_RATHER_ROUTINE = {
  id: "would-you-rather",
  name: "Would You Rather",
  description: "A quick-fire lesson starter where students choose between two scenarios and defend their reasoning.",
  bestForTags: ["debate", "reasoning", "engagement"],
  config: DEFAULT_SESSION_CONFIG,
  steps: [
    {
      stepNumber: 1,
      label: "Choice",
      prompt: "Make your choice",
      studentCue: "Tap Option A or Option B.",
      followUpGuidance: "Wait to ask follow-ups until they explain their reasoning.",
    },
    {
      stepNumber: 2,
      label: "Reasoning",
      prompt: "Why did you choose that?",
      studentCue: "Explain your reasoning using details from the topic.",
      followUpGuidance: "Push for a specific example or connection to the curriculum.",
    },
  ] satisfies RoutineStep[],
};

export const I_USED_TO_THINK_ROUTINE = {
  id: "i-used-to-think",
  name: "I Used to Think… Now I Think",
  description: "Students reflect on how their thinking changed and what caused the shift.",
  bestForTags: ["metacognition", "reflection", "mindset"],
  config: DEFAULT_SESSION_CONFIG,
  steps: [
    {
      stepNumber: 1,
      label: "Used to Think" as const,
      prompt: "What did you used to think?",
      studentCue: "Before today's lesson — what did you believe or assume about this topic?",
      followUpGuidance:
        "Probe for specificity. What exactly was the prior belief? How certain were they? Was it a misconception or incomplete understanding?",
    },
    {
      stepNumber: 2,
      label: "Now I Think" as const,
      prompt: "What do you now think?",
      studentCue: "How has your thinking changed? What do you understand now that you didn't before?",
      followUpGuidance:
        "Quote the student's 'Used to Think' response and ask: what specific moment, idea, or evidence caused that shift?",
    },
  ] satisfies RoutineStep[],
};

export function getRoutineStep(stepNumber: number, routineId?: string) {
  const routineSteps =
    routineId === "would-you-rather"
      ? WOULD_YOU_RATHER_ROUTINE.steps
      : routineId === "i-used-to-think"
        ? I_USED_TO_THINK_ROUTINE.steps
        : SEE_THINK_WONDER_ROUTINE.steps;

  const step = routineSteps.find(
    (item) => item.stepNumber === stepNumber,
  );

  if (!step) {
    throw new Error(`Unknown step ${stepNumber} for routine ${routineId}`);
  }

  return step as RoutineStep;
}
