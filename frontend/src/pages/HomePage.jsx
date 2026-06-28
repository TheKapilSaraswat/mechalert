import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';

export default function HomePage() {
  const { user } = useAuth();
  return (
    <div className="home">
      <div className="hero">
        <h1>Never Miss a Deal Again</h1>
        <p className="hero-sub">
          Get instant alerts when deals are posted across <strong>8 subreddits</strong> (RSS) and <strong>Craigslist</strong>.
          AI-scored, keyword-matched, delivered to your email, Discord, or Telegram.
        </p>
        <div className="hero-actions">
          {user ? (
            <Link to="/dashboard" className="btn btn-primary">Go to Dashboard</Link>
          ) : (
            <Link to="/login" className="btn btn-primary">Get Started Free</Link>
          )}
        </div>
      </div>

      <div className="features">
        <div className="feature-card">
          <div className="feature-icon">🔍</div>
          <h3>Keyword Alerts</h3>
          <p>Monitor across Reddit (8 subreddits) and Craigslist (5 metro areas). Exact match or partial — your choice.</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon">⚡</div>
          <h3>Real-time Notifications</h3>
          <p>Get alerts on Discord or Telegram within minutes of a new post. Items sell fast — don't be late.</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon">💰</div>
          <h3>Price Filters</h3>
          <p>Set a max price and only get alerted for deals in your budget. No noise, just what you want.</p>
        </div>
      </div>

      <div className="steps">
        <h2>How it works</h2>
        <div className="steps-list">
          <div className="step"><span className="step-num">1</span> Create an account</div>
          <div className="step"><span className="step-num">2</span> Add keywords like "Keychron Q1" or "GMK Olivia"</div>
          <div className="step"><span className="step-num">3</span> Enter your email (or Discord/Telegram for power users)</div>
          <div className="step"><span className="step-num">4</span> Get alerts when matches are posted</div>
        </div>
      </div>

      <div className="pricing-cta">
        <h2>Free to start</h2>
        <p>3 keywords, email alerts, free forever. Upgrade to Premium for Discord/Telegram + price filters.</p>
        {!user && <Link to="/login" className="btn btn-secondary">Start Free</Link>}
      </div>

      <div style={{ marginTop: 60, paddingTop: 20, borderTop: '1px solid #21262d', textAlign: 'center', fontSize: '0.8rem', color: '#8b949e' }}>
        <Link to="/privacy" style={{ color: '#8b949e', textDecoration: 'none' }}>Privacy Policy</Link>
        <span style={{ margin: '0 8px', color: '#30363d' }}>·</span>
        <Link to="/contact" style={{ color: '#8b949e', textDecoration: 'none' }}>Contact</Link>
      </div>
    </div>
  );
}
