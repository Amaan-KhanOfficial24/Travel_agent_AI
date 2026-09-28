// Routes: which page shows for which URL, and which pages need a logged-in user.
import type { ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AuthPage } from './pages/AuthPage';
import { TripDetailPage } from './pages/TripDetailPage';
import { TripsPage } from './pages/TripsPage';

/** Page guard. It improves the experience only: the real protection is the API's 401. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <main><p aria-busy="true">Loading…</p></main>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function Header() {
  const { user, logout } = useAuth();
  return (
    <header>
      <Link to="/trips" className="brand">✈ Travel Agent</Link>
      {user && (
        <span className="who">
          {user.email}{user.role === 'admin' ? ' (admin)' : ''}
          <button className="link" onClick={logout}>Log out</button>
        </span>
      )}
    </header>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Header />
        <Routes>
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />
          <Route path="/trips" element={<RequireAuth><TripsPage /></RequireAuth>} />
          <Route path="/trips/:id" element={<RequireAuth><TripDetailPage /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/trips" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
