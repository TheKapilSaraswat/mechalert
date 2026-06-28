import { Link } from 'react-router-dom';

export default function PrivacyPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '20px 0' }}>
      <Link to="/" style={{ color: '#58a6ff', fontSize: '0.85rem' }}>← Back to Home</Link>

      <h1 style={{ marginTop: 20 }}>Privacy Policy</h1>
      <p style={{ color: '#8b949e', fontSize: '0.85rem' }}>Last updated: June 19, 2026</p>

      <section style={{ marginTop: 28 }}>
        <h3 style={{ color: '#f0f6fc' }}>1. Information We Collect</h3>
        <p>We collect only the information you provide: your email address (for login and alerts), and the keywords and notification preferences you configure in your alert rules.</p>
      </section>

      <section style={{ marginTop: 24 }}>
        <h3 style={{ color: '#f0f6fc' }}>2. How We Use Your Information</h3>
        <p>Your email is used to authenticate you and send deal alerts you've configured. Your keywords and notification targets are stored to match against scanned posts and deliver notifications. We do not share your personal information with third parties.</p>
      </section>

      <section style={{ marginTop: 24 }}>
        <h3 style={{ color: '#f0f6fc' }}>3. Data Sources</h3>
        <p>We scan publicly available content from Reddit (via RSS feeds) and Craigslist (via HTML scraping). No user data is sent to these platforms — we only read publicly accessible listings.</p>
      </section>

      <section style={{ marginTop: 24 }}>
        <h3 style={{ color: '#f0f6fc' }}>4. Payment Processing</h3>
        <p>Premium subscriptions are processed by Razorpay and PayPal. We do not store your payment card details. Razorpay and PayPal handle all payment data in compliance with PCI-DSS standards. Your payment provider and subscription ID are stored for billing purposes only.</p>
      </section>

      <section style={{ marginTop: 24 }}>
        <h3 style={{ color: '#f0f6fc' }}>5. AI Deal Scoring</h3>
        <p>Post titles and descriptions may be sent to OpenRouter (OpenAI-compatible API) for AI-based deal scoring. No personally identifiable information is included in these requests.</p>
      </section>

      <section style={{ marginTop: 24 }}>
        <h3 style={{ color: '#f0f6fc' }}>6. Data Retention</h3>
        <p>Scanned posts are retained for the duration of the service. You may delete your account at any time by contacting us, which removes your user data, alert rules, and saved deals. Scanned posts from public sources may remain as they are not linked to your account.</p>
      </section>

      <section style={{ marginTop: 24 }}>
        <h3 style={{ color: '#f0f6fc' }}>7. Third-Party Services</h3>
        <p>We use the following third-party services: Railway (hosting), Resend (email delivery), Razorpay and PayPal (payments), OpenRouter (AI scoring), and Discord/Telegram/Slack/ntfy/Pushover (notification delivery). Each service has its own privacy policy governing data handling.</p>
      </section>

      <section style={{ marginTop: 24 }}>
        <h3 style={{ color: '#f0f6fc' }}>8. Contact</h3>
        <p>For questions about this policy, contact <a href="mailto:mechalerthere@gmail.com" style={{ color: '#58a6ff' }}>mechalerthere@gmail.com</a>.</p>
      </section>

      <div style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid #21262d', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem' }}>
        <Link to="/" style={{ color: '#58a6ff' }}>MechAlert</Link>
      </div>
    </div>
  );
}
