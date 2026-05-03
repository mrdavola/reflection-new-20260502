import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../start/route';
import type { SafetyAlert, ReflectionStep } from '@/lib/types';
import type { Session, Reflection } from '@/lib/models';

// Mock the dependencies
vi.mock('@/lib/server/store', () => ({
  getSession: vi.fn(),
  updateSession: vi.fn(),
  getReflection: vi.fn(),
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

import { getSession, updateSession, getReflection } from '@/lib/server/store';
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

    const response = await POST(request, { params: { sessionId } } as any);
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

    const response = await POST(request, { params: { sessionId } } as any);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.skipped).toBe(true);
    expect(body.reason).toBeDefined();
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

    const mockReflections: Reflection[] = reflectionIds.map((id, index) => {
      const wonderText = index === 1 ? 'I hate this so much' : `I wonder about thing ${index}`;
      return {
        id,
        sessionId,
        participantId: `student-${index + 1}`,
        displayName: `Student ${index + 1}`,
        steps: [
          {
            label: 'Wonder',
            transcription: wonderText,
          } as ReflectionStep,
        ],
        overallAnalysis: null,
        studentFeedback: null,
        contentAlerts: [],
        teacherNote: null,
        audioExpiresAt: null,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
    });

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

    // Mock Firestore database
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
    vi.mocked(getAdminDb).mockReturnValue(mockDb as any);

    // Mock classifyTranscriptSafety to return alerts for some responses
    vi.mocked(classifyTranscriptSafety).mockImplementation((text: string) => {
      if (text.includes('hate')) {
        return {
          severity: 'amber',
          category: 'negative_tone',
          title: 'Negative tone',
          message: 'Check whether this needs teacher follow-up.',
          matchedText: 'hate',
        } as SafetyAlert;
      }
      return null;
    });

    // Mock buildVotingPool
    vi.mocked(buildVotingPool).mockReturnValue({
      eligibleReflectionIds: reflectionIds.filter((_, i) => i !== 1),
      excludedByRedAlertIds: [],
      excludedByAmberAlertIds: ['reflection-2'],
    });

    const request = new Request('http://localhost/api/session/test-session-1/voting/start', {
      method: 'POST',
      body: JSON.stringify({ teacherId }),
    });

    const response = await POST(request, { params: { sessionId } } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.amberFlaggedResponses).toBeDefined();
    expect(body.amberFlaggedResponses).toHaveLength(1);
    expect(body.amberFlaggedResponses[0].id).toBe('reflection-2');
    expect(body.amberFlaggedResponses[0].transcription).toBe('I hate this so much');
    expect(body.amberFlaggedResponses[0].alert).toBeDefined();
    expect(body.votingPoolId).toBe(sessionId);
    expect(body.totalEligible).toBe(7);

    // Verify updateSession was called with review_pending state
    expect(updateSession).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        votingState: 'review_pending',
        votingPool: expect.any(Object),
      })
    );
  });

  it('should handle missing headline step gracefully', async () => {
    const reflectionIds = Array.from({ length: 5 }, (_, i) => `reflection-${i + 1}`);

    const mockSession: Session = {
      id: sessionId,
      teacherId,
      routineId: 'would-you-rather',
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
      joinedCount: 5,
      reflectingCount: 0,
      doneCount: 5,
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
          label: 'Reasoning',
          transcription: `Reason ${index + 1}`,
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
      id: 'would-you-rather',
      name: 'Would You Rather',
      description: 'Test',
      bestForTags: [],
      config: mockSession.config,
      steps: [],
      peerVotingDefault: false,
    });

    // Mock Firestore database
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
    vi.mocked(getAdminDb).mockReturnValue(mockDb as any);

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

    const response = await POST(request, { params: { sessionId } } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.skipped).toBe(true);
    expect(body.reason).toBeDefined();
  });
});
