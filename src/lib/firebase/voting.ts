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
): VotingPool {
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
    excludedByAmberAlertIds: amberIds,
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
): string[] {
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

  return finalists.map((f) => f.reflectionId);
}

/**
 * Generate a randomized sample of responses for a round-1 ballot.
 * Ensures deterministic shuffle based on sessionId and voterStudentId.
 * Excludes the voter's own response from the sample.
 * Uses Fisher-Yates algorithm for uniform distribution.
 */
export function generateBallotSample(
  eligibleIds: string[],
  sessionId: string,
  voterStudentId: string,
  classSize: number,
  voterReflectionId?: string
): string[] {
  const sampleSize = classSize <= 7 ? 3 : 4;

  // Filter out voter's own response if provided
  const filteredIds = voterReflectionId
    ? eligibleIds.filter((id) => id !== voterReflectionId)
    : eligibleIds;

  // Compute seed from sessionId and voterStudentId
  const seedString = `${sessionId}-${voterStudentId}`;
  let seed = 0;
  for (let i = 0; i < seedString.length; i++) {
    seed = ((seed << 5) - seed) + seedString.charCodeAt(i);
    seed = seed | 0; // Convert to 32-bit integer
  }

  // Fisher-Yates shuffle using seeded RNG
  const shuffled = [...filteredIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    seed = ((seed * 1103515245 + 12345) >>> 0) % (2 ** 31);
    const j = Math.floor((seed / (2 ** 31)) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, Math.min(sampleSize, filteredIds.length));
}
