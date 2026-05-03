import type { RoutineStep, RoutineStepLabel, SessionConfig } from "./types";

export type RoutineDefinition = {
  id: string;
  name: string;
  description: string;
  bestForTags: string[];
  config: SessionConfig;
  steps: RoutineStep[];
  peerVotingDefault: boolean;
  headlineStep?: RoutineStepLabel;
};

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
  peerVotingDefault: true,
  headlineStep: "Wonder" as const,
} satisfies RoutineDefinition;

export const WOULD_YOU_RATHER_ROUTINE: RoutineDefinition = {
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
  peerVotingDefault: false,
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
  peerVotingDefault: true,
  headlineStep: "Now I Think" as const,
} satisfies RoutineDefinition;

export const CLAIM_SUPPORT_QUESTION_ROUTINE = {
  id: "claim-support-question",
  name: "Claim Support Question",
  description: "Students make a claim, provide supporting evidence, then ask a question their claim raises.",
  bestForTags: ["argumentation", "evidence", "critical thinking"],
  config: DEFAULT_SESSION_CONFIG,
  steps: [
    {
      stepNumber: 1,
      label: "Claim" as const,
      prompt: "What is your claim?",
      studentCue: "Make a clear statement about what you believe or have learned.",
      followUpGuidance:
        "Push for a specific, debatable claim — not just a fact. Ask: could someone disagree with this?",
    },
    {
      stepNumber: 2,
      label: "Support" as const,
      prompt: "What evidence supports your claim?",
      studentCue: "Name specific details, examples, or reasoning that back up what you said.",
      followUpGuidance:
        "Ask for the strongest piece of evidence. Push beyond opinions to concrete, citable details.",
    },
    {
      stepNumber: 3,
      label: "Question" as const,
      prompt: "What question does your claim raise?",
      studentCue: "What do you still wonder? What would change your mind?",
      followUpGuidance:
        "Celebrate genuine uncertainty. Push toward investigable questions that connect to the claim.",
    },
  ] satisfies RoutineStep[],
  peerVotingDefault: true,
  headlineStep: "Claim" as const,
} satisfies RoutineDefinition;

export const EXIT_TICKET_CONVERSATION_ROUTINE: RoutineDefinition = {
  id: "exit-ticket-conversation",
  name: "Exit Ticket",
  description: "A brief reflection to assess student thinking before leaving class.",
  bestForTags: ["closing", "assessment", "reflection"],
  config: DEFAULT_SESSION_CONFIG,
  steps: [
    {
      stepNumber: 1,
      label: "Exit Ticket",
      prompt: "Respond to the exit ticket question.",
      studentCue: "Take your time to give a thoughtful response.",
      followUpGuidance:
        "Listen carefully and ask follow-up questions to deepen understanding.",
    },
    {
      stepNumber: 2,
      label: "Follow-up 1",
      prompt: "Tell me more about that.",
      studentCue: "Provide more detail or clarification.",
      followUpGuidance: "Push for specificity and reasoning.",
    },
    {
      stepNumber: 3,
      label: "Follow-up 2",
      prompt: "How does that connect to what we learned?",
      studentCue: "Link your thinking back to the lesson.",
      followUpGuidance: "Help them make meaningful connections.",
    },
    {
      stepNumber: 4,
      label: "Follow-up 3",
      prompt: "What's one thing you'll remember from today?",
      studentCue: "Reflect on the most important takeaway.",
      followUpGuidance: "Celebrate key insights and growth.",
    },
  ] satisfies RoutineStep[],
  peerVotingDefault: false,
};

export const QUICK_SPIN_ROUTINE: RoutineDefinition = {
  id: "quick-spin",
  name: "Reflection Spinner",
  description: "Students spin the wheel and respond to a random reflection prompt.",
  bestForTags: ["engagement", "variety", "quick"],
  config: DEFAULT_SESSION_CONFIG,
  steps: [
    {
      stepNumber: 1,
      label: "Exit Ticket",
      prompt: "Respond to the reflection prompt.",
      studentCue: "Answer honestly and thoughtfully.",
      followUpGuidance:
        "Listen carefully and ask follow-up questions to deepen understanding.",
    },
    {
      stepNumber: 2,
      label: "Follow-up 1",
      prompt: "Tell me more about that.",
      studentCue: "Provide more detail or clarification.",
      followUpGuidance: "Push for specificity and reasoning.",
    },
    {
      stepNumber: 3,
      label: "Follow-up 2",
      prompt: "How does that connect to what we learned?",
      studentCue: "Link your thinking back to the lesson.",
      followUpGuidance: "Help them make meaningful connections.",
    },
    {
      stepNumber: 4,
      label: "Follow-up 3",
      prompt: "What's one thing you'll remember from this?",
      studentCue: "Reflect on the most important takeaway.",
      followUpGuidance: "Celebrate key insights and growth.",
    },
  ] satisfies RoutineStep[],
  peerVotingDefault: false,
};

export function getRoutineStep(stepNumber: number, routineId?: string) {
  const routineSteps =
    routineId === "would-you-rather"
      ? WOULD_YOU_RATHER_ROUTINE.steps
      : routineId === "i-used-to-think"
        ? I_USED_TO_THINK_ROUTINE.steps
        : routineId === "claim-support-question"
          ? CLAIM_SUPPORT_QUESTION_ROUTINE.steps
          : routineId === "exit-ticket-conversation"
            ? EXIT_TICKET_CONVERSATION_ROUTINE.steps
            : routineId === "quick-spin"
              ? QUICK_SPIN_ROUTINE.steps
              : SEE_THINK_WONDER_ROUTINE.steps;

  const step = routineSteps.find(
    (item) => item.stepNumber === stepNumber,
  );

  if (!step) {
    throw new Error(`Unknown step ${stepNumber} for routine ${routineId}`);
  }

  return step as RoutineStep;
}
