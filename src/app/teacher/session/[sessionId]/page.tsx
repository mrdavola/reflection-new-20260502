'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import VotingControls from './voting-controls';
import AmberModal from './voting-amber-modal';
import VotingResults from './voting-results';
import { AccountMenu } from '@/app/teacher/account-menu';
import type { DashboardPayload } from '@/lib/models';
import type { VotingState, SafetyAlert } from '@/lib/types';

interface AmberResponse {
  id: string;
  transcription: string;
  alert: SafetyAlert;
}

export default function TeacherSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const [sessionId, setSessionId] = useState<string>('');
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [votingState, setVotingState] = useState<VotingState>('inactive');
  const [amberResponses, setAmberResponses] = useState<AmberResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [authorsRevealed, setAuthorsRevealed] = useState(false);
  const initialLoadRef = useRef(false);

  // Initialize params
  useEffect(() => {
    params.then(({ sessionId: id }) => {
      setSessionId(id);
    });
  }, [params]);

  // Load dashboard data
  const loadDashboard = useCallback(async () => {
    if (!sessionId) return;
    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const data = await response.json();
      setDashboard(data);
      setVotingState(data.session.votingState || 'inactive');
    } catch (_err) {
      console.error('Error loading dashboard:', _err);
    }
  }, [sessionId]);

  // Poll for updates
  useEffect(() => {
    if (!sessionId) return;
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
      void loadDashboard();
    }
    const timer = window.setInterval(() => {
      void loadDashboard();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [sessionId, loadDashboard]);

  // Handle start voting - fetch amber responses
  const handleStartVoting = async () => {
    try {
      const res = await fetch(`/api/session/${sessionId}/voting/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.skipped) {
          setError(data.reason || 'Voting skipped');
          setVotingState('ended');
        } else {
          setVotingState('review_pending');
          if (data.amberFlaggedResponses && data.amberFlaggedResponses.length > 0) {
            setAmberResponses(data.amberFlaggedResponses);
          } else {
            // No amber responses, advance directly to round_1
            setVotingState('round_1');
          }
        }
      } else {
        const errorData = await res.json();
        setError(errorData.message || 'Failed to start voting');
      }
    } catch (_err) {
      setError('Network error starting voting');
    }
  };

  const handleAmberResolved = () => {
    setAmberResponses([]);
    setVotingState('round_1');
    // Refetch dashboard to get fresh state
    loadDashboard();
  };

  const handleStateChange = (newState: VotingState) => {
    setVotingState(newState);
    setError(null);
    // Refetch dashboard to get fresh state
    loadDashboard();
  };

  const handleError = (err: string) => {
    setError(err);
  };

  const handleRevealAuthors = async () => {
    try {
      const res = await fetch(`/api/session/${sessionId}/voting/reveal-authors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.ok) {
        setAuthorsRevealed(true);
      } else {
        const errorData = await res.json();
        setError(errorData.message || 'Failed to reveal authors');
      }
    } catch (_err) {
      setError('Network error revealing authors');
    }
  };

  const handleVotingAdvance = async (action: string) => {
    try {
      const res = await fetch(`/api/session/${sessionId}/voting/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      if (res.ok) {
        const data = await res.json();
        const newState = data.votingState || (action === 'reveal_to_discuss' ? 'discuss' : 'ended');
        setVotingState(newState as VotingState);
        setError(null);
      } else {
        const errorData = await res.json();
        setError(errorData.message || 'Failed to advance voting');
      }
    } catch (_err) {
      setError('Network error advancing voting');
    }
  };

  if (!dashboard) {
    return (
      <main className="min-h-screen bg-[#fdcb40] p-8 text-xl font-bold text-black">
        Loading session...
      </main>
    );
  }

  const { session } = dashboard;

  return (
    <main className="min-h-screen bg-[#fdcb40] px-5 py-5 text-black">
      <div className="mx-auto max-w-[1500px]">
        <div className="flex w-full justify-end pb-2">
          <AccountMenu
            onSignOut={async () => {
              const { getFirebaseClientServices } = await import('@/lib/firebase/client');
              const { signOut } = await import('firebase/auth');
              const { auth } = getFirebaseClientServices();
              if (auth) {
                await signOut(auth);
              }
              await fetch('/api/auth/logout', { method: 'POST' });
              window.location.href = '/teacher';
            }}
          />
        </div>

        <header className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-black pb-5">
          <div>
            <Link
              href="/teacher"
              className="focus-ring inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold"
            >
              <ArrowLeft size={16} />
              Sessions
            </Link>
            <h1 className="display-type mt-4 text-5xl font-bold leading-[0.9]">
              {session.title}
            </h1>
            <p className="mt-2 max-w-2xl text-xl font-semibold">
              {session.learningTarget || 'No learning target set'}
            </p>
          </div>
        </header>

        <div className="mt-5 space-y-5">
          {/* Error message */}
          {error && (
            <div className="rounded-[24px] border-2 border-black bg-[#fd4401] p-5 text-white">
              <p className="font-bold">{error}</p>
            </div>
          )}

          {/* Voting controls section */}
          {votingState && votingState !== 'inactive' && (
            <div className="rounded-[24px] border-2 border-black bg-blue-50 p-5">
              <h3 className="text-lg font-bold mb-4">Peer Voting</h3>
              <VotingControls
                sessionId={sessionId}
                votingState={votingState}
                reflectionCount={session.joinedCount}
                onStateChange={handleStateChange}
                onError={handleError}
              />
            </div>
          )}

          {/* Start voting section */}
          {votingState === 'inactive' && (
            <div className="rounded-[24px] border-2 border-black bg-blue-50 p-5">
              <h3 className="text-lg font-bold mb-4">Peer Voting</h3>
              <p className="text-sm mb-4 text-gray-700">
                {session.joinedCount < 5
                  ? `Need at least 5 students to start voting (currently ${session.joinedCount})`
                  : 'Ready to start peer voting'}
              </p>
              <button
                onClick={handleStartVoting}
                disabled={session.joinedCount < 5}
                className="px-4 py-2 bg-blue-600 text-white rounded font-bold disabled:opacity-50"
              >
                Start Voting
              </button>
            </div>
          )}

          {/* Amber modal */}
          {votingState === 'review_pending' && amberResponses.length > 0 && (
            <AmberModal
              responses={amberResponses}
              sessionId={sessionId}
              onResolve={handleAmberResolved}
              onError={handleError}
            />
          )}

          {/* Voting results section */}
          {votingState === 'reveal' && session.votingPool?.rankedTop3 && (
            <div className="rounded-[24px] border-2 border-black bg-green-50 p-5">
              <VotingResults
                topThree={session.votingPool.rankedTop3.map((r) => {
                  const reflection = dashboard.reflections.find((ref) => ref.id === r.reflectionId);
                  const transcription = reflection?.steps[0]?.transcription || '';
                  return {
                    reflectionId: r.reflectionId,
                    studentName: r.studentName,
                    voteCount: r.voteCount,
                    transcription,
                  };
                })}
                authorsRevealed={authorsRevealed}
                onRevealAuthors={handleRevealAuthors}
                onDiscuss={() => handleVotingAdvance('reveal_to_discuss')}
                onEnd={() => handleVotingAdvance('discuss_to_ended')}
              />
            </div>
          )}

          {/* Session info */}
          <div className="rounded-[24px] border-2 border-black bg-white p-5">
            <h3 className="text-lg font-bold mb-2">Session Status</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="font-semibold">Voting State:</dt>
                <dd>{votingState}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="font-semibold">Students Joined:</dt>
                <dd>{session.joinedCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="font-semibold">Completed:</dt>
                <dd>{session.doneCount}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </main>
  );
}
