import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import {
  formatPrice,
  isCustomerCancellable,
  type Booking,
  type BookingStatus,
  type BookingStatusEvent,
} from '@aisbp/shared';
import { ApiError } from '../../lib/api';
import { bookingApi } from './booking-api';
import { useMyBookings } from './use-bookings';

const STATUS_STYLES: Record<BookingStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-sky-100 text-sky-800',
  assigned: 'bg-indigo-100 text-indigo-800',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-slate-200 text-slate-700',
  rejected: 'bg-rose-100 text-rose-800',
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function BookingsPage(): ReactElement {
  const { status, bookings, error, refetch } = useMyBookings();

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900">Your bookings</h1>

      {status === 'loading' ? (
        <div className="mt-6 space-y-3" aria-busy="true">
          <div className="h-28 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-28 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      ) : status === 'error' ? (
        <div role="alert" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm">
          <p className="font-medium text-rose-800">We couldn&apos;t load your bookings.</p>
          <button
            type="button"
            onClick={refetch}
            className="mt-2 rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Try again
          </button>
          <span className="sr-only">{error?.message}</span>
        </div>
      ) : bookings.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">
          You have no bookings yet.{' '}
          <Link to="/" className="font-semibold text-sky-700 hover:underline">
            Browse services
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {bookings.map((booking) => (
            <BookingCard key={booking.id} booking={booking} onChanged={refetch} />
          ))}
        </ul>
      )}
    </main>
  );
}

function BookingCard({
  booking,
  onChanged,
}: {
  booking: Booking;
  onChanged: () => void;
}): ReactElement {
  const [timeline, setTimeline] = useState<BookingStatusEvent[] | null>(null);
  const [showTimeline, setShowTimeline] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const toggleTimeline = async (): Promise<void> => {
    const next = !showTimeline;
    setShowTimeline(next);
    if (next && timeline === null) {
      try {
        const response = await bookingApi.statusHistory(booking.id);
        setTimeline(response.items);
      } catch {
        setTimeline([]);
      }
    }
  };

  const cancel = async (): Promise<void> => {
    setCancelling(true);
    setActionError(null);
    try {
      await bookingApi.cancel(booking.id);
      onChanged();
    } catch (caught) {
      setActionError(
        caught instanceof ApiError ? caught.message : 'Could not cancel. Please try again.',
      );
      setCancelling(false);
    }
  };

  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-slate-900">{booking.service.name}</p>
          <p className="mt-0.5 text-sm text-slate-600">{formatWhen(booking.scheduledStart)}</p>
          <p className="mt-0.5 text-sm text-slate-500">
            {booking.address.label} — {booking.address.line1}, {booking.address.city}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[booking.status]}`}
        >
          {booking.status.replace('_', ' ')}
        </span>
      </div>

      <div className="mt-3 flex items-baseline justify-between border-t border-slate-100 pt-3 text-sm">
        <span className="text-slate-600">Total</span>
        <span className="font-semibold text-slate-900">
          {formatPrice(booking.price.totalCents, booking.price.currency)}
        </span>
      </div>

      {booking.customerNotes ? (
        <p className="mt-2 text-sm text-slate-600">Notes: {booking.customerNotes}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={toggleTimeline}
          className="text-sm font-medium text-sky-700 hover:underline"
          aria-expanded={showTimeline}
        >
          {showTimeline ? 'Hide timeline' : 'Show timeline'}
        </button>
        {isCustomerCancellable(booking.status) ? (
          <button
            type="button"
            onClick={cancel}
            disabled={cancelling}
            className="text-sm font-medium text-rose-700 hover:underline disabled:opacity-50"
          >
            {cancelling ? 'Cancelling…' : 'Cancel booking'}
          </button>
        ) : null}
      </div>

      {actionError ? (
        <p role="alert" className="mt-2 text-sm font-medium text-rose-700">
          {actionError}
        </p>
      ) : null}

      {showTimeline ? (
        <ol className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
          {timeline === null ? (
            <li className="text-slate-500">Loading…</li>
          ) : timeline.length === 0 ? (
            <li className="text-slate-500">No history yet.</li>
          ) : (
            timeline.map((event, index) => (
              <li key={index} className="flex justify-between gap-4">
                <span className="text-slate-700">
                  {event.from ? `${event.from.replace('_', ' ')} → ` : ''}
                  {event.to.replace('_', ' ')}
                  {event.reason ? ` · ${event.reason}` : ''}
                </span>
                <span className="shrink-0 text-slate-400">{formatWhen(event.at)}</span>
              </li>
            ))
          )}
        </ol>
      ) : null}
    </li>
  );
}
