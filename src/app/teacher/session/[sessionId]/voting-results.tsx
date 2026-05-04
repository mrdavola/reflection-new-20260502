'use client';

import { useState } from 'react';

interface ResultItem {
  reflectionId: string;
  studentName: string;
  voteCount: number;
  transcription?: string;
}

interface VotingResultsProps {
  sessionId: string;
  topThree: ResultItem[];
  authorsRevealed?: boolean;
  celebrationEnabled?: boolean;
  onRevealAuthors: () => void;
  onDiscuss: () => void;
  onEnd: () => void;
}

export default function VotingResults({
  sessionId,
  topThree,
  authorsRevealed = false,
  celebrationEnabled = false,
  onRevealAuthors,
  onDiscuss,
  onEnd,
}: VotingResultsProps) {
  const [loading, setLoading] = useState(false);

  const handleRevealAuthors = async () => {
    setLoading(true);
    try {
      await onRevealAuthors();
    } finally {
      setLoading(false);
    }
  };

  const handleDiscuss = async () => {
    setLoading(true);
    try {
      await onDiscuss();
    } finally {
      setLoading(false);
    }
  };

  const handleEnd = async () => {
    setLoading(true);
    try {
      await onEnd();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold mb-6">Voting Results</h2>

      <div className="space-y-4 mb-8">
        {topThree.map((resp, idx) => (
          <div
            key={resp.reflectionId}
            className={`p-4 rounded-lg border-l-4 ${
              idx === 0
                ? 'border-yellow-400 bg-yellow-50'
                : 'border-gray-300 bg-gray-50'
            }`}
          >
            <div className="flex justify-between items-start gap-4">
              <div className="flex-1">
                <p className="text-xs font-bold text-gray-600 mb-1">
                  #{idx + 1} • {resp.voteCount} vote{resp.voteCount !== 1 ? 's' : ''}
                </p>
                <p className="text-sm text-gray-800 mt-2 line-clamp-4">
                  {resp.transcription || 'No text provided'}
                </p>
                <p className="text-xs text-gray-600 mt-2 font-semibold">
                  — {resp.studentName}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleRevealAuthors}
          disabled={authorsRevealed || loading}
          className={`px-4 py-2 rounded font-bold transition-colors ${
            authorsRevealed
              ? 'bg-gray-300 text-gray-700 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
          }`}
        >
          {authorsRevealed
            ? '✓ Authors Revealed to Class'
            : loading
              ? 'Revealing...'
              : 'Reveal Authors to Class'}
        </button>
        <button
          onClick={handleDiscuss}
          disabled={loading}
          className="px-4 py-2 bg-green-600 text-white rounded font-bold hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Loading...' : 'Start Discussion'}
        </button>
        <button
          onClick={handleEnd}
          disabled={loading}
          className="px-4 py-2 bg-gray-600 text-white rounded font-bold hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Ending...' : 'End Voting'}
        </button>
      </div>
    </div>
  );
}
