import type { ReactElement } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SiteHeader } from './components/SiteHeader';
import { AddressesPage } from './features/addresses/AddressesPage';
import { AccountPage } from './features/auth/AccountPage';
import { BookingsPage } from './features/bookings/BookingsPage';
import { TechnicianAvailabilityPage } from './features/availability/TechnicianAvailabilityPage';
import { AuthProvider } from './features/auth/AuthProvider';
import { LoginPage } from './features/auth/LoginPage';
import { ProtectedRoute } from './features/auth/ProtectedRoute';
import { RegisterPage } from './features/auth/RegisterPage';
import { CataloguePage } from './features/catalogue/CataloguePage';
import { ServiceDetailPage } from './features/catalogue/ServiceDetailPage';
import { OperationsBookingDetailPage } from './features/operations/OperationsBookingDetailPage';
import { OperationsDashboardPage } from './features/operations/OperationsDashboardPage';
import './styles.css';

export function App(): ReactElement {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="min-h-screen bg-slate-50 text-slate-900">
          <SiteHeader />
          <Routes>
            <Route path="/" element={<CataloguePage />} />
            <Route path="/services/:slug" element={<ServiceDetailPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route
              path="/account"
              element={
                <ProtectedRoute>
                  <AccountPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/account/addresses"
              element={
                <ProtectedRoute roles={['customer']}>
                  <AddressesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/account/bookings"
              element={
                <ProtectedRoute roles={['customer']}>
                  <BookingsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/operations"
              element={
                <ProtectedRoute roles={['operations']}>
                  <OperationsDashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/operations/bookings/:id"
              element={
                <ProtectedRoute roles={['operations']}>
                  <OperationsBookingDetailPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/technician/availability"
              element={
                <ProtectedRoute roles={['technician']}>
                  <TechnicianAvailabilityPage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}
