import { z } from "zod";
import { analyzeStep, moderateTranscript } from "@/lib/ai/service";
import { getRoutineStep } from "@/lib/routines";
import { badRequest, notFound, ok, serverError } from "@/lib/server/http";
import { getReflection, getSession, submitReflectionStep } from "@/lib/server/store";

const TextStepSchema = z.object({
  participantToken: z.string().min(1),
  transcription: z.string().min(1),
  annotations: z
    .array(
      z.object({
        id: z.string().min(1),
        x: z.number().min(0).max(100),
        y: z.number().min(0).max(100),
        text: z.string().min(1),
        mode: z.enum(["voice", "text"]),
      }),
    )
    .optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reflectionId: string; step: string }> },
) {
  try {
    const { reflectionId, step } = await params;
    const stepNumber = Number(step);
    if (![1, 2, 3].includes(stepNumber)) return badRequest("Invalid routine step.");

    const body = TextStepSchema.safeParse(await request.json());
    if (!body.success) return badRequest("Step payload is invalid.");

    const reflection = await getReflection(reflectionId);
    if (!reflection) return notFound("Reflection not found.");

    const session = await getSession(reflection.sessionId);
    if (!session) return notFound("Session not found.");

    const routineStep = getRoutineStep(stepNumber, session.routineId);
    const previousTranscripts = reflection.steps.map((s) => s.transcription);
    const [analysis, alerts] = await Promise.all([
      analyzeStep({
        session,
        label: routineStep.label,
        transcript: body.data.transcription,
        previousTranscripts,
      }),
      moderateTranscript(body.data.transcription),
    ]);

    const updated = await submitReflectionStep({
      reflectionId,
      participantToken: body.data.participantToken,
      step: {
        label: routineStep.label,
        transcription: body.data.transcription,
        depthLevel: analysis.depthLevel,
        depthScore: analysis.depthScore,
        followUpQuestion: analysis.followUpQuestion ?? null,
        annotations: body.data.annotations,
      },
      alerts,
    });

    return ok({ reflection: updated, analysis, alerts });
  } catch (error) {
    return serverError(error);
  }
}
