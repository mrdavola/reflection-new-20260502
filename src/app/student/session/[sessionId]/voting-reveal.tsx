'use client';

import { useEffect, useState } from 'react';

export interface RankedResponse {
  reflectionId: string;
  voteCount: number;
  transcription: string;
}

interface VotingRevealProps {
  winner: {
    reflectionId: string;
    transcription: string;
    voteCount: number;
  };
  rankedTop3: RankedResponse[];
  celebration?: boolean;
  sessionId: string;
}

export default function VotingReveal({
  winner,
  rankedTop3,
  celebration = false,
  sessionId,
}: VotingRevealProps) {
  const [showAnimation, setShowAnimation] = useState(celebration);

  useEffect(() => {
    if (celebration) {
      const timer = setTimeout(() => setShowAnimation(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [celebration]);

  return (
    <main className="min-h-screen bg-[#fdcb40] px-5 py-6 text-black" data-session-id={sessionId}>
      <div className="mx-auto max-w-3xl">
        <div className="panel p-6 md:p-10">
          {showAnimation && (
            <div className="mb-8 text-center">
              <div className="mb-4 text-6xl animate-bounce">🎉</div>
              <p className="text-sm font-bold text-black/60">Revealing class winner...</p>
            </div>
          )}

          <h1 className="display-type mb-8 text-center text-[2.5rem] font-bold leading-[0.85] sm:text-[3rem] md:text-[3.5rem]">
            Class Winner!
          </h1>

          <div className="mb-8 rounded-[24px] border-4 border-black bg-[#fdcb40] p-8 text-center">
            <p className="text-sm font-black uppercase tracking-[0.08em] text-black/60 mb-3">
              The winning response
            </p>
            <p className="text-xl font-bold leading-8 text-black">{winner.transcription}</p>
            <p className="mt-4 font-black text-lg">
              {winner.voteCount} vote{winner.voteCount !== 1 ? 's' : ''}
            </p>
          </div>

          <h2 className="display-type mb-6 text-2xl font-bold">Top 3</h2>

          <div className="space-y-4">
            {rankedTop3.map((resp, idx) => (
              <div
                key={resp.reflectionId}
                className={`rounded-[24px] border-2 border-black p-6 ${
                  idx === 0
                    ? 'bg-[#fdcb40]'
                    : idx === 1
                      ? 'bg-[#c8c8c8]'
                      : 'bg-[#e8c9a0]'
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border-2 border-black bg-white font-black text-xl">
                    #{idx + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-lg font-bold leading-7">{resp.transcription}</p>
                    <p className="mt-2 text-sm font-semibold text-black/70">
                      {resp.voteCount} vote{resp.voteCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
