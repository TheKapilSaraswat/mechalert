import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { Link } from 'react-router-dom';

function scoreBadge(score) {
  if (!score && score !== 0) return null;
  const color = score >= 80 ? '#3fb950' : score >= 50 ? '#d29922' : '#f85149';
  const label = score >= 80 ? 'Hot' : score >= 50 ? 'Good' : 'Skip';
  return <span className="score-badge" style={{ background: color }} title={`AI Score: ${Math.round(score)}/100`}>{label} {Math.round(score)}</span>;
}

function sourceIcon(source) {
  const icons = { reddit: '🔴', craigslist: '📋' };
  return <span className="source-icon" title={source}>{icons[source] || '🔗'}</span>;
}

export default function Dashboard() {
  const { user } = useAuth();
  const tier = user?.tier || 'free';
  const [rules, setRules] = useState([]);
  const [matches, setMatches] = useState([]);
  const [stats, setStats] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [keywords, setKeywords] = useState('');
  const [notifyTarget, setNotifyTarget] = useState('');
  const [notifyType, setNotifyType] = useState('email');
  const [subreddit, setSubreddit] = useState('mechmarket');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [scanInterval, setScanInterval] = useState(1440);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [manageLoading, setManageLoading] = useState(false);
  const [savedDeals, setSavedDeals] = useState([]);
  const [showSaved, setShowSaved] = useState(false);
  const [savedNotes, setSavedNotes] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [toasts, setToasts] = useState([]);

  const addToast = (msg, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  };

  const FREE_LIMIT = 3;

  const loadData = () => {
    setError(null);
    setLoading(true);
    Promise.all([
      api('/alerts').then(setRules),
      api('/matches').then(setMatches),
      api('/stats').then(setStats),
      api('/saved-deals').then(d => { setSavedDeals(d); const n = {}; d.forEach(s => { n[s.id] = s.notes || ''; }); setSavedNotes(n); }),
      api('/collections').then(setCollections).catch(() => {}),
    ]).catch(err => setError(err.message || 'Failed to load data')).finally(() => setLoading(false));
    api('/track', { method: 'POST', body: JSON.stringify({ path: '/dashboard' }) }).catch(() => {});
  };

  useEffect(loadData, []);

  const refresh = () => {
    Promise.all([
      api('/alerts').then(setRules),
      api('/matches').then(setMatches),
      api('/stats').then(setStats),
      api('/saved-deals').then(setSavedDeals),
    ]).catch(err => setError(err.message || 'Failed to refresh'));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        keywords, notify_type: notifyType, notify_target: notifyTarget, subreddit,
        min_price: minPrice ? parseFloat(minPrice) : null,
        max_price: maxPrice ? parseFloat(maxPrice) : null,
        scan_interval: tier !== 'free' ? (scanInterval || null) : null,
      };
      if (editingId) {
        await api(`/alerts/${editingId}`, { method: 'PUT', body: JSON.stringify(body) });
        addToast('Rule updated');
      } else {
        await api('/alerts', { method: 'POST', body: JSON.stringify(body) });
        addToast('Rule created');
      }
      setShowForm(false);
      setEditingId(null);
      setKeywords('');
      setNotifyTarget('');
      setMinPrice('');
      setMaxPrice('');
      refresh();
    } catch (err) {
      setError(err.message);
      addToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const edit = (rule) => {
    setError(null);
    setKeywords(rule.keywords);
    setNotifyType(rule.notify_type);
    setNotifyTarget(rule.notify_target || (rule.notify_type === 'email' ? (user?.email || '') : ''));
    setSubreddit(rule.subreddit || 'mechmarket');
    setMinPrice(rule.min_price || '');
    setMaxPrice(rule.max_price || '');
    setScanInterval(rule.scan_interval || 1440);
    setEditingId(rule.id);
    setShowForm(true);
  };

  const toggleActive = async (rule) => {
    try {
      await api(`/alerts/${rule.id}`, { method: 'PUT', body: JSON.stringify({ is_active: rule.is_active ? 0 : 1 }) });
      refresh();
      addToast(rule.is_active ? 'Rule paused' : 'Rule resumed');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const providerLabels = { razorpay: 'UPI / NetBanking', paypal: 'PayPal' };

  const remove = async (id) => {
    try {
      await api(`/alerts/${id}`, { method: 'DELETE' });
      refresh();
      addToast('Rule deleted');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const saveDeal = async (postId) => {
    try {
      await api('/saved-deals', { method: 'POST', body: JSON.stringify({ post_id: postId }) });
      const deals = await api('/saved-deals');
      setSavedDeals(deals);
      addToast('Deal saved!');
    } catch (err) {
      addToast(err.message || 'Failed to save deal', 'error');
    }
  };

  const updateSavedNote = async (id) => {
    try {
      await api(`/saved-deals/${id}`, { method: 'PUT', body: JSON.stringify({ notes: savedNotes[id] }) });
      addToast('Note saved');
    } catch (err) {
      addToast(err.message || 'Failed to update note', 'error');
    }
  };

  const deleteSavedDeal = async (id) => {
    try {
      await api(`/saved-deals/${id}`, { method: 'DELETE' });
      setSavedDeals(prev => prev.filter(d => d.id !== id));
      addToast('Deal removed');
    } catch (err) {
      addToast(err.message || 'Failed to delete saved deal', 'error');
    }
  };

  const [priceHistory, setPriceHistory] = useState({});
  const [loadingHistory, setLoadingHistory] = useState({});
  const loadPriceHistory = async (postId) => {
    if (priceHistory[postId]) return;
    setLoadingHistory(prev => ({ ...prev, [postId]: true }));
    try {
      const data = await api(`/price-history/${postId}`);
      setPriceHistory(prev => ({ ...prev, [postId]: data }));
    } catch {
      addToast('Price history unavailable', 'error');
    } finally {
      setLoadingHistory(prev => ({ ...prev, [postId]: false }));
    }
  };

  const [digestFrequency, setDigestFrequency] = useState(user?.digest_frequency || 'never');
  const [savingDigest, setSavingDigest] = useState(false);
  const [sendingDigest, setSendingDigest] = useState(false);
  const [apiKey, setApiKey] = useState(user?.api_key || '');
  const [generatingKey, setGeneratingKey] = useState(false);

  const [collections, setCollections] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [collectionItems, setCollectionItems] = useState([]);
  const [showCollectionForm, setShowCollectionForm] = useState(false);
  const [collectionName, setCollectionName] = useState('');
  const [editingCollectionId, setEditingCollectionId] = useState(null);

  const handleSaveDigest = async () => {
    setSavingDigest(true);
    try {
      await api('/digest/preference', { method: 'PUT', body: JSON.stringify({ frequency: digestFrequency }) });
      addToast('Digest preference saved');
    } catch { addToast('Failed to save', 'error'); }
    finally { setSavingDigest(false); }
  };

  const handleSendDigestNow = async () => {
    setSendingDigest(true);
    try {
      const result = await api('/digest/send', { method: 'POST' });
      if (result.matches === 0) {
        addToast('No new matches to send. Digest scheduled for daily delivery.', 'info');
      } else {
        addToast(`Digest sent with ${result.matches} matches!`);
      }
    } catch (err) { addToast(err.message || 'Failed to send digest', 'error'); }
    finally { setSendingDigest(false); }
  };

  const handleRegenerateKey = async () => {
    setGeneratingKey(true);
    try {
      const data = await api('/settings/api-key');
      setApiKey(data.api_key);
      addToast('API key generated');
    } catch { addToast('Failed to generate key', 'error'); }
    finally { setGeneratingKey(false); }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const data = await api('/search', { method: 'POST', body: JSON.stringify({ query: searchQuery }) });
      setSearchResults(data);
      setActiveTab('search');
    } catch (err) {
      setError(err.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const notifyTypeHelp = {
    email: { placeholder: 'you@example.com', hint: 'Get alerts via email', free: true },
    discord: { placeholder: 'https://discord.com/api/webhooks/...', hint: 'Create in Discord: Server Settings → Integrations → Webhooks', free: false },
    telegram: { placeholder: '123456:ABC-DEF::987654321', hint: 'Create a bot via @BotFather, then use /id to get your chat ID', free: false },
    slack: { placeholder: 'https://hooks.slack.com/services/...', hint: 'Create in Slack: Apps → Incoming Webhooks', free: false },
    ntfy: { placeholder: 'mytopic', hint: 'Simple push notifications via ntfy.sh', free: false },
    pushover: { placeholder: 'user_key::api_token', hint: 'Pushover.net user key and API token separated by ::', free: false },
  };

  const ruleCount = rules.length;
  const remaining = tier === 'free' ? FREE_LIMIT - ruleCount : Infinity;
  const pct = tier === 'free' ? Math.min((ruleCount / FREE_LIMIT) * 100, 100) : 100;
  const limitColor = remaining <= 0 ? 'full' : remaining === 1 ? 'low' : remaining <= FREE_LIMIT / 2 ? 'medium' : 'high';

  const getDefaultScanInterval = () => {
    if (tier === 'pro') return 180;
    return 1440;
  };

  const achievements = [
    { id: 'price_hunter', label: 'Price Hunter', desc: 'Saved 10+ deals', check: (s) => (s?.savedDeals || 0) >= 10, progressKey: 'savedDeals', max: 10 },
    { id: 'deal_spotter', label: 'Deal Spotter', desc: 'Matched 50+ deals', check: (s) => (s?.matchesFound || 0) >= 50, progressKey: 'matchesFound', max: 50 },
    { id: 'notifications_pro', label: 'Notifications Pro', desc: '100+ notifications sent', check: (s) => (s?.notificationsSent || 0) >= 100, progressKey: 'notificationsSent', max: 100 },
  ];
  const unlockedAchievements = achievements.filter(a => a.check(stats));

  return (
    <div className="dashboard">
      {error && <div className="alert alert-error">{error}</div>}

      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>
        ))}
      </div>

      {loading ? (
        <div className="loading" style={{ textAlign: 'center', padding: 60 }}>Loading dashboard...</div>
      ) : (
        <>
      {stats && (
        <div className="stats-bar">
          <div className="stat"><span className="stat-num">{stats.totalListings || 0}</span> Total listings</div>
          <div className="stat"><span className="stat-num">{stats.matchesFound || 0}</span> Matches found</div>
          <div className="stat"><span className="stat-num">{stats.rulesActive || 0}</span> Active rules</div>
          <div className="stat"><span className="stat-num">{stats.searchesDone || 0}</span> Searches done</div>
          {stats.rareFinds > 0 && <div className="stat"><span className="stat-num">{stats.rareFinds}</span> Rare finds</div>}
        </div>
      )}

      {/* Sources Status */}
      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px 20px', marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: '1rem', color: '#f0f6fc' }}>📡 Active Sources</h3>
          <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>Free on all plans</span>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200, background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.3rem' }}>🔴</span>
            <div>
              <div style={{ fontWeight: 600, color: '#f0f6fc', fontSize: '0.9rem' }}>Reddit</div>
              <div style={{ fontSize: '0.75rem', color: '#8b949e' }}>RSS feed — 8 subreddits</div>
              <span style={{ fontSize: '0.7rem', color: '#3fb950' }}>● live</span>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 200, background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.3rem' }}>📋</span>
            <div>
              <div style={{ fontWeight: 600, color: '#f0f6fc', fontSize: '0.9rem' }}>Craigslist</div>
              <div style={{ fontSize: '0.75rem', color: '#8b949e' }}>HTML scrape — 5 metro areas</div>
              <span style={{ fontSize: '0.7rem', color: '#3fb950' }}>● live</span>
            </div>
          </div>
        </div>
      </div>

      <div className="sub-card" style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px 20px', marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ color: '#8b949e', fontSize: '0.8rem', marginBottom: 2 }}>Plan</div>
          <div style={{ fontWeight: 600, color: '#f0f6fc' }}>
            {tier === 'free' ? (
              <>Free <span style={{ color: '#8b949e', fontWeight: 400, fontSize: '0.85rem' }}>— 3 rule limit, 3h scans</span></>
            ) : (
              <>Pro ⚡{user?.payment_provider ? <span style={{ color: '#8b949e', fontWeight: 400, fontSize: '0.85rem' }}> via {providerLabels[user.payment_provider] || user.payment_provider}</span> : null}</>
            )}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#8b949e', marginTop: 4 }}>
            {tier === 'free' ? 'Scans every ~3h · No price filters' : 'Scans every ~10 min · Price filters · Price history · Collections · Digest · API access'}
          </div>
          {unlockedAchievements.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {achievements.map(a => (
                <span key={a.id} style={{
                  fontSize: '0.7rem',
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: a.check(stats) ? '#3fb950' : '#21262d',
                  color: a.check(stats) ? '#fff' : '#8b949e',
                }}>
                  {a.check(stats) ? '🏆' : '🔒'} {a.label}
                </span>
              ))}
              <span style={{ fontSize: '0.7rem', color: '#8b949e', padding: '2px 6px' }}>{unlockedAchievements.length}/{achievements.length}</span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tier === 'free' && (
            <Link to="/pricing" className="btn btn-primary" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>Upgrade to Pro</Link>
          )}
        </div>
      </div>

      {tier === 'free' && (
        <div className="rule-limit-bar">
          <span style={{ fontSize: '0.85rem', color: '#f0f6fc' }}>📋 Alert Rules</span>
          <div className="rule-limit-track">
            <div className={`rule-limit-fill ${limitColor}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="rule-limit-text">
            {remaining > 0 ? `${ruleCount}/${FREE_LIMIT} used (${remaining} left)` : 'Limit reached — upgrade for more'}
          </span>
        </div>
      )}

      {/* Natural Language Search */}
      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px 20px', marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder='Search deals naturally — e.g. "mechanical keyboard under $200" or "GMK keycaps"'
            style={{ flex: 1, padding: '10px 12px', borderRadius: 6, border: '1px solid #30363d', background: '#0d1117', color: '#c9d1d9', fontSize: '0.9rem' }}
          />
          <button className="btn btn-primary" onClick={handleSearch} disabled={searching}>
            {searching ? 'Searching...' : '🔍 AI Search'}
          </button>
        </div>
        {searchResults && (
          <div style={{ marginTop: 12 }}>
            {searchResults.interpreted && (
              <div style={{ fontSize: '0.8rem', color: '#8b949e', marginBottom: 8 }}>
                Interpreted: {JSON.stringify(searchResults.filters)}
              </div>
            )}
            {searchResults.results.length === 0 ? (
              <p style={{ color: '#8b949e', textAlign: 'center', padding: 20 }}>No deals found matching your query.</p>
            ) : (
              <div className="matches-list">
                {searchResults.results.slice(0, 10).map(r => (
                  <a key={r.id} href={r.permalink.startsWith('http') ? r.permalink : `https://reddit.com${r.permalink}`} target="_blank" rel="noopener noreferrer" className="match-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => api('/track-click', { method: 'POST', body: JSON.stringify({ post_id: r.post_id, permalink: r.permalink, source: r.source }) }).catch(() => {})}>
                    <div style={{ flex: 1 }}>
                      <div className="match-title">{sourceIcon(r.source)} {r.title}</div>
                      <div className="match-meta">
                        {r.price ? <span className="match-price">${r.price}</span> : null}
                        {scoreBadge(r.deal_score)}
                        <span style={{ color: '#484f58' }}>{new Date(r.scanned_at).toLocaleString()}</span>
                      </div>
                    </div>
                    <button className="btn-sm" onClick={(e) => { e.preventDefault(); saveDeal(r.post_id); }} style={{ marginLeft: 8 }}>Save</button>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="tab-bar">
        {['dashboard', 'rules', 'matches', 'saved'].map(tab => (
          <button key={tab} className={`tab-btn ${activeTab === tab ? 'tab-active' : ''}`}
            onClick={() => setActiveTab(tab)}>
            {tab === 'dashboard' ? '📊 Dashboard' : tab === 'rules' ? '📋 Alert Rules' : tab === 'matches' ? '⚡ Matches' : '💾 Saved Deals'}
          </button>
        ))}
        {tier === 'pro' && (
          <button className={`tab-btn ${activeTab === 'settings' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('settings')}>
            ⚙️ Settings
          </button>
        )}
        <Link to="/analytics" className="tab-btn" style={{ marginLeft: 'auto' }}>📊 Analytics</Link>
      </div>

      {activeTab === 'dashboard' && (
        <div>
          <h2 style={{ margin: '0 0 16px' }}>Dashboard Overview</h2>

          {/* Quick stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px 20px' }}>
              <div style={{ fontSize: '0.75rem', color: '#8b949e', marginBottom: 4 }}>Listings Watched</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f0f6fc' }}>{stats?.watchedListings || 0}</div>
            </div>
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px 20px' }}>
              <div style={{ fontSize: '0.75rem', color: '#8b949e', marginBottom: 4 }}>Matches Found</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f0f6fc' }}>{stats?.matchesFound || 0}</div>
            </div>
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px 20px' }}>
              <div style={{ fontSize: '0.75rem', color: '#8b949e', marginBottom: 4 }}>Rules Active</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f0f6fc' }}>{stats?.rulesActive || 0}</div>
            </div>
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px 20px' }}>
              <div style={{ fontSize: '0.75rem', color: '#8b949e', marginBottom: 4 }}>Saved Deals</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f0f6fc' }}>{stats?.savedDeals || 0}</div>
            </div>
          </div>

          {/* Key metrics */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.1rem' }}>💰</span>
              <div>
                <div style={{ fontSize: '0.7rem', color: '#8b949e' }}>Total Savings</div>
                <div style={{ fontWeight: 600, color: '#3fb950', fontSize: '1rem' }}>${stats?.totalSavings || 0}</div>
              </div>
            </div>
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.1rem' }}>🔥</span>
              <div>
                <div style={{ fontSize: '0.7rem', color: '#8b949e' }}>Rare Finds</div>
                <div style={{ fontWeight: 600, color: '#d29922', fontSize: '1rem' }}>{stats?.rareFinds || 0}</div>
              </div>
            </div>
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.1rem' }}>📉</span>
              <div>
                <div style={{ fontSize: '0.7rem', color: '#8b949e' }}>Price Drop Alerts</div>
                <div style={{ fontWeight: 600, color: '#58a6ff', fontSize: '1rem' }}>{stats?.priceDrops || 0}</div>
              </div>
            </div>
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.1rem' }}>🔔</span>
              <div>
                <div style={{ fontSize: '0.7rem', color: '#8b949e' }}>Notifications Sent</div>
                <div style={{ fontWeight: 600, color: '#f0f6fc', fontSize: '1rem' }}>{stats?.notificationsSent || 0}</div>
              </div>
            </div>
          </div>

          {/* Achievements */}
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 20, marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '0.95rem', color: '#f0f6fc' }}>🏆 Achievements</h3>
            {achievements.map(a => {
              const progress = Math.min((stats ? (stats[a.progressKey] || 0) : 0), a.max);
              const progPct = Math.min((progress / a.max) * 100, 100);
              return (
                <div key={a.id} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 4 }}>
                    <span style={{ color: a.check(stats) ? '#3fb950' : '#f0f6fc' }}>{a.check(stats) ? '🏆' : '🔒'} {a.label}</span>
                    <span style={{ color: '#8b949e' }}>{progress}/{a.max}</span>
                  </div>
                  <div className="rule-limit-track">
                    <div className="rule-limit-fill" style={{ width: `${progPct}%`, background: a.check(stats) ? '#3fb950' : '#d29922' }} />
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#8b949e', marginTop: 2 }}>{a.desc}</div>
                </div>
              );
            })}
          </div>

          {/* Recent Price Drops */}
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 20, marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem', color: '#f0f6fc' }}>📉 Recent Price Drops</h3>
            {stats?.recentDrops?.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {stats.recentDrops.map((drop, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#0d1117', borderRadius: 6, border: '1px solid #21262d' }}>
                    <span style={{ color: '#f0f6fc', fontSize: '0.85rem', flex: 1 }}>{drop.title}</span>
                    <span style={{ color: '#3fb950', fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', marginLeft: 12 }}>
                      ${drop.price}
                      {drop.old_price && <span style={{ color: '#f85149', textDecoration: 'line-through', marginLeft: 6, fontWeight: 400 }}>${drop.old_price}</span>}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: '#8b949e', fontSize: '0.85rem', textAlign: 'center', padding: 20 }}>No recent price drops.</p>
            )}
          </div>

          {/* Sources Breakdown */}
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 20, marginBottom: 24 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem', color: '#f0f6fc' }}>📊 Sources Breakdown</h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {stats?.bySource?.length > 0 ? stats.bySource.map((s, i) => (
                <div key={i} style={{ flex: 1, minWidth: 140, background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '12px 16px' }}>
                  <div style={{ fontSize: '1.3rem', marginBottom: 4 }}>{sourceIcon(s.source).props.children}</div>
                  <div style={{ fontWeight: 600, color: '#f0f6fc', fontSize: '0.9rem', textTransform: 'capitalize' }}>{s.source}</div>
                  <div style={{ fontSize: '0.75rem', color: '#8b949e' }}>{s.count} listings</div>
                </div>
              )) : (
                <p style={{ color: '#8b949e', fontSize: '0.85rem' }}>No source data available.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'rules' && (
        <>
      <div className="dash-header">
        <h2>Your Alert Rules</h2>
        <button className="btn btn-primary" onClick={() => { setShowForm(true); setEditingId(null); setKeywords(''); setNotifyTarget(user?.email || ''); setSubreddit('mechmarket'); setMinPrice(''); setMaxPrice(''); setScanInterval(getDefaultScanInterval()); setNotifyType('email') }}>+ New Rule</button>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{editingId ? 'Edit Rule' : 'New Alert Rule'}</h3>
            {error && <div className="alert alert-error">{error}</div>}
            <form onSubmit={handleSubmit}>
              <label>Keywords (comma-separated)</label>
              <input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="Keychron Q1, GMK Olivia, Artisan" required />
              <label>Source</label>
              <select value={subreddit} onChange={e => setSubreddit(e.target.value)}>
                <option value="mechmarket">r/mechmarket — Keyboards</option>
                <option value="hardwareswap">r/hardwareswap — PC Hardware</option>
                <option value="appleswap">r/appleswap — Apple</option>
                <option value="photomarket">r/photomarket — Cameras</option>
                <option value="homelabsales">r/homelabsales — Servers</option>
                <option value="AVexchange">r/AVexchange — Audio</option>
                <option value="gamesale">r/gamesale — Games</option>
                <option value="Pen_Swap">r/Pen_Swap — Pens</option>
                <option value="all">All Subreddits</option>
                <option value="craigslist">Craigslist</option>
              </select>
              <label>Get alerts via</label>
              <select value={notifyType} onChange={e => { setNotifyType(e.target.value); if (e.target.value === 'email' && !notifyTarget) setNotifyTarget(user?.email || ''); }}>
                <option value="email">📧 Email</option>
                <option value="discord">{tier !== 'free' ? '💬 Discord' : '💬 Discord (Premium)'}</option>
                <option value="telegram">{tier !== 'free' ? '✈️ Telegram' : '✈️ Telegram (Premium)'}</option>
                <option value="slack">{tier !== 'free' ? '🔷 Slack' : '🔷 Slack (Premium)'}</option>
                <option value="ntfy">{tier !== 'free' ? '🔔 ntfy.sh' : '🔔 ntfy.sh (Premium)'}</option>
                <option value="pushover">{tier !== 'free' ? '📱 Pushover' : '📱 Pushover (Premium)'}</option>
              </select>
              {(() => {
                const help = notifyTypeHelp[notifyType];
                return (
                  <>
                    <label>{notifyType === 'email' ? 'Your Email' : notifyType === 'ntfy' ? 'Topic Name' : 'Target'}</label>
                    <input value={notifyTarget} onChange={e => setNotifyTarget(e.target.value)} placeholder={help.placeholder} required />
                    <p className="field-hint">{help.hint}</p>
                  </>
                );
              })()}
              <div className="price-fields">
                <div>
                  <label>Min Price ($) {tier === 'free' && <span style={{ color: '#d29922', fontSize: '0.75rem' }}>🔒 Premium</span>}</label>
                  <input type="number" value={minPrice} onChange={e => setMinPrice(e.target.value)} placeholder="0" disabled={tier === 'free'} style={tier === 'free' ? { opacity: 0.5 } : {}} />
                </div>
                <div>
                  <label>Max Price ($) {tier === 'free' && <span style={{ color: '#d29922', fontSize: '0.75rem' }}>🔒 Premium</span>}</label>
                  <input type="number" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="1000" disabled={tier === 'free'} style={tier === 'free' ? { opacity: 0.5 } : {}} />
                </div>
              </div>
              <div>
                <label>Scan interval</label>
                <select value={scanInterval} onChange={e => setScanInterval(parseInt(e.target.value))}>
                  {tier === 'free' && (
                    <option value={1440}>Once per day</option>
                  )}
                  {tier === 'pro' && (
                    <>
                      <option value={30}>Every 30 minutes</option>
                      <option value={60}>Every 1 hour</option>
                      <option value={180}>Every 3 hours</option>
                      <option value={360}>Every 6 hours</option>
                      <option value={720}>Every 12 hours</option>
                    </>
                  )}
                </select>
                <p className="field-hint">How often to check for new matches</p>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary">{editingId ? 'Save' : 'Create'}</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {rules.length === 0 ? (
        <div className="empty-state">
          <p>No alert rules yet. Create your first one to start tracking deals!</p>
        </div>
      ) : (
        <div className="rules-list">
          {rules.map(rule => (
            <div key={rule.id} className={`rule-card ${rule.is_active ? '' : 'inactive'}`}>
              <div className="rule-info">
                <div className="rule-keywords">{rule.keywords}</div>
                <div className="rule-meta">
                  <span className="rule-sub">{rule.subreddit === 'craigslist' ? 'Craigslist' : `r/${rule.subreddit}`}</span>
                  {rule.min_price && <span className="rule-price">Min: ${rule.min_price}</span>}
                  {rule.max_price && <span className="rule-price">Max: ${rule.max_price}</span>}
                  <span className={`rule-type ${rule.notify_type}`}>{rule.notify_type}</span>
                  <span className={`rule-status ${rule.is_active ? 'active' : 'paused'}`}>{rule.is_active ? 'Active' : 'Paused'}</span>
                </div>
              </div>
              <div className="rule-actions">
                <button className="btn-sm" onClick={() => toggleActive(rule)}>{rule.is_active ? 'Pause' : 'Resume'}</button>
                <button className="btn-sm" onClick={() => edit(rule)}>Edit</button>
                <button className="btn-sm btn-danger" onClick={() => remove(rule.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
      </>
      )}

      {activeTab === 'matches' && (
        <>
      <h3 style={{ marginTop: 0 }}>Recent Matches</h3>
      {matches.length === 0 ? (
        <p className="empty-state">No matches yet. They'll appear here when your keywords are found.</p>
      ) : (
        <div className="matches-list">
          {matches.map(m => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <a href={m.permalink.startsWith('http') ? m.permalink : `https://reddit.com${m.permalink}`} target="_blank" rel="noopener noreferrer" className="match-card" style={{ flex: 1, marginRight: 8 }} onClick={() => api('/track-click', { method: 'POST', body: JSON.stringify({ post_id: m.post_id, permalink: m.permalink, source: m.source }) }).catch(() => {})}>
                <div className="match-title">
                  {sourceIcon(m.source)} {m.title}
                </div>
                <div className="match-meta">
                  <span className="match-keyword">Matched: {m.matched_keyword}</span>
                  {m.price ? <span className="match-price">${m.price}</span> : null}
                  {scoreBadge(m.deal_score)}
                  <span className="match-time">{new Date(m.sent_at).toLocaleString()}</span>
                </div>
              </a>
              <button className="btn-sm" onClick={() => saveDeal(m.post_id)} title="Save deal">💾</button>
            </div>
          ))}
        </div>
      )}
      </>
      )}

      {activeTab === 'saved' && (
        <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Saved Deals</h3>
        {tier === 'pro' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={selectedCollection || ''} onChange={e => {
              const id = e.target.value ? parseInt(e.target.value) : null;
              setSelectedCollection(id);
              if (id) api(`/collections/${id}/items`).then(setCollectionItems).catch(() => {});
              else setCollectionItems([]);
            }} style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid #30363d', background: '#0d1117', color: '#c9d1d9', fontSize: '0.8rem' }}>
              <option value="">All saved deals</option>
              {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="btn-sm" onClick={() => { setShowCollectionForm(true); setEditingCollectionId(null); setCollectionName(''); }}>+ Collection</button>
          </div>
        )}
      </div>

      {showCollectionForm && (
        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px', marginBottom: 16 }}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            try {
              if (editingCollectionId) {
                await api(`/collections/${editingCollectionId}`, { method: 'PUT', body: JSON.stringify({ name: collectionName }) });
              } else {
                await api('/collections', { method: 'POST', body: JSON.stringify({ name: collectionName }) });
              }
              const cols = await api('/collections');
              setCollections(cols);
              setShowCollectionForm(false);
              setCollectionName('');
              addToast(editingCollectionId ? 'Collection renamed' : 'Collection created');
            } catch (err) { addToast(err.message || 'Failed', 'error'); }
          }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={collectionName} onChange={e => setCollectionName(e.target.value)} placeholder="Collection name..." required
                style={{ flex: 1, padding: '8px 12px', borderRadius: 4, border: '1px solid #30363d', background: '#0d1117', color: '#c9d1d9', fontSize: '0.85rem' }} />
              <button type="submit" className="btn-sm btn-primary">{editingCollectionId ? 'Rename' : 'Create'}</button>
              <button type="button" className="btn-sm" onClick={() => setShowCollectionForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {collections.length > 0 && !selectedCollection && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {collections.map(c => (
            <div key={c.id} style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#f0f6fc', fontSize: '0.85rem' }}>📁 {c.name}</span>
              <button className="btn-sm" style={{ fontSize: '0.65rem', padding: '2px 6px' }} onClick={async () => {
                setCollectionName(c.name);
                setEditingCollectionId(c.id);
                setShowCollectionForm(true);
              }}>✏️</button>
              <button className="btn-sm btn-danger" style={{ fontSize: '0.65rem', padding: '2px 6px' }} onClick={async () => {
                await api(`/collections/${c.id}`, { method: 'DELETE' });
                setCollections(prev => prev.filter(x => x.id !== c.id));
                addToast('Collection deleted');
              }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {selectedCollection && (
        <div style={{ marginBottom: 12 }}>
          <h4 style={{ color: '#f0f6fc', fontSize: '0.9rem', margin: 0 }}>📁 {collections.find(c => c.id === selectedCollection)?.name}</h4>
        </div>
      )}

      {savedDeals.length === 0 ? (
        <p className="empty-state">No saved deals yet. Click 💾 on any match to save it for later.</p>
      ) : (
        <div className="matches-list">
          {(selectedCollection ? collectionItems : savedDeals).map(d => {
            const deal = selectedCollection ? savedDeals.find(sd => sd.id === d.saved_deal_id) : d;
            if (!deal) return null;
            return (
            <div key={d.id || deal.id} className="match-card" style={{ padding: '14px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <a href={deal.permalink.startsWith('http') ? deal.permalink : `https://reddit.com${deal.permalink}`} target="_blank" rel="noopener noreferrer" style={{ flex: 1, textDecoration: 'none' }} onClick={() => api('/track-click', { method: 'POST', body: JSON.stringify({ post_id: deal.post_id, permalink: deal.permalink, source: deal.source }) }).catch(() => {})}>
                  <div className="match-title">{sourceIcon(deal.source)} {deal.title}</div>
                  <div className="match-meta">
                    {deal.price ? <span className="match-price">${deal.price}</span> : null}
                    {scoreBadge(deal.deal_score)}
                    <span style={{ color: '#484f58' }}>Saved {new Date(deal.created_at).toLocaleString()}</span>
                  </div>
                </a>
                <button className="btn-sm btn-danger" onClick={() => deleteSavedDeal(deal.id)} style={{ marginLeft: 8 }}>✕</button>
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                <input value={savedNotes[deal.id] || ''}
                  onChange={e => setSavedNotes(prev => ({ ...prev, [deal.id]: e.target.value }))}
                  placeholder="Add a note..."
                  style={{ flex: 1, padding: '6px 10px', borderRadius: 4, border: '1px solid #30363d', background: '#0d1117', color: '#c9d1d9', fontSize: '0.85rem' }}
                />
                <button className="btn-sm" onClick={() => updateSavedNote(deal.id)}>Save Note</button>
                {tier === 'pro' && selectedCollection && (
                  <button className="btn-sm btn-danger" onClick={async () => {
                    await api(`/collections/items/${d.id}`, { method: 'DELETE' });
                    setCollectionItems(prev => prev.filter(x => x.id !== d.id));
                    addToast('Removed from collection');
                  }} style={{ fontSize: '0.7rem' }}>Remove</button>
                )}
                {tier === 'pro' && !selectedCollection && collections.length > 0 && (
                  <select defaultValue="" onChange={async (e) => {
                    if (!e.target.value) return;
                    await api(`/collections/${e.target.value}/items`, { method: 'POST', body: JSON.stringify({ saved_deal_id: deal.id }) });
                    addToast('Added to collection');
                  }} style={{ padding: '4px 6px', borderRadius: 4, border: '1px solid #30363d', background: '#0d1117', color: '#c9d1d9', fontSize: '0.7rem' }}>
                    <option value="">Add to...</option>
                    {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </div>
              {tier === 'pro' && (
                <div style={{ marginTop: 8 }}>
                  {loadingHistory[deal.post_id] ? (
                    <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>Loading price history...</span>
                  ) : priceHistory[deal.post_id] ? (
                    <div style={{ fontSize: '0.75rem', color: '#8b949e' }}>
                      Price history ({priceHistory[deal.post_id].length} records):
                      <span style={{ marginLeft: 6 }}>
                        {priceHistory[deal.post_id].slice(-5).map((h, i) => (
                          <span key={i} style={{ marginRight: 8, color: '#3fb950' }}>
                            ${h.price}
                            <span style={{ color: '#484f58', fontSize: '0.65rem' }}> {new Date(h.recorded_at).toLocaleDateString()}</span>
                          </span>
                        ))}
                      </span>
                    </div>
                  ) : (
                    <button className="btn-sm" onClick={() => loadPriceHistory(deal.post_id)} style={{ fontSize: '0.7rem' }}>📈 Price History</button>
                  )}
                </div>
              )}
            </div>
          );})}
        </div>
      )}
      </>
      )}

      {activeTab === 'settings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '20px' }}>
            <h4 style={{ margin: '0 0 12px', color: '#f0f6fc' }}>📧 Email Digest</h4>
            <p style={{ fontSize: '0.85rem', color: '#8b949e', marginBottom: 12 }}>
              Get a daily or weekly summary of all your matches sent to your email.
            </p>
            <select value={digestFrequency} onChange={e => setDigestFrequency(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #30363d', background: '#0d1117', color: '#c9d1d9', fontSize: '0.9rem', marginBottom: 12 }}>
              <option value="never">Never</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
            <button className="btn btn-primary btn-sm" onClick={handleSaveDigest} disabled={savingDigest}>
              {savingDigest ? 'Saving...' : 'Save'}
            </button>
            <button className="btn btn-sm" onClick={handleSendDigestNow} style={{ marginLeft: 8 }} disabled={sendingDigest}>
              {sendingDigest ? 'Sending...' : 'Send Now'}
            </button>
          </div>

          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '20px' }}>
            <h4 style={{ margin: '0 0 12px', color: '#f0f6fc' }}>🔑 API Access</h4>
            {tier === 'pro' ? (
              <>
                <p style={{ fontSize: '0.85rem', color: '#8b949e', marginBottom: 12 }}>
                  Use your API key to fetch matches programmatically.
                </p>
                {apiKey ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <code style={{ flex: 1, padding: '8px 12px', background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, fontSize: '0.8rem', color: '#58a6ff', wordBreak: 'break-all' }}>{apiKey}</code>
                    <button className="btn-sm" onClick={() => { navigator.clipboard.writeText(apiKey); addToast('API key copied'); }}>📋</button>
                    <button className="btn-sm" onClick={handleRegenerateKey}>Regenerate</button>
                  </div>
                ) : (
                  <button className="btn btn-sm btn-primary" onClick={handleRegenerateKey} disabled={generatingKey}>
                    {generatingKey ? 'Generating...' : 'Generate API Key'}
                  </button>
                )}
                <div style={{ marginTop: 12, fontSize: '0.8rem', color: '#8b949e' }}>
                  <strong style={{ color: '#f0f6fc' }}>Usage:</strong>
                  <pre style={{ background: '#0d1117', padding: '8px 12px', borderRadius: 6, marginTop: 6, fontSize: '0.75rem', overflowX: 'auto' }}>
curl "https://mechalert-production.up.railway.app/api/v1/matches?api_key=YOUR_KEY"</pre>
                  <pre style={{ background: '#0d1117', padding: '8px 12px', borderRadius: 6, marginTop: 4, fontSize: '0.75rem', overflowX: 'auto' }}>
curl -H "x-api-key: YOUR_KEY" \
  "https://mechalert-production.up.railway.app/api/v1/matches"</pre>
                  <span style={{ fontSize: '0.75rem', display: 'block', marginTop: 6 }}>Returns your recent matches as JSON. Rate limit: 100 req/min.</span>
                </div>
                <div style={{ marginTop: 16, fontSize: '0.8rem', color: '#8b949e', background: '#0d1117', padding: '12px', borderRadius: 6, border: '1px solid #30363d' }}>
                  <strong style={{ color: '#f0f6fc' }}>Example response:</strong>
                  <pre style={{ fontSize: '0.7rem', marginTop: 6, overflowX: 'auto', color: '#58a6ff' }}>
{JSON.stringify([{ id: 1, title: '[USA-CA] [H] GMK Olivia [W] PayPal', price: 120, permalink: '/r/mechmarket/comments/abc123/', source: 'reddit', keywords: 'GMK', matched_keyword: 'GMK', sent_at: '2026-06-20 12:00:00' }], null, 2)}</pre>
                </div>
                <p style={{ fontSize: '0.75rem', color: '#484f58', marginTop: 8 }}>
                  Tip: Replace <code style={{ color: '#58a6ff' }}>YOUR_KEY</code> with your generated API key above. New matches appear after the scanner finds them.
                </p>
              </>
            ) : (
              <p style={{ fontSize: '0.85rem', color: '#8b949e' }}>
                API access requires a Pro subscription.
              </p>
            )}
          </div>
        </div>
      )}

        </>
      )}
    </div>
  );
}
