import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as POST_START } from '../start/route';
import { POST as POST_RESOLVE_AMBER } from '../resolve-amber/route';
import { GET as GET_BALLOT } from '../ballot/route';
import { POST as POST_VOTE } from '../vote/route';
import { POST as POST_ADVANCE } from '../advance/route';
import { GET as GET_LIVE } from '../live/route';
import type { SafetyAlert, ReflectionStep } from '@/lib/types';
import type { Session, Reflection } from '@/lib/models';

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
    votes.forEach((vote: any) => {
      counts[vote.reflectionId] = (counts[vote.reflectionId] || 0) + 1;
    });
    return counts;
  }),
  generateBallotSample: vi.fn((eligibleIds, sessionId, participantId, classSize, studentReflectionId) => {
    // Return 3-4 random samples excluding own reflection
    const filtered = eligibleIds.filter((id: string) => id !== studentReflectionId);
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
  serverError: vi.fn((err) => ({ status: 500, json: async () => ({ error: 'Server error' }) })),
}));

import { getSession, updateSession, getDbOrThrowForProd } from '@/lib/server/store';
import { requireTeacherSession } from '@/lib/server/auth';
import { getAdminDb } from '@/lib/server/firebase-admin';
import { classifyTranscriptSafety } from '@/lib/safety';
import { buildVotingPool, generateBallotSample } from '@/lib/firebase/voting';
import { getRoutine } from '@/lib/routines';
import { ok, badRequest, unauthorized, notFound, forbidden, serverError } from '@/lib/server/http';
import { assertParticipantTokenForReflection } from '@/lib/server/auth';

describe('POST /api/session/[sessionId]/voting/start', () => {
  const sessionId = 'test-session-1';
  const teacherId = 'test-teacher-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 403 when teacher does not own the session', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId: 'different-teacher',
      routineId: 'see-think-wonder',
      title: 'Test Session',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
    };

    vi.mocked(requireTeacherSession).mockResolvedValue(undefined);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    const request = new Request('http://localhost/api/session/test-session-1/voting/start', {
      method: 'POST',
      body: JSON.stringify({ teacherId }),
    });

    const response = await POST_START(request, { params: { sessionId } } as any);
    expect(response.status).toBe(403);
  });

  it('should return 200 with skipped: true when fewer than 5 reflections', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId,
      routineId: 'see-think-wonder',
      title: 'Test Session',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 3,
      reflectingCount: 0,
      doneCount: 3,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
    };

    vi.mocked(requireTeacherSession).mockResolvedValue(undefined);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    const request = new Request('http://localhost/api/session/test-session-1/voting/start', {
      method: 'POST',
      body: JSON.stringify({ teacherId }),
    });

    const response = await POST_START(request, { params: { sessionId } } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.skipped).toBe(true);
  });

  it('should build voting pool and return amber-flagged responses', async () => {
    const reflectionIds = Array.from({ length: 8 }, (_, i) => `reflection-${i + 1}`);

    const mockSession: Session = {
      id: sessionId,
      teacherId,
      routineId: 'see-think-wonder',
      title: 'Test Session',
      learningTarget: '',
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
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
    };

    const mockReflections: Reflection[] = reflectionIds.map((id, index) => ({
      id,
      sessionId,
      participantId: `student-${index + 1}`,
      displayName: `Student ${index + 1}`,
      steps: [
        {
          label: 'Wonder',
          transcription: `I wonder about thing ${index}`,
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

    vi.mocked(requireTeacherSession).mockResolvedValue(undefined);
    vi.mocked(getSession).mockResolvedValue(mockSession);
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

    const mockDb = {
      collection: vi.fn().mockReturnThis(),
      doc: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({
        docs: mockReflections.map((r) => ({
          id: r.id,
          data: () => r,
        })),
      }),
    };
    vi.mocked(getDbOrThrowForProd).mockReturnValue(mockDb as any);

    vi.mocked(classifyTranscriptSafety).mockReturnValue({
      category: 'inappropriate_language',
      message: 'Contains inappropriate language',
    });

    vi.mocked(buildVotingPool).mockReturnValue({
      eligibleReflectionIds: reflectionIds.slice(0, 6),
      excludedByRedAlertIds: ['reflection-7'],
      excludedByAmberAlertIds: ['reflection-8'],
    });

    const request = new Request('http://localhost/api/session/test-session-1/voting/start', {
      method: 'POST',
      body: JSON.stringify({ teacherId }),
    });

    const response = await POST_START(request, { params: { sessionId } } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.amberFlaggedResponses).toBeDefined();
    expect(body.totalEligible).toBe(6);
    expect(updateSession).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        votingState: 'review_pending',
      })
    );
  });

  it('should skip voting when voting is explicitly disabled', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId,
      routineId: 'see-think-wonder',
      title: 'Test Session',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
        peerVotingEnabled: false,
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
    };

    vi.mocked(requireTeacherSession).mockResolvedValue(undefined);
    vi.mocked(getSession).mockResolvedValue(mockSession);
    vi.mocked(getRoutine).mockReturnValue({
      id: 'see-think-wonder',
      name: 'See Think Wonder',
      description: 'Test',
      bestForTags: [],
      config: mockSession.config,
      steps: [],
      peerVotingDefault: true,
    });

    const request = new Request('http://localhost/api/session/test-session-1/voting/start', {
      method: 'POST',
      body: JSON.stringify({ teacherId }),
    });

    const response = await POST_START(request, { params: { sessionId } } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.skipped).toBe(true);
  });

  it('should handle missing headline step gracefully', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId,
      routineId: 'custom-routine',
      title: 'Test Session',
      learningTarget: '',
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
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
    };

    vi.mocked(requireTeacherSession).mockResolvedValue(undefined);
    vi.mocked(getSession).mockResolvedValue(mockSession);
    vi.mocked(getRoutine).mockReturnValue({
      id: 'custom-routine',
      name: 'Custom Routine',
      description: 'Test',
      bestForTags: [],
      config: mockSession.config,
      steps: [],
      peerVotingDefault: true,
    });

    const request = new Request('http://localhost/api/session/test-session-1/voting/start', {
      method: 'POST',
      body: JSON.stringify({ teacherId }),
    });

    const response = await POST_START(request, { params: { sessionId } } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.skipped).toBe(true);
  });

  it('should build voting pool with zero amber flags when no responses are flagged', async () => {
    const reflectionIds = Array.from({ length: 8 }, (_, i) => `reflection-${i + 1}`);

    const mockSession: Session = {
      id: sessionId,
      teacherId,
      routineId: 'see-think-wonder',
      title: 'Test Session',
      learningTarget: '',
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
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
    };

    const mockReflections: Reflection[] = reflectionIds.map((id, index) => ({
      id,
      sessionId,
      participantId: `student-${index + 1}`,
      displayName: `Student ${index + 1}`,
      steps: [
        {
          label: 'Wonder',
          transcription: `I wonder about thing ${index}`,
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

    vi.mocked(requireTeacherSession).mockResolvedValue(undefined);
    vi.mocked(getSession).mockResolvedValue(mockSession);
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

    const mockDb = {
      collection: vi.fn().mockReturnThis(),
      doc: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({
        docs: mockReflections.map((r) => ({
          id: r.id,
          data: () => r,
        })),
      }),
    };
    vi.mocked(getDbOrThrowForProd).mockReturnValue(mockDb as any);

    vi.mocked(classifyTranscriptSafety).mockReturnValue(null);

    vi.mocked(buildVotingPool).mockReturnValue({
      eligibleReflectionIds: reflectionIds,
      excludedByRedAlertIds: [],
      excludedByAmberAlertIds: [],
    });

    const request = new Request('http://localhost/api/session/test-session-1/voting/start', {
      method: 'POST',
      body: JSON.stringify({ teacherId }),
    });

    const response = await POST_START(request, { params: { sessionId } } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.amberFlaggedResponses).toHaveLength(0);
    expect(body.totalEligible).toBe(8);
    expect(updateSession).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        votingState: 'review_pending',
        votingPool: expect.objectContaining({
          eligibleReflectionIds: reflectionIds,
          excludedByAmberAlertIds: [],
        }),
      })
    );
  });
});

