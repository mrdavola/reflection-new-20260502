/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as POST_START } from '@/app/api/session/[sessionId]/voting/start/route';
import { POST as POST_RESOLVE_AMBER } from '@/app/api/session/[sessionId]/voting/resolve-amber/route';
import { GET as GET_BALLOT } from '@/app/api/session/[sessionId]/voting/ballot/route';
import { POST as POST_VOTE } from '@/app/api/session/[sessionId]/voting/vote/route';
import { POST as POST_ADVANCE } from '@/app/api/session/[sessionId]/voting/advance/route';
import type { Session, Reflection } from '@/lib/models';
import type { ReflectionStep } from '@/lib/types';

// Mock the dependencies
vi.mock('@/lib/server/store', () => ({
  getSession: vi.fn(),
  updateSession: vi.fn(),
  getDbOrThrowForProd: vi.fn(),
}));

vi.mock('@/lib/server/auth', () => ({
  requireTeacherSession: vi.fn(),
  assertParticipantTokenForReflection: vi.fn(),
}));

vi.mock('@/lib/server/firebase-admin', () => ({
  getAdminDb: vi.fn(),
}));

vi.mock('@/lib/safety', () => ({
  classifyTranscriptSafety: vi.fn(),
}));

vi.mock('@/lib/firebase/voting', () => ({
  buildVotingPool: vi.fn(),
  aggregateVotes: vi.fn((votes) => {
    const counts: Record<string, number> = {};
    votes.forEach((vote: Record<string, unknown>) => {
      // Handle both formats: votedForReflectionId (from DB) and reflectionId (from route)
      const reflectionId = vote.reflectionId || vote.votedForReflectionId;
      counts[reflectionId as string] = (counts[reflectionId as string] || 0) + 1;
    });
    return counts;
  }),
  selectFinalists: vi.fn((voteCounts, classSize) => {
    const targetCount = classSize <= 7 ? 3 : 4;
    const sorted = Object.entries(voteCounts)
      .map(([reflectionId, voteCount]) => ({ reflectionId, voteCount: voteCount as number }))
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
  }),
  generateBallotSample: vi.fn((eligibleIds, sessionId, participantId, classSize, ownReflectionId) => {
    const filtered = ownReflectionId ? eligibleIds.filter((id: string) => id !== ownReflectionId) : eligibleIds;
    const count = Math.min(Math.max(3, Math.ceil(classSize / 2)), 4);
    return filtered.slice(0, count);
  }),
}));

vi.mock('@/lib/routines', () => ({
  getRoutine: vi.fn(),
}));

vi.mock('@/lib/server/http', () => ({
  ok: vi.fn((data) => ({ status: 200, json: async () => data })),
  badRequest: vi.fn((msg) => ({ status: 400, json: async () => ({ error: msg }) })),
  unauthorized: vi.fn((msg) => ({ status: 401, json: async () => ({ error: msg }) })),
  forbidden: vi.fn((msg) => ({ status: 403, json: async () => ({ error: msg }) })),
  notFound: vi.fn((msg) => ({ status: 404, json: async () => ({ error: msg }) })),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  serverError: vi.fn((_err) => ({ status: 500, json: async () => ({ error: 'Server error' }) })),
}));

import { getSession, updateSession, getDbOrThrowForProd } from '@/lib/server/store';
import { requireTeacherSession, assertParticipantTokenForReflection } from '@/lib/server/auth';
import { classifyTranscriptSafety } from '@/lib/safety';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { buildVotingPool, aggregateVotes, selectFinalists, generateBallotSample } from '@/lib/firebase/voting';
import { getRoutine } from '@/lib/routines';

