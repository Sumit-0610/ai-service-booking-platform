import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';

export function SiteHeader(): ReactElement {
  const { status, user } = useAuth();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold text-slate-900">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-sky-600 text-sm text-white">
            A
          </span>
          <span>Service Booking</span>
        </Link>

        <nav className="flex items-center gap-4 text-sm">
          {status === 'authenticated' && user ? (
            <>
              {user.role === 'operations' ? (
                <Link to="/operations" className="font-medium text-slate-700 hover:text-slate-900">
                  Operations
                </Link>
              ) : null}
              {user.role === 'customer' ? (
                <Link to="/assistant" className="font-medium text-slate-700 hover:text-slate-900">
                  Assistant
                </Link>
              ) : null}
              <Link to="/account" className="font-medium text-slate-700 hover:text-slate-900">
                {user.name}
              </Link>
            </>
          ) : status === 'unauthenticated' ? (
            <Link
              to="/login"
              className="rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white"
            >
              Log in
            </Link>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
