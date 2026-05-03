import { describe, expect, it } from "vitest";
import { getRoutineDashboardPanels } from "./dashboard-panels";

describe("routine dashboard panels", () => {
  it("uses conversation labels for quick spin instead of See Think Wonder", () => {
    const config = getRoutineDashboardPanels("quick-spin", 4);

    expect(config.title).toBe("Quick Spin Thinking Path");
    expect(config.panels.map((panel) => panel.label)).toEqual([
      "First Response",
      "Follow-up 1",
      "Follow-up 2",
      "Follow-up 3",
    ]);
    expect(config.panels.map((panel) => panel.label)).not.toContain("See");
  });

  it("uses choice and reasoning for would you rather", () => {
    const config = getRoutineDashboardPanels("would-you-rather");

    expect(config.panels.map((panel) => panel.label)).toEqual([
      "Choice",
      "Reasoning",
    ]);
  });

  it("keeps Project Zero labels for See Think Wonder", () => {
    const config = getRoutineDashboardPanels("see-think-wonder");

    expect(config.panels.map((panel) => panel.label)).toEqual([
      "See",
      "Think",
      "Wonder",
    ]);
  });
});