describe('POST /api/session/[sessionId]/voting/resolve-amber', () => {
  const sessionId = 'test-session-amber';
  const teacherId = 'test-teacher-amber';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 403 when teacher does not own the session', async () => {
    const sessionOwnerTeacherId = 'session-owner';
    const mockSession: Session = {
      id: sessionId,
      teacherId: sessionOwnerTeacherId,
      routineId: 'see-think-wonder',
      title: 'Test Session',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'review_pending',
      votingPool: {
        eligibleReflectionIds: ['reflection-1', 'reflection-2', 'reflection-3'],
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: ['reflection-4'],
      },
    };

    // Mock a different teacher (not the session owner) making the request
    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: 'different-teacher' } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    const request = new Request('http://localhost/api/session/test-session-amber/voting/resolve-amber', {
      method: 'POST',
      body: JSON.stringify({ amber: [{ reflectionId: 'reflection-4', decision: 'exclude' }] }),
    });

    const response = await POST_RESOLVE_AMBER(request, { params: { sessionId } } as any);
    expect(response.status).toBe(403);
  });

  it('should return 404 when session not found', async () => {
    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: teacherId } as any);
    vi.mocked(getSession).mockResolvedValue(null);

    const request = new Request('http://localhost/api/session/test-session-amber/voting/resolve-amber', {
      method: 'POST',
      body: JSON.stringify({ amber: [{ reflectionId: 'reflection-4', decision: 'exclude' }] }),
    });

    const response = await POST_RESOLVE_AMBER(request, { params: { sessionId } } as any);
    expect(response.status).toBe(404);
  });

  it('should return 400 when votingState is not review_pending', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId,
      routineId: 'see-think-wonder',
      title: 'Test Session',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'round_1',
      votingPool: {
        eligibleReflectionIds: ['reflection-1', 'reflection-2', 'reflection-3'],
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: ['reflection-4'],
      },
    };

    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: teacherId } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    const request = new Request('http://localhost/api/session/test-session-amber/voting/resolve-amber', {
      method: 'POST',
      body: JSON.stringify({ amber: [{ reflectionId: 'reflection-4', decision: 'exclude' }] }),
    });

    const response = await POST_RESOLVE_AMBER(request, { params: { sessionId } } as any);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('review_pending');
  });

  it('should return 400 when payload is malformed (missing decision)', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId,
      routineId: 'see-think-wonder',
      title: 'Test Session',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'review_pending',
      votingPool: {
        eligibleReflectionIds: ['reflection-1', 'reflection-2', 'reflection-3', 'reflection-4'],
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: [],
      },
    };

    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: teacherId } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    const request = new Request('http://localhost/api/session/test-session-amber/voting/resolve-amber', {
      method: 'POST',
      body: JSON.stringify({ amber: [{ reflectionId: 'reflection-4' }] }),
    });

    const response = await POST_RESOLVE_AMBER(request, { params: { sessionId } } as any);
    expect(response.status).toBe(400);
  });

  it('should return 400 when payload contains invalid decision value', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId,
      routineId: 'see-think-wonder',
      title: 'Test Session',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'review_pending',
      votingPool: {
        eligibleReflectionIds: ['reflection-1', 'reflection-2', 'reflection-3', 'reflection-4'],
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: [],
      },
    };

    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: teacherId } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    const request = new Request('http://localhost/api/session/test-session-amber/voting/resolve-amber', {
      method: 'POST',
      body: JSON.stringify({ amber: [{ reflectionId: 'reflection-4', decision: 'maybe' }] }),
    });

    const response = await POST_RESOLVE_AMBER(request, { params: { sessionId } } as any);
    expect(response.status).toBe(400);
  });

  it('should return 400 when reflectionId is not in eligible pool', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId,
      routineId: 'see-think-wonder',
      title: 'Test Session',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'review_pending',
      votingPool: {
        eligibleReflectionIds: ['reflection-1', 'reflection-2', 'reflection-3'],
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: [],
      },
    };

    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: teacherId } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    const request = new Request('http://localhost/api/session/test-session-amber/voting/resolve-amber', {
      method: 'POST',
      body: JSON.stringify({ amber: [{ reflectionId: 'reflection-unknown', decision: 'exclude' }] }),
    });

    const response = await POST_RESOLVE_AMBER(request, { params: { sessionId } } as any);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('not found');
  });

  it('should successfully exclude amber-flagged responses and advance to round_1', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId,
      routineId: 'see-think-wonder',
      title: 'Test Session',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'review_pending',
      votingPool: {
        eligibleReflectionIds: ['reflection-1', 'reflection-2', 'reflection-3', 'reflection-4'],
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: [],
      },
    };

    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: teacherId } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);
    vi.mocked(updateSession).mockResolvedValue(undefined);

    const request = new Request('http://localhost/api/session/test-session-amber/voting/resolve-amber', {
      method: 'POST',
      body: JSON.stringify({
        amber: [
          { reflectionId: 'reflection-4', decision: 'exclude' },
          { reflectionId: 'reflection-3', decision: 'include' },
        ],
      }),
    });

    const response = await POST_RESOLVE_AMBER(request, { params: { sessionId } } as any);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.advancedTo).toBe('round_1');
    expect(body.updatedAmber).toEqual(['reflection-4']);
    expect(body.updatedPoolSize).toBe(3);

    expect(updateSession).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        votingState: 'round_1',
        votingPool: expect.objectContaining({
          eligibleReflectionIds: ['reflection-1', 'reflection-2', 'reflection-3', 'reflection-4'],
          excludedByAmberAlertIds: ['reflection-4'],
        }),
      })
    );
  });

  it('should handle empty amber array (no changes)', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId,
      routineId: 'see-think-wonder',
      title: 'Test Session',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'review_pending',
      votingPool: {
        eligibleReflectionIds: ['reflection-1', 'reflection-2', 'reflection-3'],
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: [],
      },
    };

    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: teacherId } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);
    vi.mocked(updateSession).mockResolvedValue(undefined);

    const request = new Request('http://localhost/api/session/test-session-amber/voting/resolve-amber', {
      method: 'POST',
      body: JSON.stringify({ amber: [] }),
    });

    const response = await POST_RESOLVE_AMBER(request, { params: { sessionId } } as any);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.advancedTo).toBe('round_1');
    expect(body.updatedAmber).toEqual([]);
    expect(body.updatedPoolSize).toBe(3);
  });

  it('should handle teacher including a previously excluded response', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId,
      routineId: 'see-think-wonder',
      title: 'Test Session',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'review_pending',
      votingPool: {
        eligibleReflectionIds: ['reflection-1', 'reflection-2', 'reflection-3', 'reflection-4'],
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: ['reflection-4'],
      },
    };

    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: teacherId } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);
    vi.mocked(updateSession).mockResolvedValue(undefined);

    const request = new Request('http://localhost/api/session/test-session-amber/voting/resolve-amber', {
      method: 'POST',
      body: JSON.stringify({
        amber: [{ reflectionId: 'reflection-4', decision: 'include' }],
      }),
    });

    const response = await POST_RESOLVE_AMBER(request, { params: { sessionId } } as any);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.updatedAmber).toEqual([]);
    expect(body.updatedPoolSize).toBe(4);

    expect(updateSession).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        votingState: 'round_1',
        votingPool: expect.objectContaining({
          excludedByAmberAlertIds: [],
        }),
      })
    );
  });

  it('should correctly handle all responses excluded scenario', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId,
      routineId: 'see-think-wonder',
      title: 'Test Session',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'review_pending',
      votingPool: {
        eligibleReflectionIds: ['reflection-1', 'reflection-2'],
        excludedByRedAlertIds: ['reflection-5'],
        excludedByAmberAlertIds: [],
      },
    };

    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: teacherId } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);
    vi.mocked(updateSession).mockResolvedValue(undefined);

    const request = new Request('http://localhost/api/session/test-session-amber/voting/resolve-amber', {
      method: 'POST',
      body: JSON.stringify({
        amber: [
          { reflectionId: 'reflection-1', decision: 'exclude' },
          { reflectionId: 'reflection-2', decision: 'exclude' },
        ],
      }),
    });

    const response = await POST_RESOLVE_AMBER(request, { params: { sessionId } } as any);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.updatedPoolSize).toBe(0);
    expect(body.updatedAmber).toEqual(['reflection-1', 'reflection-2']);
  });

  it('should handle duplicate decisions (exclude already excluded)', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId,
      routineId: 'see-think-wonder',
      title: 'Test Session',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'review_pending',
      votingPool: {
        eligibleReflectionIds: ['reflection-1', 'reflection-2', 'reflection-3'],
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: ['reflection-2'],
      },
    };

    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: teacherId } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);
    vi.mocked(updateSession).mockResolvedValue(undefined);

    const request = new Request('http://localhost/api/session/test-session-amber/voting/resolve-amber', {
      method: 'POST',
      body: JSON.stringify({
        amber: [{ reflectionId: 'reflection-2', decision: 'exclude' }],
      }),
    });

    const response = await POST_RESOLVE_AMBER(request, { params: { sessionId } } as any);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.updatedAmber).toEqual([]);
    expect(body.updatedPoolSize).toBe(2);
  });

  it('should handle mixed decisions (exclude new, include existing)', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId,
      routineId: 'see-think-wonder',
      title: 'Test Session',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'review_pending',
      votingPool: {
        eligibleReflectionIds: ['reflection-1', 'reflection-2', 'reflection-3', 'reflection-4'],
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: ['reflection-2'],
      },
    };

    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: teacherId } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);
    vi.mocked(updateSession).mockResolvedValue(undefined);

    const request = new Request('http://localhost/api/session/test-session-amber/voting/resolve-amber', {
      method: 'POST',
      body: JSON.stringify({
        amber: [
          { reflectionId: 'reflection-2', decision: 'include' },
          { reflectionId: 'reflection-4', decision: 'exclude' },
        ],
      }),
    });

    const response = await POST_RESOLVE_AMBER(request, { params: { sessionId } } as any);
    expect(response.status).toBe(200);

    const body = await response.json();
    // reflection-2 was excluded, now included; reflection-4 newly excluded
    expect(body.updatedAmber).toEqual(['reflection-4']);
    // eligible=4, amber-excluded=[reflection-4] after decisions, so pool = 4 - 1 = 3
    expect(body.updatedPoolSize).toBe(3);

    expect(updateSession).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        votingState: 'round_1',
        votingPool: expect.objectContaining({
          eligibleReflectionIds: ['reflection-1', 'reflection-2', 'reflection-3', 'reflection-4'],
          excludedByAmberAlertIds: ['reflection-4'],
        }),
      })
    );
  });
});