describe('Voting Integration – Full Flow', () => {
  const sessionId = 'integration-test-session';
  const teacherId = 'test-teacher';
  const studentIds = ['student1', 'student2', 'student3', 'student4', 'student5'];
  const tokens = {
    student1: 'token-1',
    student2: 'token-2',
    student3: 'token-3',
    student4: 'token-4',
    student5: 'token-5',
  };

  // Reflection IDs with safety flags: 2 red, 3 amber, 5 clean
  const reflectionIds = {
    red1: 'reflection-red-1',
    red2: 'reflection-red-2',
    amber1: 'reflection-amber-1',
    amber2: 'reflection-amber-2',
    amber3: 'reflection-amber-3',
    clean1: 'reflection-clean-1',
    clean2: 'reflection-clean-2',
    clean3: 'reflection-clean-3',
    clean4: 'reflection-clean-4',
    clean5: 'reflection-clean-5',
  };

  let mockSession: Session;
  let mockReflections: Reflection[];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let allReflectionIds: string[];
  let mockPeerVotes: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mockPeerVotes = [];

    // Initialize mock session with inactive voting state
    mockSession = {
      id: sessionId,
      teacherId,
      routineId: 'see-think-wonder',
      title: 'Integration Test Session',
      learningTarget: 'Understand voting',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
        peerVotingEnabled: true,
      },
      joinCode: 'INT123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 5,
      reflectingCount: 0,
      doneCount: 5,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'inactive',
    };

    // Create mock reflections with safety flags
    const allIds = [
      reflectionIds.red1,
      reflectionIds.red2,
      reflectionIds.amber1,
      reflectionIds.amber2,
      reflectionIds.amber3,
      reflectionIds.clean1,
      reflectionIds.clean2,
      reflectionIds.clean3,
      reflectionIds.clean4,
      reflectionIds.clean5,
    ];
    allReflectionIds = allIds;

    mockReflections = allIds.map((id, index) => ({
      id,
      sessionId,
      participantId: studentIds[index % 5],
      displayName: `Student ${(index % 5) + 1}`,
      steps: [
        {
          label: 'Wonder',
          transcription: `I wonder about thing ${index + 1}`,
        } as ReflectionStep,
      ],
      overallAnalysis: null,
      studentFeedback: null,
      contentAlerts: [],
      teacherNote: null,
      audioExpiresAt: null,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    }));

    // Setup mock auth and session retrieval
    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: teacherId } as any);
    vi.mocked(getSession).mockImplementation(async () => mockSession);
    vi.mocked(updateSession).mockImplementation(async (id, updates) => {
      mockSession = { ...mockSession, ...updates };
      return undefined;
    });

    vi.mocked(getRoutine).mockReturnValue({
      id: 'see-think-wonder',
      name: 'See Think Wonder',
      description: 'Test',
      bestForTags: [],
      config: mockSession.config,
      steps: [],
      peerVotingDefault: true,
      headlineStep: 'Wonder',
    });

    // Setup mock participant token validation
    vi.mocked(assertParticipantTokenForReflection).mockImplementation(async (input: any) => {
      const token = input.participantToken || input;
      const studentId = Object.keys(tokens).find((key) => tokens[key as keyof typeof tokens] === token);
      if (!studentId) throw new Error('Invalid token');
      return { id: studentId } as any;
    });

    // Setup mock database
    const createMockDb = () => ({
      collection: vi.fn((name: string) => {
        if (name === 'peerVotes') {
          return {
            doc: vi.fn((docId: string) => ({
              set: vi.fn().mockImplementation((data: any) => {
                mockPeerVotes.push({ id: docId, ...data });
                return Promise.resolve();
              }),
              update: vi.fn().mockImplementation((data: any) => {
                const index = mockPeerVotes.findIndex((v) => v.id === docId);
                if (index >= 0) {
                  mockPeerVotes[index] = { ...mockPeerVotes[index], ...data };
                }
                return Promise.resolve();
              }),
            })),
            where: vi.fn(function (field: string, operator: string, value: any) {
              // Return a chainable object for where queries
              return {
                where: vi.fn(function (field2: string, operator2: string, value2: any) {
                  return {
                    where: vi.fn(function (field3: string, operator3: string, value3: any) {
                      return {
                        get: vi.fn().mockResolvedValue({
                          docs: mockPeerVotes
                            .filter((v) => {
                              const match1 = v[field] === value;
                              const match2 = v[field2] === value2;
                              const match3 = v[field3] === value3;
                              return match1 && match2 && match3;
                            })
                            .map((v) => ({
                              id: v.id,
                              data: () => v,
                              ref: { update: vi.fn() },
                            })),
                          size: mockPeerVotes.filter((v) => {
                            const match1 = v[field] === value;
                            const match2 = v[field2] === value2;
                            const match3 = v[field3] === value3;
                            return match1 && match2 && match3;
                          }).length,
                        }),
                      };
                    }),
                    get: vi.fn().mockResolvedValue({
                      docs: mockPeerVotes
                        .filter((v) => {
                          const match1 = v[field] === value;
                          const match2 = v[field2] === value2;
                          return match1 && match2;
                        })
                        .map((v) => ({
                          id: v.id,
                          data: () => v,
                          ref: { update: vi.fn() },
                        })),
                      size: mockPeerVotes.filter((v) => {
                        const match1 = v[field] === value;
                        const match2 = v[field2] === value2;
                        return match1 && match2;
                      }).length,
                    }),
                  };
                }),
                get: vi.fn().mockResolvedValue({
                  docs: mockPeerVotes
                    .filter((v) => v[field] === value)
                    .map((v) => ({
                      id: v.id,
                      data: () => v,
                      ref: { update: vi.fn() },
                    })),
                  size: mockPeerVotes.filter((v) => v[field] === value).length,
                }),
              };
            }),
            get: vi.fn().mockResolvedValue({
              docs: mockPeerVotes.map((v) => ({
                id: v.id,
                data: () => v,
              })),
            }),
          };
        } else if (name === 'reflections') {
          return {
            doc: vi.fn().mockReturnValue({
              set: vi.fn().mockResolvedValue(undefined),
              update: vi.fn().mockResolvedValue(undefined),
            }),
            where: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  get: vi.fn().mockResolvedValue({ docs: [] }),
                }),
                get: vi.fn().mockResolvedValue({ docs: [] }),
              }),
              get: vi.fn().mockResolvedValue({ docs: [] }),
            }),
            get: vi.fn().mockResolvedValue({
              docs: mockReflections.map((r) => ({
                id: r.id,
                data: () => r,
              })),
            }),
          };
        } else if (name === 'sessions') {
          return {
            doc: vi.fn().mockReturnValue({
              collection: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                  docs: mockReflections.map((r) => ({
                    id: r.id,
                    data: () => r,
                  })),
                }),
              }),
            }),
          };
        }
      }),
    });
    vi.mocked(getDbOrThrowForProd).mockImplementation(() => createMockDb() as any);
  });

  it('should complete full voting flow: start → amber → round1 → finals → reveal', async () => {
    // ============================================
    // STEP 1: Verify initial state
    // ============================================
    expect(mockSession.votingState).toBe('inactive');

    // ============================================
    // STEP 2: Start voting
    // ============================================
    vi.mocked(buildVotingPool).mockReturnValue({
      eligibleReflectionIds: [
        reflectionIds.amber1,
        reflectionIds.amber2,
        reflectionIds.amber3,
        reflectionIds.clean1,
        reflectionIds.clean2,
        reflectionIds.clean3,
        reflectionIds.clean4,
        reflectionIds.clean5,
      ],
      excludedByRedAlertIds: [reflectionIds.red1, reflectionIds.red2],
      excludedByAmberAlertIds: [reflectionIds.amber1, reflectionIds.amber2, reflectionIds.amber3],
    });

    vi.mocked(classifyTranscriptSafety).mockImplementation((text) => {
      if (text.includes('thing 1') || text.includes('thing 2')) {
        return { category: 'harmful', message: 'Contains harmful content', severity: 'red' };
      }
      if (text.includes('thing 3') || text.includes('thing 4') || text.includes('thing 5')) {
        return { category: 'potentially_harmful', message: 'Review needed', severity: 'amber' };
      }
      return null;
    });

    const startRequest = new Request(`http://localhost/api/session/${sessionId}/voting/start`, {
      method: 'POST',
      body: JSON.stringify({ teacherId }),
    });

    const startResponse = await POST_START(startRequest, { params: { sessionId } } as any);
    expect(startResponse.status).toBe(200);

    const startBody = await startResponse.json();
    expect(mockSession.votingState).toBe('review_pending');
    expect(mockSession.votingPool?.excludedByRedAlertIds).toEqual([reflectionIds.red1, reflectionIds.red2]);
    expect(mockSession.votingPool?.excludedByAmberAlertIds).toEqual([]);

    const amberIds = startBody.amberFlaggedResponses.map((r: any) => r.id);
    expect(amberIds).toHaveLength(3);

    // ============================================
    // STEP 3: Resolve amber (include 2, exclude 1)
    // ============================================
    const resolveRequest = new Request(
      `http://localhost/api/session/${sessionId}/voting/resolve-amber`,
      {
        method: 'POST',
        body: JSON.stringify({
          amber: [
            { reflectionId: amberIds[0], decision: 'include' },
            { reflectionId: amberIds[1], decision: 'include' },
            { reflectionId: amberIds[2], decision: 'exclude' },
          ],
        }),
      }
    );

    const resolveResponse = await POST_RESOLVE_AMBER(resolveRequest, { params: { sessionId } } as any);
    expect(resolveResponse.status).toBe(200);

    const resolveBody = await resolveResponse.json();
    expect(resolveBody.advancedTo).toBe('round_1');
    expect(mockSession.votingState).toBe('round_1');
    expect(mockSession.votingPool?.excludedByAmberAlertIds).toContain(amberIds[2]);

    // ============================================
    // STEP 4: Get ballots to verify round 1 ballot structure
    // ============================================
    for (const studentId of studentIds) {
      const studentToken = tokens[studentId as keyof typeof tokens];
      const ballotRequest = new Request(
        `http://localhost/api/session/${sessionId}/voting/ballot?token=${studentToken}`,
        { method: 'GET' }
      );

      const ballotResponse = await GET_BALLOT(ballotRequest, {
        params: Promise.resolve({ sessionId }),
      } as any);
      expect(ballotResponse.status).toBe(200);

      const ballotBody = await ballotResponse.json();
      expect(ballotBody.round).toBe(1);
      expect(ballotBody.ballot.length).toBeGreaterThanOrEqual(3);
      expect(ballotBody.ballot.length).toBeLessThanOrEqual(4);
    }

    // ============================================
    // STEP 5: Round 1 voting - students vote
    // ============================================
    // Actual ballots (from generateBallotSample):
    // student1: [amber1, amber2, clean1]
    // student2: [amber1, amber2, clean1]
    // student3: [amber2, clean1, clean2]
    // student4: [amber1, clean1, clean2]
    // student5: [amber1, amber2, clean1]
    // Vote pattern: all students vote for clean1 (round 1)
    const round1Votes = {
      student1: reflectionIds.clean1,
      student2: reflectionIds.clean1,
      student3: reflectionIds.clean1,
      student4: reflectionIds.clean1,
      student5: reflectionIds.clean1,
    };

    for (const [studentId, reflectionId] of Object.entries(round1Votes)) {
      const studentToken = tokens[studentId as keyof typeof tokens];
      const voteRequest = new Request(
        `http://localhost/api/session/${sessionId}/voting/vote?token=${studentToken}`,
        {
          method: 'POST',
          body: JSON.stringify({ reflectionId }),
        }
      );

      const voteResponse = await POST_VOTE(voteRequest, { params: Promise.resolve({ sessionId }) } as any);
      expect(voteResponse.status).toBe(200);

      const voteBody = await voteResponse.json();
      expect(voteBody.success).toBe(true);
      expect(voteBody.round).toBe(1);
      expect(voteBody.voteCount).toBeGreaterThan(0);
    }

    // ============================================
    // STEP 6: Advance from round 1 to finals
    // ============================================
    vi.mocked(selectFinalists).mockReturnValue([reflectionIds.clean1, reflectionIds.clean2, reflectionIds.amber1]);

    const advanceToFinalsRequest = new Request(
      `http://localhost/api/session/${sessionId}/voting/advance`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'round_1_to_finals' }),
      }
    );

    // Mock teacher auth for this request
    vi.mocked(requireTeacherSession).mockResolvedValueOnce({ uid: teacherId } as any);

    const advanceToFinalsResponse = await POST_ADVANCE(advanceToFinalsRequest, {
      params: Promise.resolve({ sessionId }),
    } as any);
    expect(advanceToFinalsResponse.status).toBe(200);

    const advanceToFinalsBody = await advanceToFinalsResponse.json();
    expect(advanceToFinalsBody.advanced).toBe(true);
    expect(advanceToFinalsBody.action).toBe('finals');
    expect(advanceToFinalsBody.finalists).toBeGreaterThan(0);
    expect(mockSession.votingState).toBe('finals');
    expect(mockSession.votingPool?.finalistReflectionIds).toEqual([
      reflectionIds.clean1,
      reflectionIds.clean2,
      reflectionIds.amber1,
    ]);

    // ============================================
    // STEP 7: Get finalists ballots to verify round 2 structure
    // ============================================
    for (const studentId of studentIds) {
      const studentToken = tokens[studentId as keyof typeof tokens];
      const ballotRequest = new Request(
        `http://localhost/api/session/${sessionId}/voting/ballot?token=${studentToken}`,
        { method: 'GET' }
      );

      const ballotResponse = await GET_BALLOT(ballotRequest, {
        params: Promise.resolve({ sessionId }),
      } as any);
      expect(ballotResponse.status).toBe(200);

      const ballotBody = await ballotResponse.json();
      expect(ballotBody.round).toBe(2);
      expect(ballotBody.ballot.length).toBeLessThanOrEqual(4);
    }

    // ============================================
    // STEP 8: Finals voting - all students vote for clean1
    // ============================================
    // Finals finalists should be [clean1, clean2, amber1] from selectFinalists mock
    // All students vote for clean1 (spec requirement)
    const finalsVotes = {
      student1: reflectionIds.clean1,
      student2: reflectionIds.clean1,
      student3: reflectionIds.clean1,
      student4: reflectionIds.clean1,
      student5: reflectionIds.clean1,
    };

    for (const [studentId, reflectionId] of Object.entries(finalsVotes)) {
      const studentToken = tokens[studentId as keyof typeof tokens];
      const voteRequest = new Request(
        `http://localhost/api/session/${sessionId}/voting/vote?token=${studentToken}`,
        {
          method: 'POST',
          body: JSON.stringify({ reflectionId }),
        }
      );

      const voteResponse = await POST_VOTE(voteRequest, { params: Promise.resolve({ sessionId }) } as any);
      expect(voteResponse.status).toBe(200);

      const voteBody = await voteResponse.json();
      expect(voteBody.success).toBe(true);
      expect(voteBody.round).toBe(2);
      expect(voteBody.voteCount).toBeGreaterThan(0);
    }

    // ============================================
    // STEP 9: Advance from finals to reveal
    // ============================================
    const advanceToRevealRequest = new Request(
      `http://localhost/api/session/${sessionId}/voting/advance`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'finals_to_reveal' }),
      }
    );

    // Mock teacher auth for this request
    vi.mocked(requireTeacherSession).mockResolvedValueOnce({ uid: teacherId } as any);

    const advanceToRevealResponse = await POST_ADVANCE(advanceToRevealRequest, {
      params: Promise.resolve({ sessionId }),
    } as any);
    expect(advanceToRevealResponse.status).toBe(200);

    const advanceToRevealBody = await advanceToRevealResponse.json();
    expect(advanceToRevealBody.advanced).toBe(true);
    expect(advanceToRevealBody.action).toBe('reveal');
    expect(advanceToRevealBody.winner).toBeDefined();
    expect(advanceToRevealBody.winner.reflectionId).toBe(reflectionIds.clean1);
    expect(advanceToRevealBody.winner.voteCount).toBe(5);
    expect(advanceToRevealBody.rankedTop3).toBeDefined();
    // rankedTop3 includes all reflections that received votes, up to 3
    // Since only clean1 received votes, length is 1
    expect(advanceToRevealBody.rankedTop3.length).toBeGreaterThan(0);
    expect(advanceToRevealBody.rankedTop3.length).toBeLessThanOrEqual(3);
    expect(mockSession.votingState).toBe('reveal');
    expect(mockSession.votingPool?.winnerReflectionId).toBe(reflectionIds.clean1);

    // ============================================
    // STEP 10: Verify ballot shows winner + rankings
    // ============================================
    const ballotRevealRequest = new Request(
      `http://localhost/api/session/${sessionId}/voting/ballot?token=${tokens.student1}`,
      { method: 'GET' }
    );

    const ballotRevealResponse = await GET_BALLOT(ballotRevealRequest, {
      params: Promise.resolve({ sessionId }),
    } as any);
    expect(ballotRevealResponse.status).toBe(200);

    const ballotRevealBody = await ballotRevealResponse.json();
    expect(ballotRevealBody.state).toBe('reveal');
    expect(ballotRevealBody.winner).toBeDefined();
    expect(ballotRevealBody.winner.reflectionId).toBe(reflectionIds.clean1);
    expect(ballotRevealBody.winner.voteCount).toBe(5);
    expect(ballotRevealBody.rankedTop3).toBeDefined();
    // rankedTop3 includes all reflections that received votes, up to 3
    expect(ballotRevealBody.rankedTop3.length).toBeGreaterThan(0);
    expect(ballotRevealBody.rankedTop3.length).toBeLessThanOrEqual(3);
  });
});
