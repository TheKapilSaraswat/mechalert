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

  if (user) return <Navigate to="/dashboard" />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) return setError('Please enter your email address.');
    if (!password) return setError('Please enter your password.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (isRegister && password !== confirmPassword) return setError('Passwords do not match.');
    setLoading(true);
    try {
      if (isRegister) await register(email, password);
      else await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('Email already registered')) {
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
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Please wait...' : isRegister ? 'Create Account' : 'Sign In'}
          </button>
        </form>
        <p className="auth-toggle">
          {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button className="link-btn" onClick={() => { setIsRegister(!isRegister); setError(''); }}>{isRegister ? 'Sign In' : 'Register'}</button>
        </p>
        {!isRegister && (
          <p className="auth-toggle" style={{ marginTop: 8 }}>
            <Link to="/forgot">Forgot password?</Link>
          </p>
        )}
      </div>
    </div>
  );
}
