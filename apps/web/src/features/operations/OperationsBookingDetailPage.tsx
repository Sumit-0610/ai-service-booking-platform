import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  canActorTransition,
  formatPrice,
  operationsStatusTargets,
  type AssignableTechnician,
  type OperationsBooking,
  type OperationsStatusTarget,
} from '@aisbp/shared';
import { ApiError } from '../../lib/api';
import { operationsApi } from './operations-api';
import { useOpsBooking } from './use-operations';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const ACTION_LABEL: Record<OperationsStatusTarget, string> = {
  confirmed: 'Confirm',
  rejected: 'Reject',
  cancelled: 'Cancel booking',
};

export function OperationsBookingDetailPage(): ReactElement {
  const { id = '' } = useParams();
  const { status, booking, error, refetch, setBooking } = useOpsBooking(id);
  const [busy, setBusy] = useState<OperationsStatusTarget | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const runAction = async (target: OperationsStatusTarget): Promise<void> => {
    setBusy(target);
    setActionError(null);
    setNotice(null);
    try {
      const response = await operationsApi.updateStatus(id, { status: target });
      setBooking(response.booking);
      setNotice(`Booking ${target}.`);
    } catch (caught) {
      setActionError(
        caught instanceof ApiError ? caught.message : 'Could not update the booking. Try again.',
      );
    } finally {
      setBusy(null);
    }
  };

  if (status === 'loading') {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6" aria-busy="true">
        <div className="h-6 w-48 animate-pulse rounded bg-slate-200" />
        <div className="mt-6 h-40 animate-pulse rounded-2xl bg-slate-100" />
      </main>
    );
  }

  if (status === 'error' || !booking) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6" role="alert">
        <h1 className="text-xl font-bold text-slate-900">
          {notFound ? 'Booking not found' : 'Something went wrong'}
        </h1>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            to="/operations"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Back to dashboard
          </Link>
          {!notFound ? (
            <button
              type="button"
              onClick={refetch}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Try again
            </button>
          ) : null}
        </div>
      </main>
    );
  }

  const available = operationsStatusTargets.filter((target) =>
    canActorTransition('operations', booking.status, target),
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Link to="/operations" className="text-sm text-slate-500 hover:text-slate-700">
        ← Dashboard
      </Link>

      <div className="mt-3 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">{booking.service.name}</h1>
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
          {booking.status.replace('_', ' ')}
        </span>
      </div>

      <dl className="mt-6 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white text-sm">
        <Row label="Customer">
          {booking.customerName} · {booking.customerEmail}
        </Row>
        <Row label="Technician">{booking.technicianName ?? 'Unassigned'}</Row>
        <Row label="Scheduled">
          {formatWhen(booking.scheduledStart)} – {formatWhen(booking.scheduledEnd)}
        </Row>
        <Row label="Address">
          {booking.address.label} — {booking.address.line1}
          {booking.address.line2 ? `, ${booking.address.line2}` : ''}, {booking.address.city},{' '}
          {booking.address.state} {booking.address.postalCode}, {booking.address.country}
        </Row>
        <Row label="Total">{formatPrice(booking.price.totalCents, booking.price.currency)}</Row>
        {booking.customerNotes ? <Row label="Notes">{booking.customerNotes}</Row> : null}
      </dl>

      {available.length > 0 ? (
        <section className="mt-6" aria-label="Actions">
          <div className="flex flex-wrap gap-2">
            {available.map((target) => (
              <button
                key={target}
                type="button"
                onClick={() => runAction(target)}
                disabled={busy !== null}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50"
              >
                {busy === target ? 'Working…' : ACTION_LABEL[target]}
              </button>
            ))}
          </div>
          {notice ? (
            <p role="status" className="mt-2 text-sm font-medium text-emerald-700">
              {notice}
            </p>
          ) : null}
          {actionError ? (
            <p role="alert" className="mt-2 text-sm font-medium text-rose-700">
              {actionError}
            </p>
          ) : null}
        </section>
      ) : null}

      {booking.status === 'confirmed' || booking.status === 'assigned' ? (
        <AssignmentSection bookingId={id} booking={booking} onAssigned={setBooking} />
      ) : null}

      <section className="mt-8" aria-label="Status timeline">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Timeline</h2>
        <ol className="mt-3 space-y-1.5 text-sm">
          {booking.statusHistory.map((event, index) => (
            <li key={index} className="flex justify-between gap-4">
              <span className="text-slate-700">
                {event.from ? `${event.from.replace('_', ' ')} → ` : ''}
                {event.to.replace('_', ' ')}
                {event.by ? ` · ${event.by}${event.byRole ? ` (${event.byRole})` : ''}` : ''}
                {event.reason ? ` · ${event.reason}` : ''}
              </span>
              <span className="shrink-0 text-slate-400">{formatWhen(event.at)}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

function AssignmentSection({
  bookingId,
  booking,
  onAssigned,
}: {
  bookingId: string;
  booking: OperationsBooking;
  onAssigned: (b: OperationsBooking) => void;
}): ReactElement {
  const [options, setOptions] = useState<AssignableTechnician[] | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    operationsApi
      .assignableTechnicians(bookingId)
      .then((r) => {
        if (active) setOptions(Array.isArray(r.items) ? r.items : []);
      })
      .catch(() => {
        if (active) setOptions([]);
      });
    return () => {
      active = false;
    };
  }, [bookingId, booking.status, booking.technicianName]);

  const assign = async (): Promise<void> => {
    if (!selected) return;
    const target = options?.find((o) => o.id === selected);
    if (
      target?.hasScheduleConflict &&
      !window.confirm(`${target.displayName} has another job at this time. Assign anyway?`)
    ) {
      return;
    }
    setBusy(true);
    setErrorText(null);
    setNotice(null);
    try {
      const { booking: next } = await operationsApi.assignTechnician(bookingId, {
        technicianId: selected,
      });
      onAssigned(next);
      setSelected('');
      setNotice('Technician assigned.');
    } catch (caught) {
      setErrorText(
        caught instanceof ApiError ? caught.message : 'Could not assign. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-5"
      aria-label="Technician assignment"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {booking.status === 'assigned' ? 'Reassign technician' : 'Assign technician'}
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Current: {booking.technicianName ?? 'Unassigned'}
      </p>

      {options === null ? (
        <p className="mt-3 text-sm text-slate-500">Loading eligible technicians…</p>
      ) : options.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">
          No other active technician is qualified for this service.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-sm">
            <span className="sr-only">Technician</span>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              aria-label="Technician"
            >
              <option value="">Choose a technician…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.displayName}
                  {o.hasScheduleConflict ? ' — busy at this time' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={assign}
            disabled={busy || selected === ''}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Assigning…' : booking.status === 'assigned' ? 'Reassign' : 'Assign'}
          </button>
        </div>
      )}

      {notice ? (
        <p role="status" className="mt-2 text-sm font-medium text-emerald-700">
          {notice}
        </p>
      ) : null}
      {errorText ? (
        <p role="alert" className="mt-2 text-sm font-medium text-rose-700">
          {errorText}
        </p>
      ) : null}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900 sm:text-right">{children}</dd>
    </div>
  );
}
