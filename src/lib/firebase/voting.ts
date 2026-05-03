import type { SafetyAlert, VotingPool } from '../types';

export interface ResponseWithAlerts {
  id: string;
  alerts: SafetyAlert[];
}

/**
 * Build the voting pool by filtering out red-flagged responses
 * and separating amber-flagged responses for teacher review.
 */
export function buildVotingPool(
  responses: ResponseWithAlerts[]
): VotingPool & { amberFlaggedIds: string[] } {
  const redIds: string[] = [];
  const amberIds: string[] = [];
  const eligibleIds: string[] = [];

  for (const response of responses) {
    const hasRed = response.alerts.some((a) => a.severity === 'red');
    const hasAmber = response.alerts.some((a) => a.severity === 'amber');

    if (hasRed) {
      redIds.push(response.id);
    } else if (hasAmber) {
      amberIds.push(response.id);
      eligibleIds.push(response.id);
    } else {
      eligibleIds.push(response.id);
    }
  }

  return {
    eligibleReflectionIds: eligibleIds,
    excludedByRedAlertIds: redIds,
    excludedByAmberAlertIds: [],
    amberFlaggedIds: amberIds,
  };
}

/**
 * Aggregate votes by reflection ID for a specific round.
 */
export function aggregateVotes(
  votes: Array<{ reflectionId: string; round: number }>,
  round: 1 | 2
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const vote of votes) {
    if (vote.round === round) {
      counts[vote.reflectionId] = (counts[vote.reflectionId] || 0) + 1;
    }
  }

  return counts;
}

/**
 * Select finalist responses based on vote counts.
 * Returns up to 4 for large classes (8+), 3 for small (5-7).
 * Handles ties by including all tied responses.
 */
export function selectFinalists(
  voteCounts: Record<string, number>,
  classSize: number
): Array<{ reflectionId: string; voteCount: number }> {
  const targetCount = classSize <= 7 ? 3 : 4;

  const sorted = Object.entries(voteCounts)
    .map(([reflectionId, voteCount]) => ({ reflectionId, voteCount }))
    .sort((a, b) => b.voteCount - a.voteCount);

  const finalists: Array<{ reflectionId: string; voteCount: number }> = [];
  let previousVoteCount = -1;

  for (const candidate of sorted) {
    if (finalists.length < targetCount) {
      finalists.push(candidate);
      previousVoteCount = candidate.voteCount;
    } else if (candidate.voteCount === previousVoteCount) {
      finalists.push(candidate);
    } else {
      break;
    }
  }

  return finalists;
}

/**
 * Generate a randomized sample of responses for a round-1 ballot.
 * Ensures deterministic shuffle based on sessionId and voterStudentId.
 */
export function generateBallotSample(
  eligibleIds: string[],
  sessionId: string,
  voterStudentId: string,
  classSize: number
): string[] {
  const sampleSize = classSize <= 7 ? 3 : 4;

  const shuffled = [...eligibleIds].sort(() => {
    const seed = `${sessionId}-${voterStudentId}`.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);
    return (seed * Math.random()) % 2 > 1 ? 1 : -1;
  });

  return shuffled.slice(0, Math.min(sampleSize, eligibleIds.length));
}
