import { describe, expect, it } from "vitest";
import type { Session } from "@/lib/models";
import {
  buildExitTicketTurnPrompt,
  enforceTopicBoundExitTicketAnalysis,
} from "./service";

const waterCycleSession = {
  routineId: "quick-spin",
  exitTicketQuestion:
    "What would happen if precipitation stopped in the water cycle?",
  exitTicketContext:
    "Grade 4 science: water cycle, evaporation, condensation, precipitation, collection",
  learningTarget: "Students are learning the water cycle.",
} as Session;

describe("exit ticket topic focus", () => {
  it("tells the model to stay inside the teacher lesson topic", () => {
    const prompt = buildExitTicketTurnPrompt({
      session: waterCycleSession,
      prompt: waterCycleSession.exitTicketQuestion ?? "",
      response: "I would be precipitation.",
      previous: "None",
      turnIndex: 0,
      maxTurns: 4,
    });

    expect(prompt).toContain("Topic lock");
    expect(prompt).toContain("water cycle");
    expect(prompt).toContain("Do not pivot to gravity or energy");
  });

  it("replaces off-topic follow-ups that introduce gravity into a water cycle lesson", () => {
    const analysis = enforceTopicBoundExitTicketAnalysis(
      {
        directQuote: "i'm not sure",
        rating: 1,
        ratingLabel: "surface",
        teacherSummary: "The student needs a simpler lesson-connected prompt.",
        followUpQuestion:
          "If gravity is pulling you down from a high cloud as a raindrop, what finally stops you from falling, and what happens to all that energy?",
      },
      {
        session: waterCycleSession,
        response: "i'm not sure",
        turnIndex: 2,
        maxTurns: 4,
      },
    );

    expect(analysis.followUpQuestion).toContain("water cycle");
    expect(analysis.followUpQuestion).not.toContain("gravity");
    expect(analysis.followUpQuestion).not.toContain("energy");
  });

  it("cleans awkward quote wording around unsure responses", () => {
    const analysis = enforceTopicBoundExitTicketAnalysis(
      {
        directQuote: "i'm not sure",
        rating: 1,
        ratingLabel: "surface",
        teacherSummary: "The student needs a simpler lesson-connected prompt.",
        followUpQuestion:
          "It is okay that you're \"i'm not sure\"! What happens to water during evaporation?",
      },
      {
        session: waterCycleSession,
        response: "i'm not sure",
        turnIndex: 2,
        maxTurns: 4,
      },
    );

    expect(analysis.followUpQuestion).toContain("You said");
    expect(analysis.followUpQuestion).not.toContain("you're \"");
  });
});
