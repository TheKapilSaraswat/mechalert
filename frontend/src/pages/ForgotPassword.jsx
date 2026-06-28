import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    setMsg('');
    try {
      const data = await api('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setMsg(data.message || 'Check your email for the reset link.');
    } catch (err) {
      setErr(err.message);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Reset Password</h2>
        {msg && <div className="alert alert-success">{msg}</div>}
        {err && <div className="alert alert-error">{err}</div>}
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button type="submit" className="btn btn-primary btn-block">Send Reset Link</button>
        </form>
        <div className="auth-toggle">
          <Link to="/login">Back to Sign In</Link>
        </div>
      </div>
    </div>
  );
}