describe('GET /api/session/[sessionId]/voting/ballot', () => {
  const sessionId = 'test-session-ballot';
  const participantId = 'participant-1';
  const token = 'valid-token-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when token is invalid or missing', async () => {
    vi.mocked(assertParticipantTokenForReflection).mockRejectedValue(
      new Error('Invalid participant token.')
    );

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/ballot?token=invalid`,
      { method: 'GET' }
    );

    const response = await GET_BALLOT(request, { params: Promise.resolve({ sessionId }) } as any);
    expect(response.status).toBe(401);
  });

  it('should return empty ballot for review_pending state', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId: 'teacher-1',
      routineId: 'see-think-wonder',
      title: 'Test',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'review_pending',
      votingPool: {
        eligibleReflectionIds: ['r1', 'r2', 'r3'],
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: [],
      },
    };

    vi.mocked(assertParticipantTokenForReflection).mockResolvedValue({
      id: participantId,
    } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/ballot?token=${token}`,
      { method: 'GET' }
    );

    const response = await GET_BALLOT(request, { params: Promise.resolve({ sessionId }) } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.state).toBe('review_pending');
    expect(body.ballot).toEqual([]);
  });

  it('should return empty ballot for inactive state', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId: 'teacher-1',
      routineId: 'see-think-wonder',
      title: 'Test',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'inactive',
    };

    vi.mocked(assertParticipantTokenForReflection).mockResolvedValue({
      id: participantId,
    } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/ballot?token=${token}`,
      { method: 'GET' }
    );

    const response = await GET_BALLOT(request, { params: Promise.resolve({ sessionId }) } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.state).toBe('inactive');
    expect(body.ballot).toEqual([]);
  });

  it('returns 3-4 anonymous peer responses for round_1 voting', async () => {
    const reflectionIds = ['r1', 'r2', 'r3', 'r4', 'r5'];
    const mockSession: Session = {
      id: sessionId,
      teacherId: 'teacher-1',
      routineId: 'see-think-wonder',
      title: 'Test',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
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
      votingState: 'round_1',
      votingPool: {
        eligibleReflectionIds: reflectionIds,
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: [],
      },
    };

    vi.mocked(assertParticipantTokenForReflection).mockResolvedValue({
      id: participantId,
    } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);
    vi.mocked(generateBallotSample).mockReturnValue(['r1', 'r2', 'r3']);

    const mockDb = {
      collection: vi.fn().mockReturnThis(),
      doc: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({
        docs: reflectionIds.map((id, index) => ({
          id,
          data: () => ({
            id,
            sessionId,
            participantId: `student-${index + 1}`,
            displayName: `Student ${index + 1}`,
            steps: [
              {
                label: 'Wonder',
                transcription: `Response ${index + 1}`,
              } as ReflectionStep,
            ],
          } as Reflection),
        })),
      }),
    };
    vi.mocked(getDbOrThrowForProd).mockReturnValue(mockDb as any);

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/ballot?token=${token}`,
      { method: 'GET' }
    );

    const response = await GET_BALLOT(request, { params: Promise.resolve({ sessionId }) } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.round).toBe(1);
    expect(body.ballot).toBeDefined();
    expect(body.ballot.length).toBeGreaterThanOrEqual(3);
    expect(body.ballot.length).toBeLessThanOrEqual(4);

    // Verify anonymity - only transcription and reflectionId should be present
    body.ballot.forEach((response: any) => {
      expect(response.transcription).toBeDefined();
      expect(response.reflectionId).toBeDefined();
      expect(response.studentName).toBeUndefined();
      expect(response.studentId).toBeUndefined();
      expect(response.displayName).toBeUndefined();
      expect(response.participantId).toBeUndefined();
    });
  });

  it('returns 4 finalist responses for finals voting', async () => {
    const finalistIds = ['finalist-1', 'finalist-2', 'finalist-3', 'finalist-4'];
    const mockSession: Session = {
      id: sessionId,
      teacherId: 'teacher-1',
      routineId: 'see-think-wonder',
      title: 'Test',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 4,
      reflectingCount: 0,
      doneCount: 4,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'finals',
      votingPool: {
        eligibleReflectionIds: finalistIds,
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: [],
        finalistReflectionIds: finalistIds,
      },
    };

    vi.mocked(assertParticipantTokenForReflection).mockResolvedValue({
      id: participantId,
    } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    const mockDb = {
      collection: vi.fn().mockReturnThis(),
      doc: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({
        docs: finalistIds.map((id, index) => ({
          id,
          data: () => ({
            id,
            sessionId,
            participantId: `student-${index + 1}`,
            displayName: `Student ${index + 1}`,
            steps: [
              {
                label: 'Wonder',
                transcription: `Finalist ${index + 1}`,
              } as ReflectionStep,
            ],
          } as Reflection),
        })),
      }),
    };
    vi.mocked(getDbOrThrowForProd).mockReturnValue(mockDb as any);

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/ballot?token=${token}`,
      { method: 'GET' }
    );

    const response = await GET_BALLOT(request, { params: Promise.resolve({ sessionId }) } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.round).toBe(2);
    expect(body.ballot).toBeDefined();
    expect(body.ballot.length).toBe(4);

    const finalistIdSet = new Set(finalistIds);
    body.ballot.forEach((response: any) => {
      expect(finalistIdSet.has(response.reflectionId)).toBe(true);
      expect(response.transcription).toBeDefined();
    });
  });

  it('returns winner and top 3 ranking for reveal state', async () => {
    const finalistIds = ['finalist-1', 'finalist-2', 'finalist-3', 'finalist-4'];
    const winnerReflectionId = 'finalist-2';
    const mockSession: Session = {
      id: sessionId,
      teacherId: 'teacher-1',
      routineId: 'see-think-wonder',
      title: 'Test',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 4,
      reflectingCount: 0,
      doneCount: 4,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'reveal',
      votingPool: {
        eligibleReflectionIds: finalistIds,
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: [],
        finalistReflectionIds: finalistIds,
        winnerReflectionId,
        rankedTop3: [
          { reflectionId: 'finalist-2', voteCount: 5 },
          { reflectionId: 'finalist-1', voteCount: 4 },
          { reflectionId: 'finalist-3', voteCount: 2 },
        ],
      },
    };

    vi.mocked(assertParticipantTokenForReflection).mockResolvedValue({
      id: participantId,
    } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    const mockDb = {
      collection: vi.fn().mockReturnThis(),
      doc: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({
        docs: finalistIds.map((id, index) => ({
          id,
          data: () => ({
            id,
            sessionId,
            participantId: `student-${index + 1}`,
            displayName: `Student ${index + 1}`,
            steps: [
              {
                label: 'Wonder',
                transcription: `Response ${index + 1}`,
              } as ReflectionStep,
            ],
          } as Reflection),
        })),
      }),
    };
    vi.mocked(getDbOrThrowForProd).mockReturnValue(mockDb as any);

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/ballot?token=${token}`,
      { method: 'GET' }
    );

    const response = await GET_BALLOT(request, { params: Promise.resolve({ sessionId }) } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.state).toBe('reveal');
    expect(body.winner).toBeDefined();
    expect(body.winner.reflectionId).toBe(winnerReflectionId);
    expect(body.winner.voteCount).toBeDefined();
    expect(body.rankedTop3).toBeDefined();
    expect(body.rankedTop3.length).toBe(3);
    expect(body.rankedTop3[0].voteCount).toBeGreaterThanOrEqual(body.rankedTop3[1].voteCount);
    expect(body.rankedTop3[1].voteCount).toBeGreaterThanOrEqual(body.rankedTop3[2].voteCount);
  });

  it('returns winner without vote counts for discuss state', async () => {
    const finalistIds = ['finalist-1', 'finalist-2', 'finalist-3', 'finalist-4'];
    const winnerReflectionId = 'finalist-2';
    const mockSession: Session = {
      id: sessionId,
      teacherId: 'teacher-1',
      routineId: 'see-think-wonder',
      title: 'Test',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 4,
      reflectingCount: 0,
      doneCount: 4,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'discuss',
      votingPool: {
        eligibleReflectionIds: finalistIds,
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: [],
        finalistReflectionIds: finalistIds,
        winnerReflectionId,
        rankedTop3: [
          { reflectionId: 'finalist-2', voteCount: 5 },
          { reflectionId: 'finalist-1', voteCount: 4 },
          { reflectionId: 'finalist-3', voteCount: 2 },
        ],
      },
    };

    vi.mocked(assertParticipantTokenForReflection).mockResolvedValue({
      id: participantId,
    } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    const mockDb = {
      collection: vi.fn().mockReturnThis(),
      doc: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({
        docs: finalistIds.map((id, index) => ({
          id,
          data: () => ({
            id,
            sessionId,
            participantId: `student-${index + 1}`,
            displayName: `Student ${index + 1}`,
            steps: [
              {
                label: 'Wonder',
                transcription: `Response ${index + 1}`,
              } as ReflectionStep,
            ],
          } as Reflection),
        })),
      }),
    };
    vi.mocked(getDbOrThrowForProd).mockReturnValue(mockDb as any);

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/ballot?token=${token}`,
      { method: 'GET' }
    );

    const response = await GET_BALLOT(request, { params: Promise.resolve({ sessionId }) } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.state).toBe('discuss');
    expect(body.winner).toBeDefined();
    expect(body.winner.reflectionId).toBe(winnerReflectionId);
    expect(body.winner.voteCount).toBeUndefined();
    expect(body.rankedTop3).toBeUndefined();
    expect(body.discussionPrompts).toBeDefined();
  });
});

describe('POST /api/session/[sessionId]/voting/vote', () => {
  const sessionId = 'test-session-vote';
  const participantId = 'participant-vote-1';
  const token = 'valid-token-vote';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when token is invalid', async () => {
    vi.mocked(assertParticipantTokenForReflection).mockRejectedValue(
      new Error('Invalid participant token.')
    );

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/vote?token=invalid`,
      {
        method: 'POST',
        body: JSON.stringify({ reflectionId: 'r1' }),
      }
    );

    const response = await POST_VOTE(request, { params: Promise.resolve({ sessionId }) } as any);
    expect(response.status).toBe(401);
  });

  it('should return 400 when voting state is not round_1 or finals', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId: 'teacher-1',
      routineId: 'see-think-wonder',
      title: 'Test',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'review_pending',
      votingPool: {
        eligibleReflectionIds: ['r1', 'r2'],
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: [],
      },
    };

    vi.mocked(assertParticipantTokenForReflection).mockResolvedValue({
      id: participantId,
    } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/vote?token=${token}`,
      {
        method: 'POST',
        body: JSON.stringify({ reflectionId: 'r1' }),
      }
    );

    const response = await POST_VOTE(request, { params: Promise.resolve({ sessionId }) } as any);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('round_1 or finals');
  });

  it('should return 400 when reflectionId is student own response', async () => {
    const ownReflectionId = 'student-own-reflection';
    const mockSession: Session = {
      id: sessionId,
      teacherId: 'teacher-1',
      routineId: 'see-think-wonder',
      title: 'Test',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'round_1',
      votingPool: {
        eligibleReflectionIds: [ownReflectionId, 'r2'],
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: [],
      },
    };

    const mockDb = {
      collection: vi.fn().mockReturnThis(),
      doc: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({
        docs: [
          {
            id: ownReflectionId,
            data: () => ({ participantId }),
          },
        ],
      }),
    };

    vi.mocked(assertParticipantTokenForReflection).mockResolvedValue({
      id: participantId,
    } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);
    vi.mocked(getDbOrThrowForProd).mockReturnValue(mockDb as any);

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/vote?token=${token}`,
      {
        method: 'POST',
        body: JSON.stringify({ reflectionId: ownReflectionId }),
      }
    );

    const response = await POST_VOTE(request, { params: Promise.resolve({ sessionId }) } as any);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Cannot vote for your own');
  });

  it('rejects votes when votingState is inactive', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId: 'teacher-1',
      routineId: 'see-think-wonder',
      title: 'Test',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 3,
      reflectingCount: 0,
      doneCount: 3,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'inactive',
    };

    vi.mocked(assertParticipantTokenForReflection).mockResolvedValue({
      id: participantId,
    } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/vote?token=${token}`,
      {
        method: 'POST',
        body: JSON.stringify({ reflectionId: 'r1' }),
      }
    );

    const response = await POST_VOTE(request, { params: Promise.resolve({ sessionId }) } as any);

    expect(response.status).toBe(400);
  });

  it('rejects votes when votingState is review_pending', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId: 'teacher-1',
      routineId: 'see-think-wonder',
      title: 'Test',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 3,
      reflectingCount: 0,
      doneCount: 3,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'review_pending',
      votingPool: {
        eligibleReflectionIds: ['r1', 'r2', 'r3'],
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: [],
      },
    };

    vi.mocked(assertParticipantTokenForReflection).mockResolvedValue({
      id: participantId,
    } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/vote?token=${token}`,
      {
        method: 'POST',
        body: JSON.stringify({ reflectionId: 'r1' }),
      }
    );

    const response = await POST_VOTE(request, { params: Promise.resolve({ sessionId }) } as any);

    expect(response.status).toBe(400);
  });

  it('rejects votes when votingState is ended', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId: 'teacher-1',
      routineId: 'see-think-wonder',
      title: 'Test',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 3,
      reflectingCount: 0,
      doneCount: 3,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'ended',
    };

    vi.mocked(assertParticipantTokenForReflection).mockResolvedValue({
      id: participantId,
    } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/vote?token=${token}`,
      {
        method: 'POST',
        body: JSON.stringify({ reflectionId: 'r1' }),
      }
    );

    const response = await POST_VOTE(request, { params: Promise.resolve({ sessionId }) } as any);

    expect(response.status).toBe(400);
  });
});

describe('POST /api/session/[sessionId]/voting/advance', () => {
  const sessionId = 'test-session-advance';
  const teacherId = 'test-teacher-advance';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 403 when teacher does not own the session', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId: 'different-teacher',
      routineId: 'see-think-wonder',
      title: 'Test',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'round_1',
      votingPool: {
        eligibleReflectionIds: ['r1', 'r2'],
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: [],
      },
    };

    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: teacherId } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/advance`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'round_1_to_finals' }),
      }
    );

    const response = await POST_ADVANCE(request, { params: Promise.resolve({ sessionId }) } as any);
    expect(response.status).toBe(403);
  });

  it('should return 404 when session not found', async () => {
    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: teacherId } as any);
    vi.mocked(getSession).mockResolvedValue(null);

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/advance`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'round_1_to_finals' }),
      }
    );

    const response = await POST_ADVANCE(request, { params: Promise.resolve({ sessionId }) } as any);
    expect(response.status).toBe(404);
  });

  it('should return 400 when votingState does not match action', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId,
      routineId: 'see-think-wonder',
      title: 'Test',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'finals', // Wrong state for round_1_to_finals action
      votingPool: {
        eligibleReflectionIds: ['r1', 'r2'],
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: [],
      },
    };

    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: teacherId } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/advance`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'round_1_to_finals' }),
      }
    );

    const response = await POST_ADVANCE(request, { params: Promise.resolve({ sessionId }) } as any);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('round_1');
  });

  it('correctly determines winner from finals votes', async () => {
    const reflectionA = 'finalist-a';
    const reflectionB = 'finalist-b';
    const reflectionC = 'finalist-c';

    const mockSession: Session = {
      id: sessionId,
      teacherId,
      routineId: 'see-think-wonder',
      title: 'Test',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 3,
      reflectingCount: 0,
      doneCount: 3,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'finals',
      votingPool: {
        eligibleReflectionIds: [reflectionA, reflectionB, reflectionC],
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: [],
        finalistReflectionIds: [reflectionA, reflectionB, reflectionC],
      },
    };

    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: teacherId } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);
    vi.mocked(updateSession).mockResolvedValue(undefined);

    // Mock database with votes: A gets 1, B gets 2, C gets 0
    const mockDb = {
      collection: vi.fn((name: string) => {
        if (name === 'peerVotes') {
          return {
            where: vi.fn(() => ({
              where: vi.fn(() => ({
                get: vi.fn().mockResolvedValue({
                  docs: [
                    { data: () => ({ votedForReflectionId: reflectionA, round: 2 }) },
                    { data: () => ({ votedForReflectionId: reflectionB, round: 2 }) },
                    { data: () => ({ votedForReflectionId: reflectionB, round: 2 }) },
                  ],
                }),
              })),
            })),
          };
        } else if (name === 'sessions') {
          return {
            doc: vi.fn(() => ({
              collection: vi.fn(() => ({
                get: vi.fn().mockResolvedValue({
                  docs: [
                    {
                      id: reflectionA,
                      data: () => ({ displayName: 'Student A' } as Reflection),
                    },
                    {
                      id: reflectionB,
                      data: () => ({ displayName: 'Student B' } as Reflection),
                    },
                    {
                      id: reflectionC,
                      data: () => ({ displayName: 'Student C' } as Reflection),
                    },
                  ],
                }),
              })),
            })),
          };
        }
      }),
    };
    vi.mocked(getDbOrThrowForProd).mockReturnValue(mockDb as any);

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/advance`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'finals_to_reveal' }),
      }
    );

    const response = await POST_ADVANCE(request, { params: Promise.resolve({ sessionId }) } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.winner).toBeDefined();
    expect(body.winner.reflectionId).toBe(reflectionB);
    expect(body.winner.voteCount).toBe(2);
    expect(body.rankedTop3).toBeDefined();
    expect(body.rankedTop3.length).toBeGreaterThan(0);
    expect(body.rankedTop3[0].reflectionId).toBe(reflectionB);
    expect(body.rankedTop3[0].voteCount).toBe(2);
  });
});

describe('GET /api/session/[sessionId]/voting/live', () => {
  const sessionId = 'test-session-live';
  const teacherId = 'test-teacher-live';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 403 when teacher does not own the session', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId: 'different-teacher',
      routineId: 'see-think-wonder',
      title: 'Test',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'round_1',
    };

    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: teacherId } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/live`,
      { method: 'GET' }
    );

    const response = await GET_LIVE(request, { params: Promise.resolve({ sessionId }) } as any);
    expect(response.status).toBe(403);
  });

  it('should return 404 when session not found', async () => {
    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: teacherId } as any);
    vi.mocked(getSession).mockResolvedValue(null);

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/live`,
      { method: 'GET' }
    );

    const response = await GET_LIVE(request, { params: Promise.resolve({ sessionId }) } as any);
    expect(response.status).toBe(404);
  });

  it('should return vote counts structure with all required fields', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId,
      routineId: 'see-think-wonder',
      title: 'Test',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'round_1',
      votingPool: {
        eligibleReflectionIds: ['r1', 'r2', 'r3'],
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: [],
      },
    };

    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: teacherId } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    // Mock database with chained where support
    const mockDb = {
      collection: vi.fn((name: string) => {
        if (name === 'peerVotes') {
          return {
            where: vi.fn((field: string, op: string, value: any) => ({
              where: vi.fn(() => ({
                get: vi.fn().mockResolvedValue({
                  docs: [
                    { data: () => ({ votedForReflectionId: 'r1', round: 1 }) },
                    { data: () => ({ votedForReflectionId: 'r2', round: 1 }) },
                  ],
                  size: 2,
                }),
              })),
            })),
          };
        } else if (name === 'sessions') {
          return {
            doc: vi.fn(() => ({
              collection: vi.fn(() => ({
                get: vi.fn().mockResolvedValue({
                  size: 8,
                }),
              })),
            })),
          };
        }
      }),
    };

    vi.mocked(getDbOrThrowForProd).mockReturnValue(mockDb as any);

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/live`,
      { method: 'GET' }
    );

    const response = await GET_LIVE(request, { params: Promise.resolve({ sessionId }) } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('votingState');
    expect(body).toHaveProperty('round');
    expect(body).toHaveProperty('voteCounts');
    expect(body).toHaveProperty('participatingStudents');
    expect(body).toHaveProperty('studentsWhoVoted');
    expect(body).toHaveProperty('isComplete');
  });

  it('should return inactive state gracefully', async () => {
    const mockSession: Session = {
      id: sessionId,
      teacherId,
      routineId: 'see-think-wonder',
      title: 'Test',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 8,
      reflectingCount: 0,
      doneCount: 8,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'inactive',
    };

    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: teacherId } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/live`,
      { method: 'GET' }
    );

    const response = await GET_LIVE(request, { params: Promise.resolve({ sessionId }) } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.votingState).toBe('inactive');
    expect(body.voteCounts).toEqual({});
  });

  it('aggregates votes correctly for live dashboard', async () => {
    const reflectionA = 'r-a';
    const reflectionB = 'r-b';
    const mockSession: Session = {
      id: sessionId,
      teacherId,
      routineId: 'see-think-wonder',
      title: 'Test',
      learningTarget: '',
      stimulus: { kind: 'none', value: '' },
      config: {
        aiFollowupsEnabled: true,
        voiceMinimumSeconds: 5,
        annotationMode: false,
        responseMode: 'choice',
        showTranscription: true,
        studentResultsVisibility: 'full',
      },
      joinCode: 'ABC123',
      joinLink: 'http://test',
      status: 'active',
      joinedCount: 3,
      reflectingCount: 0,
      doneCount: 3,
      alertCount: 0,
      summaryStatus: 'idle',
      classSummary: null,
      classThinkingMap: { see: [], think: [], wonder: [] },
      createdAt: new Date().toISOString(),
      votingState: 'round_1',
      votingPool: {
        eligibleReflectionIds: [reflectionA, reflectionB],
        excludedByRedAlertIds: [],
        excludedByAmberAlertIds: [],
      },
    };

    vi.mocked(requireTeacherSession).mockResolvedValue({ uid: teacherId } as any);
    vi.mocked(getSession).mockResolvedValue(mockSession);

    // Mock database: votes are A, B, B from 3 different students
    const mockDb = {
      collection: vi.fn((name: string) => {
        if (name === 'peerVotes') {
          return {
            where: vi.fn((field: string, op: string, value: any) => ({
              where: vi.fn(() => ({
                get: vi.fn().mockResolvedValue({
                  docs: [
                    { data: () => ({ votedForReflectionId: reflectionA, round: 1, voterStudentId: 'student-1' }) },
                    { data: () => ({ votedForReflectionId: reflectionB, round: 1, voterStudentId: 'student-2' }) },
                    { data: () => ({ votedForReflectionId: reflectionB, round: 1, voterStudentId: 'student-3' }) },
                  ],
                  size: 3,
                }),
              })),
            })),
          };
        } else if (name === 'sessions') {
          return {
            doc: vi.fn(() => ({
              collection: vi.fn(() => ({
                get: vi.fn().mockResolvedValue({
                  size: 3, // 3 participating students
                }),
              })),
            })),
          };
        }
      }),
    };

    vi.mocked(getDbOrThrowForProd).mockReturnValue(mockDb as any);

    const request = new Request(
      `http://localhost/api/session/${sessionId}/voting/live`,
      { method: 'GET' }
    );

    const response = await GET_LIVE(request, { params: Promise.resolve({ sessionId }) } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.voteCounts[reflectionA]).toBe(1);
    expect(body.voteCounts[reflectionB]).toBe(2);
    expect(body.studentsWhoVoted).toBe(3);
    expect(body.participatingStudents).toBe(3);
    expect(body.isComplete).toBe(false); // isComplete is false until results are revealed
  });
});
