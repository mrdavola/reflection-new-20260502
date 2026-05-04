import { requireTeacherSession } from '@/lib/server/auth';
import { getSession, getDbOrThrowForProd } from '@/lib/server/store';
import { ok, badRequest, serverError, notFound, forbidden } from '@/lib/server/http';
import { aggregateVotes } from '@/lib/firebase/voting';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const auth = await requireTeacherSession(request);
    const session = await getSession(sessionId);
    if (!session) return notFound('Session not found.');

    // Check authorization
    if (auth.uid !== session.teacherId) {
      return forbidden('You do not have access to this session.');
    }

    const votingState = session.votingState ?? 'inactive';
    const db = getDbOrThrowForProd();
    if (!db) {
      return badRequest('Live voting data not available in demo mode.');
    }

    // Determine which round to aggregate
    let round: 1 | 2;
    if (votingState === 'round_1') {
      round = 1;
    } else if (votingState === 'finals') {
      round = 2;
    } else if (votingState === 'reveal' || votingState === 'discuss') {
      // Return locked final results from top 3
      const rankedTop3 = session.votingPool?.rankedTop3 ?? [];
      const voteCounts: Record<string, number> = {};
      rankedTop3.forEach((item) => {
        voteCounts[item.reflectionId] = item.voteCount;
      });

      const participantsSnapshot = await db
        .collection('sessions')
        .doc(sessionId)
        .collection('participants')
        .get();
      const participatingStudents = participantsSnapshot.size;

      // Count actual distinct voters from round 2
      const allVotes = await db
        .collection('peerVotes')
        .where('sessionId', '==', sessionId)
        .where('round', '==', 2)
        .get();
      const studentsWhoVoted = allVotes.size;

      return ok({
        votingState,
        round: 2,
        voteCounts,
        participatingStudents,
        studentsWhoVoted,
        isComplete: true,
      });
    } else {
      // inactive, review_pending, etc.
      return ok({
        votingState,
        round: 0,
        voteCounts: {},
        participatingStudents: 0,
        studentsWhoVoted: 0,
        isComplete: false,
      });
    }

    // Aggregate current round's votes
    const startTime = Date.now();

    const votesSnapshot = await db
      .collection('peerVotes')
      .where('sessionId', '==', sessionId)
      .where('round', '==', round)
      .get();

    const votes = votesSnapshot.docs.map((doc) => ({
      reflectionId: doc.data().votedForReflectionId as string,
      round: round as 1 | 2,
    }));

    const voteCounts = aggregateVotes(votes, round);

    // Get participating students count
    const participantsSnapshot = await db
      .collection('sessions')
      .doc(sessionId)
      .collection('participants')
      .get();
    const participatingStudents = participantsSnapshot.size;

    // Get unique voters in current round
    const uniqueVoters = new Set(
      votesSnapshot.docs.map((doc) => doc.data().voterStudentId)
    ).size;

    const elapsed = Date.now() - startTime;

    // Log if slow
    if (elapsed > 500) {
      console.warn(
        `Live voting aggregation for session ${sessionId} took ${elapsed}ms (target: <500ms)`
      );
    }

    return ok({
      votingState,
      round,
      voteCounts,
      participatingStudents,
      studentsWhoVoted: uniqueVoters,
      isComplete: false,
    });
  } catch (error) {
    console.error('Error fetching live voting data:', error);
    return serverError(error);
  }
}
