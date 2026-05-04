'use client';

import { useState } from 'react';

interface Response {
  reflectionId: string;
  transcription: string;
}

interface VotingBallotProps {
  sessionId: string;
  round: 1 | 2;
  responses: Response[];
  onVoteComplete?: () => void;
  loading?: boolean;
}

export default function VotingBallot({
  sessionId,
  round,
  responses,
  onVoteComplete,
  loading = false,
}: VotingBallotProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleVote = async (reflectionId: string) => {
    setSelected(reflectionId);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/session/${sessionId}/voting/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reflectionId }),
      });

      if (res.ok) {
        onVoteComplete?.();
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (responses.length === 0) {
    return (
      <main className="min-h-screen bg-[#fdcb40] px-5 py-6 text-black flex flex-col items-center justify-center">
        <div className="panel max-w-2xl p-6 text-center">
          <p className="text-lg font-semibold">No responses available to vote on.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fdcb40] px-5 py-6 text-black" data-session-id={sessionId} data-testid="voting-ballot">
      <div className="mx-auto max-w-2xl">
        <div className="panel p-6 md:p-10">
          <div className="mb-6">
            <p className="inline-flex rounded-full border-2 border-black px-4 py-2 text-sm font-black uppercase tracking-[0.08em] bg-[#04c6c5]">
              {round === 1 ? 'Round 1' : 'Finals'}
            </p>
          </div>

          <h1 className="display-type mb-6 text-[3rem] font-bold leading-[0.85] sm:text-[4rem] md:text-[4.5rem]">
            {round === 1 ? 'Vote for your favorite' : 'Pick the winner'}
          </h1>

          <p className="mb-8 max-w-2xl text-2xl font-semibold leading-8">
            Read each response and tap the one that stands out most to you.
          </p>

          <div className="space-y-4">
            {responses.map((resp) => (
              <button
                key={resp.reflectionId}
                onClick={() => handleVote(resp.reflectionId)}
                disabled={submitting || loading}
                className={`focus-ring w-full rounded-[24px] border-2 p-6 text-left transition ${
                  selected === resp.reflectionId
                    ? 'border-black bg-[#006cff] text-white'
                    : 'border-black bg-white hover:bg-[#f5f5f5]'
                } ${submitting || loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                data-testid="response"
              >
                <p className="text-lg font-semibold leading-7">{resp.transcription}</p>
                {selected === resp.reflectionId && (
                  <p className="mt-4 font-black text-white">
                    ✓ Your vote
                  </p>
                )}
              </button>
            ))}
          </div>

          {submitting && (
            <p className="mt-6 text-center font-black text-[#006cff]">
              Recording your vote...
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
