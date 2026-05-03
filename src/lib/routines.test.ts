import { describe, expect, it } from "vitest";
import {
  SEE_THINK_WONDER_ROUTINE,
  WOULD_YOU_RATHER_ROUTINE,
  I_USED_TO_THINK_ROUTINE,
  CLAIM_SUPPORT_QUESTION_ROUTINE,
  getRoutineStep,
} from "./routines";

describe("See Think Wonder routine", () => {
  it("ships the MVP routine with three ordered prompts", () => {
    expect(SEE_THINK_WONDER_ROUTINE.steps.map((step) => step.label)).toEqual([
      "See",
      "Think",
      "Wonder",
    ]);
    expect(SEE_THINK_WONDER_ROUTINE.config.voiceMinimumSeconds).toBe(5);
  });

  it("looks up routine steps by one-based step number", () => {
    expect(getRoutineStep(2).label).toBe("Think");
  });
});

describe("Routine peer voting defaults", () => {
  it("See Think Wonder should have peerVotingDefault true", () => {
    expect(SEE_THINK_WONDER_ROUTINE.peerVotingDefault).toBe(true);
    expect(SEE_THINK_WONDER_ROUTINE.headlineStep).toBe("Wonder");
  });

  it("Would You Rather should have peerVotingDefault false", () => {
    expect(WOULD_YOU_RATHER_ROUTINE.peerVotingDefault).toBe(false);
    expect(WOULD_YOU_RATHER_ROUTINE.headlineStep).toBeUndefined();
  });

  it("I Used to Think should have peerVotingDefault true", () => {
    expect(I_USED_TO_THINK_ROUTINE.peerVotingDefault).toBe(true);
    expect(I_USED_TO_THINK_ROUTINE.headlineStep).toBe("Now I Think");
  });

  it("Claim Support Question should have peerVotingDefault true", () => {
    expect(CLAIM_SUPPORT_QUESTION_ROUTINE.peerVotingDefault).toBe(true);
    expect(CLAIM_SUPPORT_QUESTION_ROUTINE.headlineStep).toBe("Claim");
  });
});
