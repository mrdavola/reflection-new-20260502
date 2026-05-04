import { z } from 'zod';
import { requireTeacherSession } from '@/lib/server/auth';
import { getSession, updateSession, getDbOrThrowForProd } from '@/lib/server/store';
import { ok, badRequest, serverError, notFound, forbidden } from '@/lib/server/http';
import { aggregateVotes, selectFinalists } from '@/lib/firebase/voting';
import type { Reflection } from '@/lib/models';

const AdvanceSchema = z.object({
  action: z.enum([
    'round_1_to_finals',
    'finals_to_reveal',
    'reveal_to_discuss',
    'discuss_to_ended',
  ]),
});

const ACTION_TRANSITIONS = {
  round_1_to_finals: 'round_1',
  finals_to_reveal: 'finals',
  reveal_to_discuss: 'reveal',
  discuss_to_ended: 'discuss',
} as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const auth = await requireTeacherSession(request);
    const bodyData = await request.json();
    const body = AdvanceSchema.safeParse(bodyData);
    if (!body.success) return badRequest('Invalid request payload.');

    const session = await getSession(sessionId);
    if (!session) return notFound('Session not found.');

    // Check authorization
    if (auth.uid !== session.teacherId) {
      return forbidden('You do not have access to this session.');
    }

    const action = body.data.action;
    const expectedState = ACTION_TRANSITIONS[action];

    // Verify current voting state
    if (session.votingState !== expectedState) {
      return badRequest(
        `Cannot perform action "${action}". Current state is "${session.votingState}", expected "${expectedState}".`
      );
    }

    if (!session.votingPool) {
      return badRequest('Voting pool not initialized.');
    }

    const db = getDbOrThrowForProd();
    if (!db) {
      return badRequest('Voting operations not available in demo mode.');
    }

    // Process state transition
    if (action === 'round_1_to_finals') {
      // Aggregate votes from round 1 and select finalists
      const votesSnapshot = await db
        .collection('peerVotes')
        .where('sessionId', '==', sessionId)
        .where('round', '==', 1)
        .get();

      const votes = votesSnapshot.docs.map((doc) => ({
        reflectionId: doc.data().votedForReflectionId as string,
        round: 1 as const,
      }));

      const voteCounts = aggregateVotes(votes, 1);
      const finalists = selectFinalists(voteCounts, session.joinedCount);

      await updateSession(sessionId, {
        votingState: 'finals',
        votingPool: {
          ...session.votingPool,
          finalistReflectionIds: finalists,
        },
      });

      return ok({
        advanced: true,
        action: 'finals',
        finalists: finalists.length,
      });
    }

    if (action === 'finals_to_reveal') {
      // Aggregate votes from round 2 and determine winner
      const votesSnapshot = await db
        .collection('peerVotes')
        .where('sessionId', '==', sessionId)
        .where('round', '==', 2)
        .get();

      const votes = votesSnapshot.docs.map((doc) => ({
        reflectionId: doc.data().votedForReflectionId as string,
        round: 2 as const,
      }));

      const voteCounts = aggregateVotes(votes, 2);

      // Find winner (highest vote count; ties broken randomly)
      if (Object.keys(voteCounts).length === 0) {
        return badRequest('No votes recorded in finals round.');
      }

      const sorted = Object.entries(voteCounts)
        .map(([reflectionId, voteCount]) => ({ reflectionId, voteCount }))
        .sort((a, b) => b.voteCount - a.voteCount);

      // Get all tied at top
      const topVoteCount = sorted[0].voteCount;
      const tiedAtTop = sorted.filter((item) => item.voteCount === topVoteCount);

      // Deterministic tie-breaker using session ID as seed
      let seed = 0;
      for (let i = 0; i < sessionId.length; i++) {
        seed = ((seed << 5) - seed) + sessionId.charCodeAt(i);
        seed = seed | 0; // Convert to 32-bit integer
      }
      const winnerIndex = Math.abs(seed % tiedAtTop.length);
      const winner = tiedAtTop[winnerIndex];

      // Get top 3 with student names
      const reflectionsSnapshot = await db
        .collection('sessions')
        .doc(sessionId)
        .collection('reflections')
        .get();

      const reflectionsMap = new Map(
        reflectionsSnapshot.docs.map((doc) => [
          doc.id,
          doc.data() as Reflection,
        ])
      );

      const rankedTop3 = sorted.slice(0, 3).map((item) => {
        const reflection = reflectionsMap.get(item.reflectionId);
        return {
          reflectionId: item.reflectionId,
          studentName: reflection?.displayName ?? 'Unknown',
          voteCount: item.voteCount,
        };
      });

      await updateSession(sessionId, {
        votingState: 'reveal',
        votingPool: {
          ...session.votingPool,
          winnerReflectionId: winner.reflectionId,
          rankedTop3,
        },
      });

      return ok({
        advanced: true,
        action: 'reveal',
        winner: {
          reflectionId: winner.reflectionId,
          voteCount: winner.voteCount,
        },
        rankedTop3: rankedTop3.map((item) => ({
          reflectionId: item.reflectionId,
          studentName: item.studentName,
          voteCount: item.voteCount,
        })),
      });
    }

    if (action === 'reveal_to_discuss') {
      // No vote processing needed, just state transition
      await updateSession(sessionId, {
        votingState: 'discuss',
      });

      return ok({
        advanced: true,
        action: 'discuss',
      });
    }

    if (action === 'discuss_to_ended') {
      // No vote processing needed, just state transition
      await updateSession(sessionId, {
        votingState: 'ended',
      });

      return ok({
        advanced: true,
        action: 'ended',
      });
    }

    return badRequest('Unknown action.');
  } catch (error) {
    console.error('Error advancing voting:', error);
    return serverError(error);
  }
}
