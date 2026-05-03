import { describe, it, expect } from 'vitest';
import type { SessionConfig, VotingState, PeerVote, VotingPool } from './types';

describe('Voting types', () => {
  it('should allow votingState on Session', () => {
    const votingState: VotingState = 'round_1';
    expect(votingState).toBeDefined();
  });

  it('should have peerVotingEnabled in SessionConfig', () => {
    const config: SessionConfig = {
      aiFollowupsEnabled: true,
      voiceMinimumSeconds: 5,
      annotationMode: false,
      responseMode: 'choice',
      showTranscription: true,
      studentResultsVisibility: 'full',
      peerVotingEnabled: true,
      celebrationAnimationEnabled: false,
    };
    expect(config.peerVotingEnabled).toBe(true);
  });

  it('should allow PeerVote records', () => {
    const vote: PeerVote = {
      id: 'vote-1',
      sessionId: 'session-1',
      voterStudentId: 'student-1',
      round: 1,
      votedForReflectionId: 'reflection-1',
      createdAt: new Date(),
    };
    expect(vote.round).toBe(1);
  });

  it('should create VotingPool records', () => {
    const pool: VotingPool = {
      eligibleReflectionIds: ['r1', 'r2'],
      excludedByRedAlertIds: [],
      excludedByAmberAlertIds: [],
    };
    expect(pool.eligibleReflectionIds).toHaveLength(2);
  });
});
