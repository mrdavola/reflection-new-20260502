import { z } from 'zod';
import { requireTeacherSession } from '@/lib/server/auth';
import { getSession, updateSession, getDbOrThrowForProd } from '@/lib/server/store';
import { getAdminDb } from '@/lib/server/firebase-admin';
import { ok, badRequest, serverError, notFound, forbidden } from '@/lib/server/http';
import { classifyTranscriptSafety } from '@/lib/safety';
import { buildVotingPool, type ResponseWithAlerts } from '@/lib/firebase/voting';
import { getRoutine } from '@/lib/routines';
import type { SafetyAlert, RoutineStepLabel } from '@/lib/types';
import type { Reflection } from '@/lib/models';

const StartVotingSchema = z.object({
  teacherId: z.string(),
});

interface ReflectionWithId extends Reflection {
  id: string;
}

export async function POST(
  request: Request,
  { params }: { params: { sessionId: string } }
) {
  try {
    await requireTeacherSession(request);

    const sessionId = params.sessionId;
    const body = StartVotingSchema.safeParse(await request.json());
    if (!body.success) return badRequest('Invalid request payload.');

    const session = await getSession(sessionId);
    if (!session) return notFound('Session not found.');

    // Check authorization: teacher must own the session
    if (session.teacherId !== body.data.teacherId) {
      return forbidden('Unauthorized');
    }

    // Check if voting should be skipped (minimum 5 reflections)
    const reflectionCount = session.joinedCount;
    if (reflectionCount < 5) {
      return ok({
        skipped: true,
        reason: 'Insufficient reflections for voting. Minimum 5 required.',
      });
    }

    // Check if voting is enabled for this session/routine
    const isVotingEnabled =
      session.config.peerVotingEnabled !== false &&
      getRoutine(session.routineId).peerVotingDefault !== false;

    if (!isVotingEnabled) {
      return ok({
        skipped: true,
        reason: 'Peer voting is disabled for this session.',
      });
    }

    // Determine headline step
    const headlineStepLabel: RoutineStepLabel | undefined =
      session.config.headlineStepOverride ?? getRoutine(session.routineId).headlineStep;

    if (!headlineStepLabel) {
      return ok({
        skipped: true,
        reason: 'No headline step configured for this routine.',
      });
    }

    // Fetch all reflections from Firestore
    const db = getDbOrThrowForProd();
    const snapshot = await db
      .collection('sessions')
      .doc(sessionId)
      .collection('reflections')
      .get();
    const reflectionsData = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Reflection),
    }));

    // Extract headline responses and analyze for safety
    const responsesWithAlerts: ResponseWithAlerts[] = [];

    for (const reflection of reflectionsData) {
      const headlineStep = reflection.steps.find(
        (step) => step.label === headlineStepLabel
      );

      if (!headlineStep) {
        continue;
      }

      const headlineText = headlineStep.transcription || '';
      const alerts: SafetyAlert[] = [];
      const safetyAlert = classifyTranscriptSafety(headlineText);
      if (safetyAlert) {
        alerts.push(safetyAlert);
      }

      responsesWithAlerts.push({
        id: reflection.id,
        alerts,
      });
    }

    // Build voting pool
    const pool = buildVotingPool(responsesWithAlerts);

    // Extract amber-flagged responses for teacher review
    const amberFlaggedIds = pool.excludedByAmberAlertIds;
    const amberFlaggedResponses = responsesWithAlerts
      .filter((r) => amberFlaggedIds.includes(r.id))
      .map((r) => {
        const reflection = reflectionsData.find((ref) => ref.id === r.id);
        const headlineStep = reflection?.steps.find(
          (step) => step.label === headlineStepLabel
        );
        const primaryAlert = r.alerts[0];

        return {
          id: r.id,
          transcription: headlineStep?.transcription || '',
          alert: primaryAlert
            ? {
                category: primaryAlert.category,
                message: primaryAlert.message,
              }
            : undefined,
        };
      });

    // Update session with voting pool and state
    // Per spec: excludedByAmberAlertIds starts empty (teacher hasn't made decisions yet)
    const votingPool = {
      eligibleReflectionIds: pool.eligibleReflectionIds,
      excludedByRedAlertIds: pool.excludedByRedAlertIds,
      excludedByAmberAlertIds: [],
    };

    await updateSession(sessionId, {
      votingState: 'review_pending',
      votingPool,
    });

    return ok({
      amberFlaggedResponses,
      votingPoolId: sessionId,
      totalEligible: votingPool.eligibleReflectionIds.length,
    });
  } catch (error) {
    console.error('Error starting voting:', error);
    return serverError(error);
  }
}
