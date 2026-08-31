import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { formatAddress, type Address, type CreateAddressInput } from '@aisbp/shared';
import { ApiError } from '../../lib/api';
import { addressApi } from './address-api';
import { AddressForm } from './AddressForm';
import { useAddresses } from './use-addresses';

type Mode = { kind: 'idle' } | { kind: 'create' } | { kind: 'edit'; address: Address };

export function AddressesPage(): ReactElement {
  const { status, addresses, error, refetch } = useAddresses();
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const handleCreate = async (values: CreateAddressInput) => {
    await addressApi.create(values);
    setMode({ kind: 'idle' });
    setNotice('Address added.');
    setRowError(null);
    refetch();
  };

  const handleUpdate = (id: string) => async (values: CreateAddressInput) => {
    await addressApi.update(id, values);
    setMode({ kind: 'idle' });
    setNotice('Address updated.');
    setRowError(null);
    refetch();
  };

  const handleDelete = async (address: Address) => {
    if (!window.confirm(`Delete "${address.label}"?`)) return;
    setRowError(null);
    setNotice(null);
    try {
      await addressApi.remove(address.id);
      setNotice('Address removed.');
      refetch();
    } catch (caught) {
      setRowError(caught instanceof ApiError ? caught.message : 'Could not delete this address.');
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <nav className="text-sm text-slate-500">
        <Link to="/account" className="hover:text-slate-700">
          Account
        </Link>
        <span className="px-2">/</span>
        <span className="text-slate-700">Addresses</span>
      </nav>

      <div className="mt-3 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Your addresses</h1>
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
            Add address
          </button>
        ) : null}
      </div>

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
          <AddressForm onSubmit={handleCreate} onCancel={() => setMode({ kind: 'idle' })} />
        </div>
      ) : null}

      <div className="mt-6">
        {status === 'loading' ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading addresses">
            {[0, 1].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
        ) : status === 'error' ? (
          <div
            role="alert"
            className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center"
          >
            <p className="font-semibold text-rose-800">We couldn&apos;t load your addresses.</p>
            <p className="mt-1 text-sm text-rose-700">{error?.message}</p>
            <button
              type="button"
              onClick={refetch}
              className="mt-3 rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white"
            >
              Try again
            </button>
          </div>
        ) : addresses.length === 0 && mode.kind !== 'create' ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <p className="text-lg font-semibold text-slate-900">No addresses yet</p>
            <p className="mt-1 text-sm text-slate-600">
              Add the places you&apos;d like a service delivered to.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {addresses.map((address) =>
              mode.kind === 'edit' && mode.address.id === address.id ? (
                <li key={address.id}>
                  <AddressForm
                    address={address}
                    onSubmit={handleUpdate(address.id)}
                    onCancel={() => setMode({ kind: 'idle' })}
                  />
                </li>
              ) : (
                <li
                  key={address.id}
                  className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4"
                >
                  <div>
                    <p className="font-semibold text-slate-900">{address.label}</p>
                    <p className="mt-0.5 text-sm text-slate-600">{formatAddress(address)}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setNotice(null);
                        setRowError(null);
                        setMode({ kind: 'edit', address });
                      }}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(address)}
                      className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-700"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </main>
  );
}
