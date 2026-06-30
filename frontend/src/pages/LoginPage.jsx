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
  const [otp, setOtp] = useState('');
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpError, setOtpError] = useState('');

  if (user) return <Navigate to="/dashboard" />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setUnverifiedEmail(null);
    setOtp('');
    setOtpSent(false);
    setOtpError('');
    if (!email.trim()) return setError('Please enter your email address.');
    if (!password) return setError('Please enter your password.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (isRegister && password !== confirmPassword) return setError('Passwords do not match.');
    setLoading(true);
    try {
      if (isRegister) {
        await register(email, password);
        const normalizedEmail = email.trim().toLowerCase();
        setUnverifiedEmail(normalizedEmail);
        setOtpSent(true);
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
        setOtpSent(true);
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

  const handleVerifyOtp = async () => {
    if (!otp || otp.length !== 6) return setOtpError('Enter a valid 6-digit code');
    setOtpVerifying(true);
    setOtpError('');
    try {
      await fetch('/api/auth/verify-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: unverifiedEmail, otp }),
      });
      setOtpVerifying(false);
      setOtpSent(false);
      setUnverifiedEmail(null);
      setOtp('');
      // Try logging in automatically after verification
      try {
        await login(email, password);
        navigate('/dashboard');
      } catch {
        setError('Email verified! You can now sign in.');
      }
    } catch (err) {
      setOtpVerifying(false);
      if (err.data?.error?.includes('expired')) {
        setOtpError('Code expired. Request a new one.');
      } else {
        setOtpError(err.data?.error || 'Invalid code. Try again.');
      }
    }
  };

  const handleResend = async () => {
    setOtpSent(true);
    setOtp('');
    setOtpError('');
    try {
      await fetch('/api/auth/resend-verification', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: unverifiedEmail }),
      });
    } catch { setError('Failed to resend. Try again.'); }
  };

  const handleSwitchToRegister = () => { setIsRegister(true); setError(''); setUnverifiedEmail(null); setOtp(''); setOtpSent(false); setOtpError(''); };
  const handleSwitchToLogin = () => { setIsRegister(false); setError(''); setUnverifiedEmail(null); setOtp(''); setOtpSent(false); setOtpError(''); };

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
          {unverifiedEmail && otpSent ? (
            <div style={{ textAlign: 'center', margin: '12px 0' }}>
              <p style={{ color: '#f0883e', marginBottom: 8 }}>
                {isRegister ? 'Account created!' : 'Email not verified.'} Enter the 6-digit code sent to your email.
              </p>
              <input
                placeholder="Enter 6-digit code"
                value={otp}
                onChange={e => { setOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); setOtpError(''); }}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid #30363d',
                  background: '#0d1117', color: '#c9d1d9', fontSize: '1.2rem', textAlign: 'center',
                  letterSpacing: 6, fontFamily: 'monospace', marginBottom: 8, boxSizing: 'border-box',
                }}
                maxLength={6}
                autoFocus
              />
              {otpError && <div style={{ color: '#f85149', fontSize: '0.8rem', marginBottom: 8 }}>{otpError}</div>}
              <button type="button" className="btn btn-primary btn-block" disabled={otpVerifying || otp.length !== 6} onClick={handleVerifyOtp}>
                {otpVerifying ? 'Verifying...' : 'Verify Email'}
              </button>
              <button type="button" className="btn btn-secondary btn-block" onClick={handleResend} style={{ marginTop: 6, fontSize: '0.8rem' }}>
                Resend code
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
        {!isRegister && !unverifiedEmail && (
          <p className="auth-toggle" style={{ marginTop: 8 }}>
            <Link to="/forgot">Forgot password?</Link>
          </p>
        )}
      </div>
    </div>
  );
}
