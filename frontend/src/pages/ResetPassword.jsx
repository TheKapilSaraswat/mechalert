import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../api';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token) return setError('Missing reset token. Use the link from your email.');
    if (password !== confirmPassword) return setError('Passwords do not match.');
    setSubmitting(true);
    setError(null);
    try {
      await api('/auth/reset', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
    } catch (err) {
      setError(err.message || 'Reset failed. The link may have expired.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <h2>Invalid Link</h2>
          <p style={{ color: '#8b949e', marginBottom: 20 }}>This reset link is missing the token. Please check your email for the full link.</p>
          <Link to="/forgot" className="btn btn-primary">Request New Link</Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <h2>Password Reset</h2>
          <p style={{ color: '#3fb950', marginBottom: 20 }}>Your password has been updated successfully.</p>
          <Link to="/login" className="btn btn-primary">Sign In</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Set New Password</h2>
        <form onSubmit={handleSubmit}>
          {error && <div className="alert alert-error">{error}</div>}
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="New password (min 8 chars)"
            required
            minLength={8}
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            required
            minLength={8}
          />
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>
        <div className="auth-toggle">
          <Link to="/login">Back to login</Link>
        </div>
      </div>
    </div>
  );
}
