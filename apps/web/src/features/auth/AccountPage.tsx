import { useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';

export function AccountPage(): ReactElement {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const onLogout = async () => {
    setBusy(true);
    try {
      await logout();
      navigate('/', { replace: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900">Your account</h1>
      <dl className="mt-6 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
        <div className="flex justify-between px-4 py-3 text-sm">
          <dt className="text-slate-500">Name</dt>
          <dd className="font-medium text-slate-900">{user?.name}</dd>
        </div>
        <div className="flex justify-between px-4 py-3 text-sm">
          <dt className="text-slate-500">Email</dt>
          <dd className="font-medium text-slate-900">{user?.email}</dd>
        </div>
        <div className="flex justify-between px-4 py-3 text-sm">
          <dt className="text-slate-500">Role</dt>
          <dd className="font-medium text-slate-900">{user?.role}</dd>
        </div>
      </dl>

      {user?.role === 'customer' ? (
        <>
          <Link
            to="/account/bookings"
            className="mt-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 hover:border-slate-300"
          >
            Your bookings
            <span aria-hidden="true">→</span>
          </Link>
          <Link
            to="/account/addresses"
            className="mt-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 hover:border-slate-300"
          >
            Your addresses
            <span aria-hidden="true">→</span>
          </Link>
        </>
      ) : null}

      {user?.role === 'operations' ? (
        <>
          <Link
            to="/operations"
            className="mt-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 hover:border-slate-300"
          >
            Operations dashboard
            <span aria-hidden="true">→</span>
          </Link>
          <Link
            to="/operations/technicians"
            className="mt-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 hover:border-slate-300"
          >
            Technicians
            <span aria-hidden="true">→</span>
          </Link>
        </>
      ) : null}

      {user?.role === 'technician' ? (
        <>
          <Link
            to="/technician/bookings"
            className="mt-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 hover:border-slate-300"
          >
            Your jobs
            <span aria-hidden="true">→</span>
          </Link>
          <Link
            to="/technician/availability"
            className="mt-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 hover:border-slate-300"
          >
            Your availability
            <span aria-hidden="true">→</span>
          </Link>
        </>
      ) : null}

      <button
        type="button"
        onClick={onLogout}
        disabled={busy}
        className="mt-6 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
      >
        Log out
      </button>
    </main>
  );
}
