import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { useNavigate } from 'react-router-dom';

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: 'forever',
    features: [
      '3 alert rules max',
      'Email notifications only',
      'Scan once per day',
      'Reddit RSS (8 subreddits)',
      'Craigslist (5 metro areas)',
      'AI deal scoring',
      'Basic keyword matching',
    ],
    cta: 'Get Started',
    popular: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$2.99',
    period: '/month',
    features: [
      'Unlimited alert rules',
      'Email + Discord + Telegram + Slack + ntfy + Pushover',
      'Scan every 3 hours',
      'Price filters & history tracking',
      'Deal collections & folders',
      'Price drop alerts',
      'AI deal explanations',
      'Smart notification filters',
      'Daily insights dashboard',
      'User statistics & gamification',
      'All data sources included',
    ],
    cta: 'Subscribe',
    popular: true,
    badge: 'Best Value',
  },
];

const PAYMENT_METHODS = [
  { id: 'razorpay', label: 'UPI / NetBanking', icon: '🇮🇳', desc: 'India only' },
  { id: 'paypal', label: 'PayPal', icon: '🅿️', desc: 'Global' },
];

function priceINR(amount) {
  return `₹${(amount / 100).toLocaleString('en-IN')}`;
}

export default function PricingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState(null);
  const [config, setConfig] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('razorpay');
  const [razorpayReady, setRazorpayReady] = useState(false);
  const razorpayChecked = useRef(false);

  useEffect(() => {
    api('/config').then(setConfig).catch(() => setConfig(null));
    api('/track', { method: 'POST', body: JSON.stringify({ path: '/pricing' }) }).catch(() => {});
  }, []);

  useEffect(() => {
    if (razorpayChecked.current || paymentMethod !== 'razorpay') return;
    razorpayChecked.current = true;
    if (window.Razorpay && typeof window.Razorpay === 'function') {
      setRazorpayReady(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => setRazorpayReady(true);
    script.onerror = () => {};
    document.body.appendChild(script);
  }, [paymentMethod]);

  function getPrice(plan) {
    if (plan.id === 'free') return 'Free';
    if (!config) return '$2.99';
    if (paymentMethod === 'razorpay') return priceINR(config.razorpay.pro.monthly);
    return '$2.99';
  }

  async function handleRazorpay(planId) {
    if (!window.Razorpay) throw new Error('Payment gateway not loaded. Please refresh.');
    const orderData = await api('/razorpay/create-order', {
      method: 'POST',
      body: JSON.stringify({ plan: 'pro', email: user.email }),
    });

    return new Promise((resolve, reject) => {
      try {
        const rzp = new window.Razorpay({
          key: orderData.razorpay_key,
          amount: orderData.amount,
          currency: orderData.currency,
          name: 'MechAlert',
          description: 'Pro Monthly',
          prefill: { email: user.email },
          handler: async (response) => {
            try {
              await api('/razorpay/verify', {
                method: 'POST',
                body: JSON.stringify({
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_signature: response.razorpay_signature,
                  plan: 'pro',
                }),
              });
              navigate('/dashboard?upgrade=success');
              resolve();
            } catch {
              reject(new Error('Payment verification failed. Please contact support.'));
            }
          },
          modal: {
            ondismiss: () => {
              setLoading(null);
              reject(new Error('Payment cancelled'));
            },
          },
        });
        rzp.open();
      } catch {
        reject(new Error('Failed to initialize payment.'));
      }
    });
  }

  async function handlePayPal() {
    const data = await api('/paypal/create-order', {
      method: 'POST',
      body: JSON.stringify({ plan: 'pro', email: user.email }),
    });
    window.location.href = data.approval_url;
  }

  function isReady(plan) {
    if (plan.id === 'free') return true;
    if (!config) return false;
    if (paymentMethod === 'razorpay') return !!config.razorpay?.key;
    return !!config.paypal?.clientId;
  }

  const handleSubscribe = async (plan) => {
    if (!user) return navigate('/login');
    if (plan.id === 'free') return navigate('/');
    if (!config) return setError('Loading...');
    if (!isReady(plan)) return setError('Payment not configured.');
    setLoading(plan.id);
    setError(null);
    try {
      if (paymentMethod === 'razorpay') await handleRazorpay(plan.id);
      else await handlePayPal();
    } catch (err) {
      if (err.message !== 'Payment cancelled') setError(err.message || 'Payment failed.');
      setLoading(null);
    }
  };

  const currentTier = user?.tier || (user?.is_premium ? 'pro' : 'free');

  return (
    <div className="pricing-page">
      <div className="hero" style={{ padding: '60px 20px 40px' }}>
        <h1>Find better deals, faster</h1>
        <p className="hero-sub">Know in seconds if a deal is worth buying. Never overpay or get scammed.</p>
      </div>

      <div className="payment-method-selector">
        <span className="payment-method-label">Pay with:</span>
        <div className="payment-methods">
          {PAYMENT_METHODS.map(m => (
            <button key={m.id} className={`payment-method-btn ${paymentMethod === m.id ? 'active' : ''}`}
              onClick={() => setPaymentMethod(m.id)}>
              <span className="payment-icon">{m.icon}</span>
              <span className="payment-info">
                <span className="payment-name">{m.label}</span>
                <span className="payment-desc">{m.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ textAlign: 'center', marginBottom: 20 }}>{error}</div>}
      <div className="pricing-grid">
        {PLANS.map(plan => {
          const isCurrent = user && currentTier === plan.id && plan.id !== 'free';
          return (
          <div key={plan.id} className={`pricing-card ${plan.popular ? 'popular' : ''}`}>
            {plan.badge && <div className="popular-badge">{plan.badge}</div>}
            <div className="pricing-header">
              <h3>{plan.name}</h3>
              <div className="pricing-price">
                <span className="price">{getPrice(plan)}</span>
                {plan.id !== 'free' && <span className="period">{plan.period}</span>}
              </div>
            </div>
            <ul className="pricing-features">
              {plan.features.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
            <button
              className={`btn ${plan.popular ? 'btn-primary' : 'btn-secondary'} pricing-cta`}
              onClick={() => handleSubscribe(plan)}
              disabled={loading === plan.id || (plan.id !== 'free' && !config)}
            >
              {loading === plan.id ? 'Processing...'
              : isCurrent ? 'Your Plan'
              : plan.id === 'free' ? 'Get Started'
              : `Subscribe ${getPrice(plan)}/mo`}
            </button>
          </div>
          );
        })}
      </div>

      <div className="pricing-faq">
        <h3>FAQ</h3>
        <details className="pricing-faq-item">
          <summary>What do I get with Pro?</summary>
          <p>Pro gives you unlimited alert rules, all notification platforms (Discord, Telegram, Slack), price filters & history, daily insights, deal collections, price drop alerts, AI deal explanations, scam detection, API access, and much more.</p>
        </details>
        <details className="pricing-faq-item">
          <summary>Can I cancel anytime?</summary>
          <p>Yes. Cancel from your dashboard and keep access until the billing period ends.</p>
        </details>
        <details className="pricing-faq-item">
          <summary>What payment methods do you accept?</summary>
          <p>UPI / NetBanking (Razorpay) and PayPal. We never store your card details.</p>
        </details>
        <details className="pricing-faq-item">
          <summary>Is there a free trial?</summary>
          <p>The free tier is always available. Upgrade only when you need more power.</p>
        </details>
      </div>
    </div>
  );
}
