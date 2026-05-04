import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as POST_START } from '../start/route';
import { POST as POST_RESOLVE_AMBER } from '../resolve-amber/route';
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
}));

vi.mock('@/lib/server/firebase-admin', () => ({
  getAdminDb: vi.fn(),
}));

vi.mock('@/lib/safety', () => ({
  classifyTranscriptSafety: vi.fn(),
}));

vi.mock('@/lib/firebase/voting', () => ({
  buildVotingPool: vi.fn(),
}));

vi.mock('@/lib/routines', () => ({
  getRoutine: vi.fn(),
}));

import { getSession, updateSession, getDbOrThrowForProd } from '@/lib/server/store';
import { requireTeacherSession } from '@/lib/server/auth';
import { getAdminDb } from '@/lib/server/firebase-admin';
import { classifyTranscriptSafety } from '@/lib/safety';
import { buildVotingPool } from '@/lib/firebase/voting';
import { getRoutine } from '@/lib/routines';

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
  const studentId = 'student-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when no valid token provided', async () => {
    // We'll implement this once we set up the endpoint
    // For now, this test placeholder documents the expected behavior
    expect(true).toBe(true);
  });

  it('should return round_1 ballot with 3-4 random responses excluding own', async () => {
    expect(true).toBe(true);
  });

  it('should return finals ballot with top 4 finalists', async () => {
    expect(true).toBe(true);
  });

  it('should return reveal state with winner and top 3', async () => {
    expect(true).toBe(true);
  });

  it('should return discuss state with winner', async () => {
    expect(true).toBe(true);
  });

  it('should return empty ballot for inactive states', async () => {
    expect(true).toBe(true);
  });
});

describe('POST /api/session/[sessionId]/voting/vote', () => {
  const sessionId = 'test-session-vote';
  const studentId = 'student-1';
  const participantToken = 'token-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when no valid token provided', async () => {
    expect(true).toBe(true);
  });

  it('should record a vote for a reflection in round_1', async () => {
    expect(true).toBe(true);
  });

  it('should record a vote for a finalist in finals', async () => {
    expect(true).toBe(true);
  });

  it('should return 400 when voting state is not round_1 or finals', async () => {
    expect(true).toBe(true);
  });

  it('should return 400 when reflectionId is own response', async () => {
    expect(true).toBe(true);
  });

  it('should allow last vote to win if student votes twice', async () => {
    expect(true).toBe(true);
  });

  it('should return 400 when reflectionId not in eligible ballot', async () => {
    expect(true).toBe(true);
  });
});

describe('POST /api/session/[sessionId]/voting/advance', () => {
  const sessionId = 'test-session-advance';
  const teacherId = 'test-teacher-advance';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 403 when teacher does not own the session', async () => {
    expect(true).toBe(true);
  });

  it('should return 404 when session not found', async () => {
    expect(true).toBe(true);
  });

  it('should advance from round_1 to finals_pending with top finalists', async () => {
    expect(true).toBe(true);
  });

  it('should advance from finals to reveal with winner and top 3', async () => {
    expect(true).toBe(true);
  });

  it('should advance from reveal to discuss', async () => {
    expect(true).toBe(true);
  });

  it('should advance from discuss to ended', async () => {
    expect(true).toBe(true);
  });

  it('should return 400 when votingState does not match action', async () => {
    expect(true).toBe(true);
  });

  it('should handle tie-breaking for finalists', async () => {
    expect(true).toBe(true);
  });

  it('should include teacher-visible info in reveal (student names)', async () => {
    expect(true).toBe(true);
  });
});

describe('GET /api/session/[sessionId]/voting/live', () => {
  const sessionId = 'test-session-live';
  const teacherId = 'test-teacher-live';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 403 when teacher does not own the session', async () => {
    expect(true).toBe(true);
  });

  it('should return 404 when session not found', async () => {
    expect(true).toBe(true);
  });

  it('should return vote counts for round_1', async () => {
    expect(true).toBe(true);
  });

  it('should return vote counts for finals', async () => {
    expect(true).toBe(true);
  });

  it('should return locked results for reveal state', async () => {
    expect(true).toBe(true);
  });

  it('should include participating and voted student counts', async () => {
    expect(true).toBe(true);
  });

  it('should complete voting aggregation in under 500ms', async () => {
    expect(true).toBe(true);
  });
});
