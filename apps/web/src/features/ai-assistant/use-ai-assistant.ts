import { useCallback, useRef, useState } from 'react';
import type { AiBookingIntent, AiMatchedService } from '@aisbp/shared';
import { ApiError } from '../../lib/api';
import { aiApi } from './ai-api';

export interface TranscriptEntry {
  id: number;
  role: 'you' | 'assistant';
  text: string;
}

export type AssistantStatus = 'idle' | 'thinking' | 'error' | 'unavailable';

export interface UseAiAssistant {
  transcript: TranscriptEntry[];
  intent: AiBookingIntent | null;
  matchedService: AiMatchedService | null;
  status: AssistantStatus;
  error: string | null;
  send: (text: string) => Promise<void>;
  reset: () => void;
}

/**
 * Conversation state for the assistant. The first message calls `/intent`; each
 * follow-up calls `/clarify` with the last grounded intent as context. All
 * grounding happens server-side — this hook just threads the transcript.
 */
export function useAiAssistant(): UseAiAssistant {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [intent, setIntent] = useState<AiBookingIntent | null>(null);
  const [matchedService, setMatchedService] = useState<AiMatchedService | null>(null);
  const [status, setStatus] = useState<AssistantStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const counter = useRef(0);

  const append = useCallback((role: TranscriptEntry['role'], text: string) => {
    counter.current += 1;
    setTranscript((prev) => [...prev, { id: counter.current, role, text }]);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || status === 'thinking') return;
      append('you', trimmed);
      setStatus('thinking');
      setError(null);
      try {
        const response = intent
          ? await aiApi.clarify(trimmed, intent)
          : await aiApi.intent(trimmed);
        setIntent(response.intent);
        setMatchedService(response.matchedService);
        append(
          'assistant',
          response.assistantMessage || response.intent.clarificationQuestion || 'Got it.',
        );
        setStatus('idle');
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 503) {
          setStatus('unavailable');
          append('assistant', caught.message);
          return;
        }
        setStatus('error');
        setError(caught instanceof Error ? caught.message : 'Something went wrong');
      }
    },
    [append, intent, status],
  );

  const reset = useCallback(() => {
    setTranscript([]);
    setIntent(null);
    setMatchedService(null);
    setStatus('idle');
    setError(null);
  }, []);

  return { transcript, intent, matchedService, status, error, send, reset };
}
