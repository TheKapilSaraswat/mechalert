import { useState } from 'react';
import { Link } from 'react-router-dom';

const EMAIL = 'mechalerthere@gmail.com';

export default function ContactPage() {
  const [copied, setCopied] = useState(false);

  const copyEmail = () => {
    navigator.clipboard.writeText(EMAIL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '20px 0' }}>
      <Link to="/" style={{ color: '#58a6ff', fontSize: '0.85rem' }}>← Back to Home</Link>

      <h1 style={{ marginTop: 20 }}>Contact</h1>

      <section style={{ marginTop: 28 }}>
        <h3 style={{ color: '#f0f6fc' }}>Get in Touch</h3>
        <p>Have questions, feedback, or need help? Reach out via email and we'll get back to you.</p>
      </section>

      <section style={{ marginTop: 32, padding: 24, border: '1px solid #30363d', borderRadius: 8, textAlign: 'center' }}>
        <p style={{ color: '#8b949e', marginBottom: 12 }}>Send us an email</p>
        <a
          href={`mailto:${EMAIL}`}
          style={{ color: '#58a6ff', fontSize: '1.1rem', textDecoration: 'none' }}
        >
          {EMAIL}
        </a>
        <div style={{ marginTop: 16 }}>
          <button
            onClick={copyEmail}
            style={{
              background: '#21262d',
              color: '#c9d1d9',
              border: '1px solid #30363d',
              padding: '8px 20px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            {copied ? 'Copied ✓' : 'Copy Email'}
          </button>
        </div>
      </section>
    </div>
  );
}
