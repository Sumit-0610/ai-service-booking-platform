import type { ReactElement } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './features/auth/AuthProvider';
import { LoginPage } from './features/auth/LoginPage';
import { ProtectedRoute } from './features/auth/ProtectedRoute';
import { RegisterPage } from './features/auth/RegisterPage';
import './styles.css';

function HomePage(): ReactElement {
  const { user, logout } = useAuth();

  return (
    <main className="app-shell">
      <section className="intro">
        <p className="eyebrow">Authenticated</p>
        <h1>AI Service Booking Platform</h1>
        <p>
          Signed in as <strong>{user?.name}</strong> ({user?.email}) — role{' '}
          <strong>{user?.role}</strong>.
        </p>
        <p>Product features begin in later milestones.</p>
        <button type="button" onClick={() => void logout()}>
          Log out
        </button>
      </section>
    </main>
  );
}

export function App(): ReactElement {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <HomePage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
