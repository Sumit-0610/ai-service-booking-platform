import { useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { TechnicianSlot } from '@aisbp/shared';
import { ApiError } from '../../lib/api';
import { availabilityApi, type SlotBody } from './availability-api';
import { SlotForm } from './SlotForm';
import {
  formatLocalDate,
  formatLocalTime,
  localDateKey,
  localTimeZone,
  useTechnicianAvailability,
} from './use-availability';

type Mode = { kind: 'idle' } | { kind: 'create' } | { kind: 'edit'; slot: TechnicianSlot };

function groupByDate(
  slots: TechnicianSlot[],
): { key: string; iso: string; slots: TechnicianSlot[] }[] {
  const groups = new Map<string, TechnicianSlot[]>();
  for (const slot of slots) {
    const key = localDateKey(slot.startsAt);
    const list = groups.get(key) ?? [];
    list.push(slot);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => ({ key, iso: list[0]!.startsAt, slots: list }));
}

export function TechnicianAvailabilityPage(): ReactElement {
  const { status, slots, error, refetch } = useTechnicianAvailability();
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const days = useMemo(() => groupByDate(slots), [slots]);

  const handleCreate = async (body: SlotBody) => {
    await availabilityApi.create(body);
    setMode({ kind: 'idle' });
    setNotice('Availability added.');
    setRowError(null);
    refetch();
  };

  const handleUpdate = (id: string) => async (body: SlotBody) => {
    await availabilityApi.update(id, body);
    setMode({ kind: 'idle' });
    setNotice('Availability updated.');
    setRowError(null);
    refetch();
  };

  const handleDelete = async (slot: TechnicianSlot) => {
    if (!window.confirm(`Remove availability on ${formatLocalDate(slot.startsAt)}?`)) return;
    setRowError(null);
    setNotice(null);
    try {
      await availabilityApi.remove(slot.id);
      setNotice('Availability removed.');
      refetch();
    } catch (caught) {
      setRowError(caught instanceof ApiError ? caught.message : 'Could not remove this slot.');
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <nav className="text-sm text-slate-500">
        <Link to="/account" className="hover:text-slate-700">
          Account
        </Link>
        <span className="px-2">/</span>
        <span className="text-slate-700">Availability</span>
      </nav>

      <div className="mt-3 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Your availability</h1>
        {mode.kind === 'idle' ? (
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setRowError(null);
              setMode({ kind: 'create' });
            }}
            className="rounded-lg bg-sky-600 px-3.5 py-2 text-sm font-semibold text-white"
          >
            Add availability
          </button>
        ) : null}
      </div>

      <p className="mt-1 text-xs text-slate-400">Times shown and entered in {localTimeZone}.</p>

      {notice ? (
        <p
          role="status"
          className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
        >
          {notice}
        </p>
      ) : null}
      {rowError ? (
        <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {rowError}
        </p>
      ) : null}

      {mode.kind === 'create' ? (
        <div className="mt-4">
          <SlotForm onSubmit={handleCreate} onCancel={() => setMode({ kind: 'idle' })} />
        </div>
      ) : null}

      <div className="mt-6">
        {status === 'loading' ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading availability">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
        ) : status === 'error' ? (
          <div
            role="alert"
            className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center"
          >
            <p className="font-semibold text-rose-800">We couldn&apos;t load your availability.</p>
            <p className="mt-1 text-sm text-rose-700">{error?.message}</p>
            <button
              type="button"
              onClick={refetch}
              className="mt-3 rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white"
            >
              Try again
            </button>
          </div>
        ) : days.length === 0 && mode.kind !== 'create' ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <p className="text-lg font-semibold text-slate-900">No upcoming availability</p>
            <p className="mt-1 text-sm text-slate-600">
              Add the times you can take jobs. Customers see these on the service page.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {days.map((day) => (
              <div key={day.key}>
                <h2 className="text-sm font-semibold text-slate-500">{formatLocalDate(day.iso)}</h2>
                <ul className="mt-2 space-y-2">
                  {day.slots.map((slot) =>
                    mode.kind === 'edit' && mode.slot.id === slot.id ? (
                      <li key={slot.id}>
                        <SlotForm
                          slot={slot}
                          onSubmit={handleUpdate(slot.id)}
                          onCancel={() => setMode({ kind: 'idle' })}
                        />
                      </li>
                    ) : (
                      <li
                        key={slot.id}
                        className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4"
                      >
                        <div>
                          <p className="font-medium text-slate-900">
                            {formatLocalTime(slot.startsAt)} &ndash; {formatLocalTime(slot.endsAt)}
                          </p>
                          <p className="mt-0.5 text-sm text-slate-600">
                            {slot.service.name}
                            {slot.booked ? (
                              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                Booked
                              </span>
                            ) : null}
                          </p>
                        </div>
                        {slot.booked ? (
                          <span className="text-xs text-slate-400">Locked</span>
                        ) : (
                          <div className="flex shrink-0 gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setNotice(null);
                                setRowError(null);
                                setMode({ kind: 'edit', slot });
                              }}
                              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(slot)}
                              className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-700"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
