import { z } from 'zod';
import { assertParticipantTokenForReflection } from '@/lib/server/auth';
import { getSession, getDbOrThrowForProd } from '@/lib/server/store';
import { ok, badRequest, serverError, notFound, forbidden } from '@/lib/server/http';
import type { PeerVote } from '@/lib/types';

const VoteSchema = z.object({
  reflectionId: z.string().min(1),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const token = new URL(request.url).searchParams.get('token') ?? '';

    if (!token) {
      return forbidden('Authentication required.');
    }

    // Verify student is in session
    let participant;
    try {
      participant = await assertParticipantTokenForReflection({
        sessionId,
        participantToken: token,
      });
    } catch {
      return forbidden('Invalid or expired token.');
    }

    const body = VoteSchema.safeParse(await request.json());
    if (!body.success) return badRequest('Invalid request payload.');

    const session = await getSession(sessionId);
    if (!session) return notFound('Session not found.');

    const votingState = session.votingState ?? 'inactive';

    // Only allow voting in round_1 or finals
    if (votingState !== 'round_1' && votingState !== 'finals') {
      return badRequest(
        `Cannot vote in state "${votingState}". Voting is only allowed in round_1 or finals.`
      );
    }

    const round = votingState === 'round_1' ? 1 : 2;
    const reflectionId = body.data.reflectionId;

    // Get student's own reflection ID
    const db = getDbOrThrowForProd();
    if (!db) {
      return badRequest('Voting is not available in demo mode.');
    }

    const reflectionsSnapshot = await db
      .collection('sessions')
      .doc(sessionId)
      .collection('reflections')
      .get();

    const allReflectionIds = reflectionsSnapshot.docs.map((doc) => doc.id);
    const studentReflectionId = reflectionsSnapshot.docs
      .find((doc) => {
        const reflection = doc.data() as any;
        return reflection.participantId === participant.id;
      })
      ?.id;

    // Check if voting for own response
    if (reflectionId === studentReflectionId) {
      return badRequest('Cannot vote for your own response.');
    }

    // Verify reflectionId is valid and in eligible ballot
    if (!allReflectionIds.includes(reflectionId)) {
      return badRequest('Reflection not found.');
    }

    // Verify reflection is in current eligible set
    if (!session.votingPool) {
      return badRequest('Voting pool not initialized.');
    }

    const isEligible =
      session.votingPool.eligibleReflectionIds.includes(reflectionId) &&
      !session.votingPool.excludedByAmberAlertIds?.includes(reflectionId);

    if (round === 1 && !isEligible) {
      return badRequest('Reflection is not eligible for voting in round 1.');
    }

    if (round === 2 && !session.votingPool.finalistReflectionIds?.includes(reflectionId)) {
      return badRequest('Reflection is not a finalist.');
    }

    // Record vote - create or update PeerVote
    const votesCollection = db.collection('peerVotes');
    const query = votesCollection
      .where('sessionId', '==', sessionId)
      .where('voterStudentId', '==', participant.id)
      .where('round', '==', round);

    const existingVotes = await query.get();
    const now = new Date();

    let voteCount = 1;
    if (existingVotes.size > 0) {
      // Update existing vote
      const existingVote = existingVotes.docs[0];
      await existingVote.ref.update({
        votedForReflectionId: reflectionId,
        createdAt: now,
      });
    } else {
      // Create new vote
      const voteId = `vote_${sessionId}_${participant.id}_${round}`;
      const newVote: PeerVote = {
        id: voteId,
        sessionId,
        voterStudentId: participant.id,
        round,
        votedForReflectionId: reflectionId,
        createdAt: now,
      };
      await votesCollection.doc(voteId).set(newVote);
    }

    // Get updated vote count for the voted reflection
    const allVotesForRound = await votesCollection
      .where('sessionId', '==', sessionId)
      .where('round', '==', round)
      .where('votedForReflectionId', '==', reflectionId)
      .get();

    voteCount = allVotesForRound.size;

    return ok({
      success: true,
      round,
      voteCount,
    });
  } catch (error) {
    console.error('Error recording vote:', error);
    return serverError(error);
  }
}
