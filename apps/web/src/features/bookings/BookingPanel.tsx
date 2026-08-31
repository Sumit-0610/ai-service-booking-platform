import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { calculateServicePrice, formatPrice } from '@aisbp/shared';
import { ApiError } from '../../lib/api';
import { useAddresses } from '../addresses/use-addresses';
import { useAuth } from '../auth/AuthProvider';
import { bookingApi } from './booking-api';

interface BookingPanelProps {
  serviceName: string;
  priceCents: number;
  currency: string;
  /** The slot the customer picked, or null if none selected yet. */
  slotId: string | null;
  slotLabel: string | null;
  /** Called after a booking is created so the parent can refresh availability. */
  onBooked: () => void;
}

/**
 * The confirmation step for booking a picked slot. Booking is customer-only and
 * requires a saved address. The price shown is the shared pricing contract
 * applied to data already on the page — the server recalculates it
 * authoritatively when the booking is created.
 */
export function BookingPanel({
  serviceName,
  priceCents,
  currency,
  slotId,
  slotLabel,
  onBooked,
}: BookingPanelProps): ReactElement {
  const { status: authStatus, user } = useAuth();

  if (authStatus === 'loading') {
    return <p className="mt-4 text-sm text-slate-500">Checking your account…</p>;
  }

  if (authStatus === 'unauthenticated') {
    return (
      <p className="mt-4 text-sm text-slate-600">
        <Link to="/login" className="font-semibold text-sky-700 hover:underline">
          Sign in
        </Link>{' '}
        to book a time for this service.
      </p>
    );
  }

  if (user?.role !== 'customer') {
    return (
      <p className="mt-4 text-sm text-slate-600">Only customer accounts can book a service.</p>
    );
  }

  return (
    <CustomerBookingForm
      serviceName={serviceName}
      priceCents={priceCents}
      currency={currency}
      slotId={slotId}
      slotLabel={slotLabel}
      onBooked={onBooked}
    />
  );
}

function CustomerBookingForm({
  serviceName,
  priceCents,
  currency,
  slotId,
  slotLabel,
  onBooked,
}: Omit<BookingPanelProps, never>): ReactElement {
  const { status, addresses } = useAddresses();
  const [addressId, setAddressId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedId, setConfirmedId] = useState<string | null>(null);

  const quote = calculateServicePrice({ basePriceCents: priceCents, currency });

  if (confirmedId) {
    return (
      <div
        role="status"
        className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm"
      >
        <p className="font-medium text-emerald-800">
          Booked {serviceName} for {slotLabel}.
        </p>
        <Link
          to="/account/bookings"
          className="mt-2 inline-block font-semibold text-emerald-800 hover:underline"
        >
          View your bookings →
        </Link>
      </div>
    );
  }

  if (status === 'loading') {
    return <p className="mt-4 text-sm text-slate-500">Loading your addresses…</p>;
  }

  if (addresses.length === 0) {
    return (
      <p className="mt-4 text-sm text-slate-600">
        <Link to="/account/addresses" className="font-semibold text-sky-700 hover:underline">
          Add an address
        </Link>{' '}
        to book this service.
      </p>
    );
  }

  const chosenAddress = addressId || addresses[0]?.id || '';

  const submit = async (): Promise<void> => {
    if (!slotId) return;
    setSubmitting(true);
    setError(null);
    try {
      const body =
        notes.trim().length > 0
          ? { slotId, addressId: chosenAddress, customerNotes: notes.trim() }
          : { slotId, addressId: chosenAddress };
      const { booking } = await bookingApi.create(body);
      setConfirmedId(booking.id);
      onBooked();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setError('That time is no longer available. Please pick another slot.');
      } else if (caught instanceof ApiError) {
        setError(caught.message);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      {slotId ? (
        <>
          <p className="text-sm font-medium text-slate-900">Confirm your booking</p>
          <p className="mt-1 text-sm text-slate-600">
            {serviceName} — {slotLabel}
          </p>

          <label className="mt-3 block text-sm">
            <span className="font-medium text-slate-700">Service address</span>
            <select
              value={chosenAddress}
              onChange={(event) => setAddressId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {addresses.map((address) => (
                <option key={address.id} value={address.id}>
                  {address.label} — {address.line1}, {address.city}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-3 block text-sm">
            <span className="font-medium text-slate-700">Notes for the technician (optional)</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={2000}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <div className="mt-3 flex items-baseline justify-between text-sm">
            <span className="text-slate-600">Total</span>
            <span className="font-semibold text-slate-900">
              {formatPrice(quote.totalCents, quote.currency)}
            </span>
          </div>

          {error ? (
            <p role="alert" className="mt-3 text-sm font-medium text-rose-700">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="mt-3 w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? 'Booking…' : 'Confirm booking'}
          </button>
          <p className="mt-2 text-xs text-slate-500">
            The final price is locked in when you book. No payment is taken in this release.
          </p>
        </>
      ) : (
        <p className="text-sm text-slate-500">Select a time above to book.</p>
      )}
    </div>
  );
}
