// Routes: which page shows for which URL, and which pages need a logged-in user.
import type { ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AssistantPage } from './pages/AssistantPage';
import { AuthPage } from './pages/AuthPage';
import { BookingPage, BookingsPage } from './pages/BookingPage';
import { BookPage } from './pages/BookPage';
import { FlightsPage } from './pages/FlightsPage';
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
        <nav>
          <NavLink to="/assistant">Assistant</NavLink>
          <NavLink to="/trips" end>Trips</NavLink>
          <NavLink to="/bookings">Bookings</NavLink>
        </nav>
      )}
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
          <Route path="/trips/:id/flights" element={<RequireAuth><FlightsPage /></RequireAuth>} />
          <Route path="/book/:quoteId" element={<RequireAuth><BookPage /></RequireAuth>} />
          <Route path="/bookings" element={<RequireAuth><BookingsPage /></RequireAuth>} />
          <Route path="/bookings/:id" element={<RequireAuth><BookingPage /></RequireAuth>} />
          <Route path="/assistant" element={<RequireAuth><AssistantPage /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/trips" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
