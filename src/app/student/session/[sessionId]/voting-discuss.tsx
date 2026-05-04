'use client';

interface VotingDiscussProps {
  response: {
    reflectionId: string;
    transcription: string;
  };
  sessionId: string;
}

export default function VotingDiscuss({ response, sessionId }: VotingDiscussProps) {
  const discussionPrompts = [
    'What resonated with you about this response?',
    'How does this reflect our learning target?',
    'What questions do you have?',
  ];

  return (
    <main className="min-h-screen bg-[#fdcb40] px-5 py-6 text-black" data-session-id={sessionId} data-testid="voting-discuss">
      <div className="mx-auto max-w-3xl">
        <div className="panel p-6 md:p-10">
          <h1 className="display-type mb-8 text-[2.5rem] font-bold leading-[0.85] sm:text-[3rem] md:text-[3.5rem]">
            Let's Discuss
          </h1>

          <div className="mb-8 rounded-[24px] border-4 border-black bg-[#006cff] p-8 text-white">
            <p className="text-sm font-black uppercase tracking-[0.08em] mb-4 text-white/80">
              The class chose this response
            </p>
            <p className="text-2xl font-bold leading-8">{response.transcription}</p>
          </div>

          <div className="mb-8">
            <p className="mb-6 text-sm font-black uppercase tracking-[0.08em] text-black/60">
              Discussion prompts
            </p>
            <div className="space-y-3" data-testid="discuss-prompts">
              {discussionPrompts.map((prompt, idx) => (
                <div
                  key={idx}
                  className="rounded-[20px] border-2 border-black bg-white p-5"
                  data-testid="discuss-prompt"
                >
                  <p className="font-bold text-lg leading-6">{prompt}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[20px] border-2 border-black bg-[#fff2b7] p-5 text-center">
            <p className="text-sm font-black uppercase tracking-[0.08em]">
              👂 Listen to the discussion
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
