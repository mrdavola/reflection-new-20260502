import { describe, expect, it, vi } from "vitest";
import { getPilotCredentials, verifyPilotCredentials } from "./auth";

describe("pilot credentials", () => {
  it("accepts the simple fallback teacher login", () => {
    expect(verifyPilotCredentials("teacher", "reflect")).toBe(true);
  });

  it("allows env overrides without leaking whitespace or case surprises", () => {
    vi.stubEnv("PILOT_LOGIN_USERNAME", "MsRivera");
    vi.stubEnv("PILOT_LOGIN_PASSWORD", "visible");

    expect(getPilotCredentials()).toEqual({
      username: "MsRivera",
      password: "visible",
    });
    expect(verifyPilotCredentials(" msrivera ", "visible")).toBe(true);
    expect(verifyPilotCredentials("teacher", "reflect")).toBe(false);

    vi.unstubAllEnvs();
  });
});
