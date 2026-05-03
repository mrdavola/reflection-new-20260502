import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createTeacherSessionToken,
  getSessionMaxAge,
  getTeacherCookieName,
  verifyPilotCredentials,
} from "@/lib/server/auth";

const PilotAuthSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const body = PilotAuthSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json({ error: "Pilot login is incomplete." }, { status: 400 });
    }

    if (!verifyPilotCredentials(body.data.username, body.data.password)) {
      return NextResponse.json({ error: "Pilot username or password is incorrect." }, { status: 401 });
    }

    const sessionToken = await createTeacherSessionToken({
      uid: "pilot-login",
      email: "pilot@reflectai.local",
      name: "Pilot teacher",
    });

    const response = NextResponse.json({
      ok: true,
      teacher: {
        uid: "pilot-login",
        email: "pilot@reflectai.local",
        name: "Pilot teacher",
      },
    });
    response.cookies.set(getTeacherCookieName(), sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: getSessionMaxAge(),
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start pilot session.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
