'use client';

import { useState } from 'react';
import type { VotingState } from '@/lib/types';

interface VotingControlsProps {
  sessionId: string;
  votingState: VotingState;
  reflectionCount: number;
  onStateChange: (newState: VotingState) => void;
  onError?: (error: string) => void;
}

export default function VotingControls({
  sessionId,
  votingState,
  reflectionCount,
  onStateChange,
  onError,
}: VotingControlsProps) {
  const [loading, setLoading] = useState(false);

  const handleStartVoting = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/session/${sessionId}/voting/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.skipped) {
          onError?.(data.reason || 'Voting skipped');
        } else {
          onStateChange('review_pending');
        }
      } else {
        const error = await res.json();
        onError?.(error.message || 'Failed to start voting');
      }
    } catch (err) {
      onError?.('Network error starting voting');
    } finally {
      setLoading(false);
    }
  };

  const handleAdvance = async (action: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/session/${sessionId}/voting/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.action) {
          onStateChange(data.action as VotingState);
        }
      } else {
        const error = await res.json();
        onError?.(error.message || 'Failed to advance voting');
      }
    } catch (err) {
      onError?.('Network error advancing voting');
    } finally {
      setLoading(false);
    }
  };

  // Render different UI per state
  if (votingState === 'inactive') {
    const canStart = reflectionCount >= 5;
    return (
      <button
        onClick={handleStartVoting}
        disabled={!canStart || loading}
        className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
        data-testid="start-voting-button"
      >
        {loading ? 'Starting...' : 'Start Voting'}
      </button>
    );
  }

  if (votingState === 'review_pending') {
    return <div className="text-sm text-amber-700" data-testid="review-pending">Reviewing responses for safety...</div>;
  }

  if (votingState === 'round_1') {
    return (
      <button
        onClick={() => handleAdvance('round_1_to_finals')}
        disabled={loading}
        className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-50"
        data-testid="advance-to-finals-button"
      >
        {loading ? 'Advancing...' : 'Advance to Finals'}
      </button>
    );
  }

  if (votingState === 'finals') {
    return (
      <button
        onClick={() => handleAdvance('finals_to_reveal')}
        disabled={loading}
        className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-50"
        data-testid="reveal-winner-button"
      >
        {loading ? 'Revealing...' : 'Reveal Winner'}
      </button>
    );
  }

  if (votingState === 'reveal') {
    return (
      <div className="flex gap-2" data-testid="final-controls">
        <button
          onClick={() => handleAdvance('reveal_to_discuss')}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
          data-testid="start-discuss-button"
        >
          {loading ? 'Loading...' : 'Discuss'}
        </button>
        <button
          onClick={() => handleAdvance('discuss_to_ended')}
          disabled={loading}
          className="px-4 py-2 bg-gray-600 text-white rounded disabled:opacity-50"
          data-testid="end-voting-button"
        >
          End
        </button>
      </div>
    );
  }

  return null;
}
