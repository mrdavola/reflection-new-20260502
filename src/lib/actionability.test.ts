import { describe, expect, it } from "vitest";
import { getPriorityCards, getTeacherNextMove } from "./actionability";
import type { DashboardPayload } from "./models";

const baseDashboard: DashboardPayload = {
  session: {
    id: "session_1",
    teacherId: "teacher_1",
    routineId: "exit-ticket-conversation",
    title: "Exit Ticket",
    learningTarget: "Equivalent fractions",
    stimulus: { kind: "none", value: "" },
    config: {
      aiFollowupsEnabled: true,
      voiceMinimumSeconds: 5,
      annotationMode: false,
      responseMode: "choice",
      showTranscription: true,
      studentResultsVisibility: "full",
    },
    joinCode: "ABC123",
    joinLink: "/join/ABC123",
    status: "active",
    joinedCount: 0,
    reflectingCount: 0,
    doneCount: 0,
    alertCount: 0,
    summaryStatus: "idle",
    classSummary: null,
    classThinkingMap: { see: [], think: [], wonder: [] },
    createdAt: "2026-05-02T00:00:00.000Z",
  },
  participants: [],
  reflections: [],
  alerts: [],
};

describe("teacher actionability", () => {
  it("tells the teacher to project the join code before students arrive", () => {
    const move = getTeacherNextMove(baseDashboard);

    expect(move.title).toBe("Project the join code");
    expect(move.action).toContain("ABC123");
  });

  it("prioritizes safety alerts before instructional moves", () => {
    const move = getTeacherNextMove({
      ...baseDashboard,
      alerts: [
        {
          id: "alert_1",
          reflectionId: "reflection_1",
          displayName: "Maya",
          severity: "red",
          category: "personal_safety",
          title: "Immediate review",
          message: "Review transcript.",
        },
      ],
    });

    expect(move.tone).toBe("urgent");
    expect(move.action).toContain("Maya");
  });

  it("creates low-depth and strong-quote priority cards from reflections", () => {
    const cards = getPriorityCards({
      ...baseDashboard,
      reflections: [
        {
          id: "reflection_low",
          sessionId: "session_1",
          participantId: "participant_1",
          displayName: "Jordan",
          steps: [
            {
              label: "Exit Ticket",
              transcription: "I don't know.",
              rating: 1,
              ratingLabel: "surface",
              directQuote: "I don't know.",
            },
          ],
          overallAnalysis: {
            overallDepthScore: 1,
            strongestStep: "Exit Ticket",
            mindset: "neutral",
            tone: "neutral",
            keyQuotes: ["I don't know."],
            crossCurricularConnections: [],
            cognitiveMoves: [],
          },
          studentFeedback: null,
          contentAlerts: [],
          teacherNote: null,
          audioExpiresAt: null,
          createdAt: "2026-05-02T00:00:00.000Z",
          completedAt: "2026-05-02T00:01:00.000Z",
        },
        {
          id: "reflection_deep",
          sessionId: "session_1",
          participantId: "participant_2",
          displayName: "Avery",
          steps: [
            {
              label: "Exit Ticket",
              transcription:
                "One half and two fourths both land halfway on the number line.",
              rating: 3,
              ratingLabel: "deep",
              directQuote:
                "One half and two fourths both land halfway on the number line.",
            },
          ],
          overallAnalysis: {
            overallDepthScore: 3,
            strongestStep: "Exit Ticket",
            mindset: "growth",
            tone: "engaged",
            keyQuotes: [
              "One half and two fourths both land halfway on the number line.",
            ],
            crossCurricularConnections: ["Math"],
            cognitiveMoves: ["reasoned with evidence"],
          },
          studentFeedback: {
            strongestMove: "Used a precise example.",
            nudge: "Explain why the points overlap.",
            growthComparison: null,
          },
          contentAlerts: [],
          teacherNote: null,
          audioExpiresAt: null,
          createdAt: "2026-05-02T00:00:00.000Z",
          completedAt: "2026-05-02T00:01:00.000Z",
        },
      ],
    });

    expect(cards.map((card) => card.kind)).toEqual(["support", "celebrate"]);
    expect(cards[0].title).toContain("Jordan");
    expect(cards[1].evidence).toContain("One half");
  });
});
