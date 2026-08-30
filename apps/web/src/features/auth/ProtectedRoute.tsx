import type { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import type { Role } from '@aisbp/shared';
import { useAuth } from './AuthProvider';

interface ProtectedRouteProps {
  children: ReactElement;
  roles?: Role[];
}

/**
 * Route guard. Redirects unauthenticated users to /login and shows an access
 * message when the user's role is not allowed. Server-side checks remain the
 * real enforcement — this is only UX.
 */
export function ProtectedRoute({ children, roles }: ProtectedRouteProps): ReactElement {
  const { user, status } = useAuth();

  if (status === 'loading') {
    return <p>Loading…</p>;
  }

  if (status === 'unauthenticated' || !user) {
    return <Navigate to="/login" replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return <p role="alert">You do not have access to this page.</p>;
  }

  return children;
}
