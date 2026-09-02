import { useState, type FormEvent, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { formatPrice, type AiIntentField } from '@aisbp/shared';
import { useAiAssistant } from './use-ai-assistant';

const FIELD_LABELS: Record<AiIntentField, string> = {
  service: 'service',
  date: 'date',
  address: 'address',
};

export function AiAssistantPage(): ReactElement {
  const { transcript, intent, matchedService, status, error, send, reset } = useAiAssistant();
  const [draft, setDraft] = useState('');

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const text = draft;
    setDraft('');
    void send(text);
  };

  const ready = intent !== null && intent.missingFields.length === 0 && matchedService !== null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Booking assistant</h1>
        {transcript.length > 0 ? (
          <button
            type="button"
            onClick={reset}
            className="text-sm font-medium text-slate-500 hover:text-slate-800"
          >
            Start over
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Describe what you need in plain language. The assistant drafts a booking; you always review
        and confirm it yourself.
      </p>

      <div className="mt-6 space-y-3">
        {transcript.length === 0 ? (
          <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
            e.g. &ldquo;I need my washing machine installed next Saturday at home&rdquo;
          </p>
        ) : null}
        {transcript.map((entry) => (
          <div
            key={entry.id}
            className={
              entry.role === 'you'
                ? 'ml-auto max-w-[85%] rounded-lg bg-sky-600 px-3 py-2 text-sm text-white'
                : 'mr-auto max-w-[85%] rounded-lg bg-white px-3 py-2 text-sm text-slate-800 ring-1 ring-slate-200'
            }
          >
            {entry.text}
          </div>
        ))}
        {status === 'thinking' ? (
          <div className="mr-auto rounded-lg bg-white px-3 py-2 text-sm text-slate-400 ring-1 ring-slate-200">
            Thinking&hellip;
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-rose-600">
          {error}
        </p>
      ) : null}

      {intent ? (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <h2 className="font-semibold text-slate-900">Draft booking</h2>
          <dl className="mt-2 space-y-1 text-slate-700">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Service</dt>
              <dd>{matchedService ? matchedService.name : '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Date</dt>
              <dd>{intent.requestedDate ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Address</dt>
              <dd>{intent.addressId ? 'On file' : '—'}</dd>
            </div>
            {matchedService ? (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">From</dt>
                <dd>{formatPrice(matchedService.priceCents, matchedService.currency)}</dd>
              </div>
            ) : null}
          </dl>

          {intent.missingFields.length > 0 ? (
            <p className="mt-3 text-slate-600">
              Still need: {intent.missingFields.map((f) => FIELD_LABELS[f]).join(', ')}.
              {intent.clarificationQuestion ? ` ${intent.clarificationQuestion}` : ''}
            </p>
          ) : null}

          {ready && matchedService ? (
            <Link
              to={`/services/${matchedService.slug}`}
              className="mt-3 inline-block rounded-lg bg-slate-900 px-4 py-2 font-medium text-white"
            >
              Review &amp; book
            </Link>
          ) : null}
        </section>
      ) : null}

      <form onSubmit={onSubmit} className="mt-6 flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type a message"
          aria-label="Message the booking assistant"
          maxLength={2000}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={status === 'thinking' || draft.trim() === ''}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </main>
  );
}
