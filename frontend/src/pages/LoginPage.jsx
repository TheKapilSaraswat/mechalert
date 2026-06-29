import { useState } from 'react';
import { useAuth } from '../AuthContext';
import { useNavigate, Link, Navigate } from 'react-router-dom';

export default function LoginPage() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState(null);
  const [resendSent, setResendSent] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState(null);

  if (user) return <Navigate to="/dashboard" />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setUnverifiedEmail(null);
    setResendSent(false);
    setRegisteredEmail(null);
    if (!email.trim()) return setError('Please enter your email address.');
    if (!password) return setError('Please enter your password.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (isRegister && password !== confirmPassword) return setError('Passwords do not match.');
    setLoading(true);
    try {
      if (isRegister) {
        await register(email, password);
        setRegisteredEmail(email);
        setLoading(false);
        return;
      } else {
        await login(email, password);
        navigate('/dashboard');
      }
    } catch (err) {
      const msg = err.message || '';
      if (err.data?.needsVerification) {
        setUnverifiedEmail(err.data.email || email);
      } else if (msg.includes('Email already registered')) {
        setError('An account with this email already exists. Please sign in instead.');
      } else if (msg.includes('Invalid credentials') || msg.includes('Invalid email or password')) {
        setError('Invalid email or password. Please try again.');
      } else if (msg.includes('Server error')) {
        setError('Server error. Please try again later.');
      } else if (msg.includes('NetworkError') || msg.includes('Failed to fetch')) {
        setError('Cannot connect to server. Check your internet connection.');
      } else {
        setError(msg || 'An unexpected error occurred. Please try again.');
      }
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResendSent(false);
    try {
      await fetch('/api/auth/resend-verification', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: unverifiedEmail }),
      });
      setResendSent(true);
    } catch { setError('Failed to resend. Try again.'); }
  };

  const handleSwitchToRegister = () => { setIsRegister(true); setError(''); setUnverifiedEmail(null); setResendSent(false); setRegisteredEmail(null); };
  const handleSwitchToLogin = () => { setIsRegister(false); setError(''); setUnverifiedEmail(null); setResendSent(false); setRegisteredEmail(null); };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>{isRegister ? 'Create Account' : 'Sign In'}</h2>
        <form onSubmit={handleSubmit}>
          <input
            placeholder="Email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoFocus
          />
          <input
            placeholder="Password (min 8 chars)"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
          />
          {isRegister && (
            <input
              placeholder="Confirm password"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              minLength={8}
            />
          )}
          {error && <div className="alert alert-error" style={{ margin: '8px 0', fontSize: '0.85rem' }}>{error}</div>}
          {registeredEmail ? (
            <div style={{ textAlign: 'center', margin: '12px 0' }}>
              <p style={{ color: '#3fb950' }}>Account created! Check your email for a verification link.</p>
            </div>
          ) : unverifiedEmail ? (
            <div style={{ textAlign: 'center', margin: '12px 0' }}>
              <p style={{ color: '#f0883e' }}>Email not verified. Check your inbox.</p>
              <button type="button" className="btn btn-secondary btn-block" onClick={handleResend} disabled={resendSent}>
                {resendSent ? 'Verification email sent!' : 'Resend verification email'}
              </button>
            </div>
          ) : (
            <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
              {loading ? 'Please wait...' : isRegister ? 'Create Account' : 'Sign In'}
            </button>
          )}
        </form>
        <p className="auth-toggle">
          {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button className="link-btn" onClick={isRegister ? handleSwitchToLogin : handleSwitchToRegister}>{isRegister ? 'Sign In' : 'Register'}</button>
        </p>
        {!isRegister && !unverifiedEmail && !registeredEmail && (
          <p className="auth-toggle" style={{ marginTop: 8 }}>
            <Link to="/forgot">Forgot password?</Link>
          </p>
        )}
      </div>
    </div>
  );
}
