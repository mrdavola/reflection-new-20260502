import type { Session } from "./models";
import type { RoutineStepLabel } from "./types";

export type DashboardPanel = {
  label: RoutineStepLabel | "First Response";
  stepLabels: RoutineStepLabel[];
  description: string;
  accentClass: string;
};

export type RoutineDashboardPanels = {
  title: string;
  subtitle: string;
  panels: DashboardPanel[];
};

export function getRoutineDashboardPanels(
  routineId: Session["routineId"],
  maxTurns = 4,
): RoutineDashboardPanels {
  if (routineId === "quick-spin") {
    return {
      title: "Quick Spin Thinking Path",
      subtitle:
        "Each column follows the original student answer and the AI follow-up path.",
      panels: conversationPanels(maxTurns),
    };
  }

  if (routineId === "exit-ticket-conversation") {
    return {
      title: "Exit Ticket Conversation Map",
      subtitle:
        "Track the approved question, student quotes, ratings, and follow-up turns.",
      panels: conversationPanels(maxTurns),
    };
  }

  if (routineId === "would-you-rather") {
    return {
      title: "Choice and Reasoning Map",
      subtitle:
        "See which option students chose and how they defended their reasoning.",
      panels: [
        {
          label: "Choice",
          stepLabels: ["Choice"],
          description: "Which side each student selected.",
          accentClass: "bg-[#04c6c5]",
        },
        {
          label: "Reasoning",
          stepLabels: ["Reasoning"],
          description: "Evidence and explanation behind the choice.",
          accentClass: "bg-[#9b51e0] text-white",
        },
      ],
    };
  }

  if (routineId === "i-used-to-think") {
    return {
      title: "Thinking Shift Map",
      subtitle: "Compare prior beliefs with what changed after the lesson.",
      panels: [
        {
          label: "Used to Think",
          stepLabels: ["Used to Think"],
          description: "Prior beliefs before the lesson.",
          accentClass: "bg-[#fff2b7]",
        },
        {
          label: "Now I Think",
          stepLabels: ["Now I Think"],
          description: "New thinking after evidence or discussion.",
          accentClass: "bg-[#00b351] text-white",
        },
      ],
    };
  }

  if (routineId === "claim-support-question") {
    return {
      title: "Claim Support Question Map",
      subtitle: "Follow each argument from claim to evidence to open question.",
      panels: [
        {
          label: "Claim",
          stepLabels: ["Claim"],
          description: "The student's arguable idea.",
          accentClass: "bg-[#fff2b7]",
        },
        {
          label: "Support",
          stepLabels: ["Support"],
          description: "Evidence used to support the claim.",
          accentClass: "bg-[#00b351] text-white",
        },
        {
          label: "Question",
          stepLabels: ["Question"],
          description: "A question the claim raises.",
          accentClass: "bg-[#006cff] text-white",
        },
      ],
    };
  }

  return {
    title: "Class Thinking Map",
    subtitle: "Clusters update as students finish each See Think Wonder step.",
    panels: [
      {
        label: "See",
        stepLabels: ["See"],
        description: "Careful observations and named details.",
        accentClass: "bg-[#04c6c5]",
      },
      {
        label: "Think",
        stepLabels: ["Think"],
        description: "Interpretations connected to evidence.",
        accentClass: "bg-[#fff2b7]",
      },
      {
        label: "Wonder",
        stepLabels: ["Wonder"],
        description: "Questions that open inquiry.",
        accentClass: "bg-[#f780d4]",
      },
    ],
  };
}

function conversationPanels(maxTurns: number): DashboardPanel[] {
  const labels: Array<DashboardPanel["label"]> = [
    "First Response",
    "Follow-up 1",
    "Follow-up 2",
    "Follow-up 3",
  ];
  const stepLabels: RoutineStepLabel[] = [
    "Exit Ticket",
    "Follow-up 1",
    "Follow-up 2",
    "Follow-up 3",
  ];

  return labels.slice(0, maxTurns).map((label, index) => ({
    label,
    stepLabels: [stepLabels[index]],
    description:
      index === 0
        ? "Initial thinking from the teacher-approved prompt."
        : `AI follow-up turn ${index}, based on the student's own words.`,
    accentClass:
      index === 0
        ? "bg-[#04c6c5]"
        : index === 1
          ? "bg-[#006cff] text-white"
          : index === 2
            ? "bg-[#f780d4]"
            : "bg-[#fff2b7]",
  }));
}
