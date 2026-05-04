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
    if (auth.uid !== session.teacherId) {
      return forbidden('You do not have access to this session.');
    }

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

    // Validate that all reflectionIds are valid (either eligible or amber-excluded)
    const validIds = new Set([
      ...session.votingPool.eligibleReflectionIds,
      ...(session.votingPool.excludedByAmberAlertIds || []),
    ]);
    for (const decision of body.data.amber) {
      if (!validIds.has(decision.reflectionId)) {
        return badRequest(
          `Reflection ID "${decision.reflectionId}" not found in eligible pool.`
        );
      }
    }

    // Process decisions
    const updatedExcludedByAmber = new Set(session.votingPool.excludedByAmberAlertIds || []);
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
    // Pool size = eligible reflections - ones currently excluded by amber alerts
    const totalEligible = session.votingPool.eligibleReflectionIds.length;
    const updatedPoolSize = totalEligible - updatedExcludedByAmber.size;

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
