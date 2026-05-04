import { z } from "zod";
import { requireTeacherSession } from "@/lib/server/auth";
import { createSession, listSessions } from "@/lib/server/store";
import { badRequest, ok, serverError } from "@/lib/server/http";

const CreateSessionSchema = z.object({
  title: z.string().optional(),
  learningTarget: z.string().optional(),
  gradeBand: z.string().optional(),
  routineId: z.enum(["see-think-wonder", "exit-ticket-conversation", "quick-spin", "would-you-rather", "i-used-to-think", "claim-support-question"]).optional(),
  wyrOptions: z
    .object({
      optionA: z.string(),
      optionB: z.string(),
      optionAImageUrl: z.string().optional(),
      optionBImageUrl: z.string().optional(),
    })
    .optional(),
  exitTicketQuestion: z.string().optional(),
  exitTicketContext: z.string().optional(),
  exitTicketMaxTurns: z.number().int().min(2).max(5).optional(),
  config: z
    .object({
      voiceMinimumSeconds: z.number().int().min(0).max(60).optional(),
      annotationMode: z.boolean().optional(),
    })
    .optional(),
  stimulus: z
    .object({
      kind: z.enum(["image", "text", "link", "none"]),
      value: z.string(),
    })
    .optional(),
});

export async function GET(request: Request) {
  try {
    await requireTeacherSession(request);
    return ok({ sessions: await listSessions() });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireTeacherSession(request);
    const body = CreateSessionSchema.safeParse(await request.json());
    if (!body.success) return badRequest("Session payload is invalid.");

    if (body.data.routineId === "would-you-rather" && !body.data.wyrOptions) {
      return badRequest("Would You Rather requires both Option A and Option B.");
    }

    const session = await createSession(body.data);
    return ok({ session }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
