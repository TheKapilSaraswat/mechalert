import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../api';

export default function VerifyPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState(undefined);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      setStatus('loading');
      api(`/auth/verify?token=${token}`, { method: 'GET' })
        .then(() => { setStatus('success'); setMessage('Email verified successfully! You can now log in.'); })
        .catch(e => { setStatus('error'); setMessage(e.message || 'Verification failed. The link may have expired.'); });
    } else {
      setStatus('otp');
    }
  }, [searchParams]);

  const handleOtpVerify = async (e) => {
    e.preventDefault();
    if (!email || !otp || otp.length !== 6) return;
    setLoading(true);
    try {
      await api('/auth/verify-otp', {
        method: 'POST', body: JSON.stringify({ email, otp }),
      });
      setStatus('success');
      setMessage('Email verified successfully! You can now log in.');
    } catch (err) {
      setMessage(err.data?.error || 'Verification failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: '60px auto', textAlign: 'center' }}>
      {status === 'loading' && <p>Verifying your email...</p>}
      {status === 'success' && (
        <div>
          <h2 style={{ color: '#3fb950' }}>Verified ✓</h2>
          <p>{message}</p>
          <Link to="/login" style={{ color: '#58a6ff' }}>Go to Login</Link>
        </div>
      )}
      {status === 'error' && (
        <div>
          <h2 style={{ color: '#f85149' }}>Verification Failed</h2>
          <p>{message}</p>
          <Link to="/login" style={{ color: '#58a6ff' }}>Back to Login</Link>
        </div>
      )}
      {status === 'otp' && (
        <div>
          <h2 style={{ marginBottom: 16 }}>Verify Your Email</h2>
          <p style={{ color: '#8b949e', marginBottom: 20, fontSize: '0.9rem' }}>
            Enter the 6-digit code sent to your email.
          </p>
          <form onSubmit={handleOtpVerify} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              placeholder="Your email address"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
            />
            <input
              placeholder="6-digit code"
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              style={{ textAlign: 'center', fontSize: '1.2rem', letterSpacing: 6, fontFamily: 'monospace' }}
              maxLength={6}
              required
            />
            <button type="submit" className="btn btn-primary" disabled={loading || otp.length !== 6 || !email}>
              {loading ? 'Verifying...' : 'Verify'}
            </button>
          </form>
          {message && <p style={{ color: '#f85149', marginTop: 12, fontSize: '0.85rem' }}>{message}</p>}
          <p style={{ marginTop: 16 }}>
            <Link to="/login" style={{ color: '#58a6ff', fontSize: '0.85rem' }}>Back to Login</Link>
          </p>
        </div>
      )}
    </div>
  );
}
