'use client';

import { useState } from 'react';
import type { SafetyAlert } from '@/lib/types';

interface AmberResponse {
  id: string;
  transcription: string;
  alert: SafetyAlert;
}

interface AmberModalProps {
  responses: AmberResponse[];
  sessionId: string;
  onResolve: () => void;
  onError?: (error: string) => void;
}

export default function AmberModal({
  responses,
  sessionId,
  onResolve,
  onError,
}: AmberModalProps) {
  const [decisions, setDecisions] = useState<Record<string, 'include' | 'exclude'>>({});
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const amber = responses.map((r) => ({
        reflectionId: r.id,
        decision: decisions[r.id] || 'exclude',
      }));

      const res = await fetch(`/api/session/${sessionId}/voting/resolve-amber`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amber }),
      });

      if (res.ok) {
        onResolve();
      } else {
        const error = await res.json();
        onError?.(error.message || 'Failed to resolve amber responses');
      }
    } catch (_err) {
      onError?.('Network error resolving responses');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" data-testid="amber-modal">
      <div className="bg-white rounded p-6 max-w-2xl max-h-96 overflow-y-auto">
        <h2 className="text-lg font-bold mb-4">
          Review {responses.length} response{responses.length !== 1 ? 's' : ''}
        </h2>

        <div className="space-y-4 mb-6">
          {responses.map((resp) => (
            <div key={resp.id} className="border p-4 rounded" data-testid="amber-response">
              <p className="text-xs text-gray-500 mb-2">
                Flag: <span className="font-semibold">{resp.alert.category}</span>
              </p>
              <p className="text-sm mb-3 line-clamp-3">{resp.transcription}</p>
              <p className="text-xs text-gray-600 mb-3">{resp.alert.message}</p>

              <div className="flex gap-2">
                <button
                  onClick={() =>
                    setDecisions((d) => ({ ...d, [resp.id]: 'include' }))
                  }
                  className={`px-3 py-1 text-xs rounded ${
                    decisions[resp.id] === 'include'
                      ? 'bg-green-100 text-green-700 font-semibold'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                  data-testid="amber-include-button"
                >
                  Include
                </button>
                <button
                  onClick={() =>
                    setDecisions((d) => ({ ...d, [resp.id]: 'exclude' }))
                  }
                  className={`px-3 py-1 text-xs rounded ${
                    decisions[resp.id] === 'exclude'
                      ? 'bg-red-100 text-red-700 font-semibold'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                  data-testid="amber-exclude-button"
                >
                  Exclude
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded font-semibold disabled:opacity-50"
          data-testid="amber-confirm-button"
        >
          {loading ? 'Saving...' : 'Continue to Voting'}
        </button>
      </div>
    </div>
  );
}
