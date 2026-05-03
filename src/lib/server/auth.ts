import { SignJWT, jwtVerify } from "jose";
import type { Participant } from "@/lib/models";
import { getParticipantByToken } from "./store";

const TEACHER_COOKIE = "pilot_teacher_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const FALLBACK_PILOT_USERNAME = "teacher";
const FALLBACK_PILOT_PASSWORD = "reflect";

function getSessionSecret() {
  const secret = process.env.PILOT_SESSION_SECRET;
  if (!secret) {
    throw new Error("Missing PILOT_SESSION_SECRET.");
  }
  return new TextEncoder().encode(secret);
}

export function getTeacherCookieName() {
  return TEACHER_COOKIE;
}

export function getSessionMaxAge() {
  return SESSION_TTL_SECONDS;
}

export function getPilotCredentials() {
  return {
    username: process.env.PILOT_LOGIN_USERNAME?.trim() || FALLBACK_PILOT_USERNAME,
    password: process.env.PILOT_LOGIN_PASSWORD?.trim() || FALLBACK_PILOT_PASSWORD,
  };
}

export function verifyPilotCredentials(username: string, password: string) {
  const credentials = getPilotCredentials();
  return (
    username.trim().toLowerCase() === credentials.username.toLowerCase() &&
    password === credentials.password
  );
}

export async function createTeacherSessionToken(payload: {
  uid: string;
  email: string;
  name?: string | null;
}) {
  return new SignJWT({
    uid: payload.uid,
    email: payload.email,
    name: payload.name ?? null,
    role: "teacher",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSessionSecret());
}

export async function verifyTeacherSessionToken(token: string) {
  const verified = await jwtVerify(token, getSessionSecret(), {
    algorithms: ["HS256"],
  });
  return verified.payload as {
    uid: string;
    email: string;
    name?: string | null;
    role: "teacher";
  };
}

export async function requireTeacherSession(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${TEACHER_COOKIE}=`));
  const token = cookie?.slice(TEACHER_COOKIE.length + 1);

  if (!token) {
    throw new Error("Teacher authentication required.");
  }

  return verifyTeacherSessionToken(decodeURIComponent(token));
}

export function isTeacherEmailAllowed(email: string) {
  const allowlist = (process.env.PILOT_TEACHER_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (allowlist.length === 0) return true;
  return allowlist.includes(email.toLowerCase());
}

export async function assertParticipantTokenForReflection(params: {
  sessionId: string;
  participantToken: string;
}): Promise<Participant> {
  const participant = await getParticipantByToken(params.sessionId, params.participantToken);
  if (!participant) {
    throw new Error("Invalid participant token.");
  }
  return participant;
}
