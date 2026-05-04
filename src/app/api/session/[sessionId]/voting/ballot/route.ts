import { assertParticipantTokenForReflection } from '@/lib/server/auth';
import { getSession, getDbOrThrowForProd } from '@/lib/server/store';
import { ok, badRequest, serverError, notFound, unauthorized } from '@/lib/server/http';
import { generateBallotSample } from '@/lib/firebase/voting';
import type { Reflection } from '@/lib/models';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const token = new URL(request.url).searchParams.get('token') ?? '';

    if (!token) {
      return unauthorized('Authentication required.');
    }

    // Verify student is in session
    let participant;
    try {
      participant = await assertParticipantTokenForReflection({
        sessionId,
        participantToken: token,
      });
    } catch {
      return unauthorized('Invalid or expired token.');
    }

    const session = await getSession(sessionId);
    if (!session) return notFound('Session not found.');

    const votingState = session.votingState ?? 'inactive';

    // Handle inactive/pending states with empty ballot
    if (
      votingState === 'inactive' ||
      votingState === 'review_pending' ||
      votingState === 'finals_pending'
    ) {
      return ok({ state: votingState, ballot: [] });
    }

    const db = getDbOrThrowForProd();
    if (!db) {
      return badRequest('Voting is not available in demo mode.');
    }

    // Fetch reflections and student's own reflection ID
    const reflectionsSnapshot = await db
      .collection('sessions')
      .doc(sessionId)
      .collection('reflections')
      .get();

    const allReflections = reflectionsSnapshot.docs.map((doc) => {
      const data = doc.data() as Reflection;
      return { ...data, id: doc.id };
    });

    const studentReflection = allReflections.find(
      (r) => r.participantId === participant.id
    );

    if (votingState === 'round_1') {
      // Get eligible responses from voting pool
      if (!session.votingPool) {
        return badRequest('Voting pool not initialized.');
      }

      const eligibleIds = session.votingPool.eligibleReflectionIds.filter(
        (id) => !session.votingPool?.excludedByAmberAlertIds?.includes(id)
      );

      if (eligibleIds.length === 0) {
        return ok({ round: 1, ballot: [], classSize: session.joinedCount });
      }

      // Generate ballot sample excluding own response
      const ballotIds = generateBallotSample(
        eligibleIds,
        sessionId,
        participant.id,
        session.joinedCount,
        studentReflection?.id
      );

      const ballot = ballotIds.map((reflectionId) => {
        const reflection = allReflections.find((r) => r.id === reflectionId);
        return {
          reflectionId,
          transcription: reflection?.steps
            ?.find((step) => step.label === 'See' || step.label === 'Wonder')
            ?.transcription ?? '',
        };
      });

      return ok({ round: 1, ballot, classSize: session.joinedCount });
    }

    if (votingState === 'finals') {
      // Get finalists from voting pool
      if (!session.votingPool?.finalistReflectionIds) {
        return badRequest('Finalists not available.');
      }

      const ballot = session.votingPool.finalistReflectionIds.map((reflectionId) => {
        const reflection = allReflections.find((r) => r.id === reflectionId);
        return {
          reflectionId,
          transcription: reflection?.steps
            ?.find((step) => step.label === 'See' || step.label === 'Wonder')
            ?.transcription ?? '',
        };
      });

      return ok({
        round: 2,
        ballot,
        finalists: session.votingPool.finalistReflectionIds.length,
      });
    }

    if (votingState === 'reveal') {
      // Return winner with top 3
      if (!session.votingPool?.winnerReflectionId) {
        return badRequest('Winner not determined.');
      }

      const winner = allReflections.find(
        (r) => r.id === session.votingPool?.winnerReflectionId
      );

      return ok({
        state: 'reveal',
        winner: {
          reflectionId: session.votingPool.winnerReflectionId,
          transcription: winner?.steps
            ?.find((step) => step.label === 'See' || step.label === 'Wonder')
            ?.transcription ?? '',
          voteCount: session.votingPool.rankedTop3?.[0]?.voteCount ?? 0,
        },
        rankedTop3: (session.votingPool.rankedTop3 ?? []).map((item) => ({
          reflectionId: item.reflectionId,
          voteCount: item.voteCount,
        })),
      });
    }

    if (votingState === 'discuss') {
      // Return winner without votes (for discussion)
      if (!session.votingPool?.winnerReflectionId) {
        return badRequest('Winner not determined.');
      }

      const winner = allReflections.find(
        (r) => r.id === session.votingPool?.winnerReflectionId
      );

      return ok({
        state: 'discuss',
        winner: {
          reflectionId: session.votingPool.winnerReflectionId,
          transcription: winner?.steps
            ?.find((step) => step.label === 'See' || step.label === 'Wonder')
            ?.transcription ?? '',
        },
        discussionPrompts: [
          'What resonated with you about this response?',
          'How does this reflect our learning target?',
          'What questions do you have?',
        ],
      });
    }

    return badRequest(`Voting state "${votingState}" does not support ballot retrieval.`);
  } catch (error) {
    console.error('Error retrieving ballot:', error);
    return serverError(error);
  }
}
