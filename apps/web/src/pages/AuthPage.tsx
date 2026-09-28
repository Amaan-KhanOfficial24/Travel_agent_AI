// Login and registration share one form; `mode` switches between them.
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { ErrorBanner, fieldErrors } from '../components/ErrorBanner';
import { Field } from '../components/Field';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { user, login, register, sessionExpired } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already logged in: go where the user was heading (or to their trips).
  const from = (location.state as { from?: string } | null)?.from ?? '/trips';
  if (user) return <Navigate to={from} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault(); // stop the browser's own form submission (a full page reload)
    setError(null);

    // Client-side checks give instant feedback. They are a convenience, NOT security:
    // anyone can skip them with curl, which is why the API validates everything again.
    const errs: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(email)) errs.email = 'Enter a valid email address';
    if (mode === 'register' && password.length < 10) errs.password = 'Use at least 10 characters'; // pragma: allowlist secret (a UI message, not a password)
    if (!password) errs.password = 'Enter your password'; // pragma: allowlist secret (a UI message, not a password)
    setClientErrors(errs);
    if (Object.keys(errs).length) return;

    setSubmitting(true);
    try {
      await (mode === 'login' ? login(email, password) : register(email, password));
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  const serverErrors = fieldErrors(error);
  return (
    <main className="narrow">
      <h1>{mode === 'login' ? 'Log in' : 'Create an account'}</h1>
      {sessionExpired && mode === 'login' && <p className="notice">Your session has ended. Please log in again.</p>}
      <form onSubmit={onSubmit} noValidate>
        <Field label="Email" name="email" type="email" autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)} error={clientErrors.email ?? serverErrors.email} />
        <Field label="Password" name="password" type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password}
          onChange={(e) => setPassword(e.target.value)} error={clientErrors.password ?? serverErrors.password} />
        <ErrorBanner error={error} />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>
      <p>
        {mode === 'login' ? (
          <>No account? <Link to="/register">Create one</Link></>
        ) : (
          <>Already registered? <Link to="/login">Log in</Link></>
        )}
      </p>
    </main>
  );
}
