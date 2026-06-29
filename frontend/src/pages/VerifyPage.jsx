import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../api';

export default function VerifyPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      setMessage('No verification token found.');
      return;
    }
    api(`/auth/verify?token=${token}`, { method: 'GET' })
      .then(() => { setStatus('success'); setMessage('Email verified successfully! You can now log in.'); })
      .catch(e => { setStatus('error'); setMessage(e.message || 'Verification failed. The link may have expired.'); });
  }, [searchParams]);

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
    </div>
  );
}
