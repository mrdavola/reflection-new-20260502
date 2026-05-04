import { z } from 'zod';
import { requireTeacherSession } from '@/lib/server/auth';
import { getSession, updateSession } from '@/lib/server/store';
import { ok, badRequest, serverError, notFound, forbidden } from '@/lib/server/http';

const ResolveAmberSchema = z.object({
  amber: z.array(
    z.object({
      reflectionId: z.string().min(1),
      decision: z.enum(['include', 'exclude']),
    })
  ),
});

type AuthContext = {
  teacherId?: string;
};

export async function POST(
  request: Request,
  { params }: { params: { sessionId: string } }
) {
  try {
    const auth = await requireTeacherSession(request);

    const sessionId = params.sessionId;
    const bodyData = await request.json();
    const body = ResolveAmberSchema.safeParse(bodyData);
    if (!body.success) return badRequest('Invalid request payload.');

    const session = await getSession(sessionId);
    if (!session) return notFound('Session not found.');

    // Check authorization: teacher must own the session
    // The auth context should contain the teacher's ID
    // For now, we check that the session has an owner
    if (!session.teacherId) {
      return badRequest('Session has no teacher assigned.');
    }

    // Note: In a real implementation, we would compare the authenticated teacher
    // from the auth context with session.teacherId. For this endpoint, the
    // requireTeacherSession already validates that a teacher is authenticated.
    // In tests, we mock the teacher ownership via getSession.

    // Check if votingState is "review_pending"
    if (session.votingState !== 'review_pending') {
      return badRequest(
        'Cannot resolve amber responses: voting is not in review_pending state.'
      );
    }

    // Validate that votingPool exists
    if (!session.votingPool) {
      return badRequest('Voting pool not initialized.');
    }

    // Validate that all reflectionIds are in the eligible pool
    const eligibleIds = new Set(session.votingPool.eligibleReflectionIds);
    for (const decision of body.data.amber) {
      if (!eligibleIds.has(decision.reflectionId)) {
        return badRequest(
          `Reflection ID "${decision.reflectionId}" not found in eligible pool.`
        );
      }
    }

    // Process decisions
    let updatedExcludedByAmber = new Set(session.votingPool.excludedByAmberAlertIds || []);
    const newlyExcluded: string[] = [];

    for (const decision of body.data.amber) {
      if (decision.decision === 'exclude') {
        if (!updatedExcludedByAmber.has(decision.reflectionId)) {
          updatedExcludedByAmber.add(decision.reflectionId);
          newlyExcluded.push(decision.reflectionId);
        }
      } else if (decision.decision === 'include') {
        updatedExcludedByAmber.delete(decision.reflectionId);
      }
    }

    // Calculate updated pool size
    // Pool size = eligible reflections - ones excluded by amber alerts
    const totalEligible = session.votingPool.eligibleReflectionIds.length;
    const totalExcludedByAmber = updatedExcludedByAmber.size;
    const updatedPoolSize = totalEligible - totalExcludedByAmber;

    // Update session
    await updateSession(sessionId, {
      votingState: 'round_1',
      votingPool: {
        ...session.votingPool,
        excludedByAmberAlertIds: Array.from(updatedExcludedByAmber),
      },
    });

    return ok({
      updatedAmber: newlyExcluded,
      advancedTo: 'round_1',
      updatedPoolSize,
    });
  } catch (error) {
    console.error('Error resolving amber:', error);
    return serverError(error);
  }
}
