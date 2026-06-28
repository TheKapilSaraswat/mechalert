import { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { api } from '../api';

function StatBox({ label, value, sub }) {
  return (
    <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px', flex: '1 1 180px' }}>
      <div style={{ fontSize: '0.75rem', color: '#8b949e', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f0f6fc' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: '#8b949e', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function AdminPanel() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [users, setUsers] = useState([]);
  const [activity, setActivity] = useState(null);
  const [sourceHealth, setSourceHealth] = useState([]);
  const [tab, setTab] = useState('overview');
  const [error, setError] = useState(null);
  const [userActivity, setUserActivity] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userSearches, setUserSearches] = useState([]);
  const [userNotifications, setUserNotifications] = useState([]);
  const [expandedNotif, setExpandedNotif] = useState(null);
  const [userClicks, setUserClicks] = useState([]);
  const [userCheckoutEvents, setUserCheckoutEvents] = useState([]);
  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [mailingUser, setMailingUser] = useState(null);
  const [mailForm, setMailForm] = useState({ subject: '', body: '' });
  const [mailResult, setMailResult] = useState(null);
  const [marketingSubject, setMarketingSubject] = useState('Unlock Premium – Get more out of MechAlert');
  const [marketingBody, setMarketingBody] = useState(`Hi there,

We noticed you're using MechAlert on the Free plan. Here's what you're missing:

- Scan every 3 hours instead of once per day
- Price filters & history tracking
- Discord, Telegram, Slack, ntfy, Pushover notifications
- Deal collections & price drop alerts
- AI deal explanations & smart filters
- API access

Upgrade today and never miss a deal!

https://mechalert-production.up.railway.app/pricing`);
  const [marketingSending, setMarketingSending] = useState(false);
  const [marketingResult, setMarketingResult] = useState(null);
  const [trackingStats, setTrackingStats] = useState(null);

  useEffect(() => {
    api('/admin/stats').then(setStats).catch(e => setError(e.message));
    api('/admin/analytics').then(setAnalytics).catch(() => {});
    api('/admin/users').then(setUsers).catch(() => {});
    api('/admin/recent-activity').then(setActivity).catch(() => {});
    api('/admin/source-health').then(setSourceHealth).catch(() => {});
    api('/admin/user-activity').then(setUserActivity).catch(() => {});
    api('/admin/tracking-stats').then(setTrackingStats).catch(() => {});
  }, []);

  const viewUser = async (userId) => {
    setSelectedUser(userId);
    const [searches, notifs, clicks, checkoutEvents] = await Promise.all([
      api(`/admin/user-searches/${userId}`).catch(() => []),
      api(`/admin/user-notifications/${userId}`).catch(() => []),
      api(`/admin/user-clicks/${userId}`).catch(() => []),
      api(`/admin/user-checkout-events/${userId}`).catch(() => []),
    ]);
    setUserSearches(searches);
    setUserNotifications(notifs);
    setUserClicks(clicks);
    setUserCheckoutEvents(checkoutEvents);
  };

  const startEditUser = (u) => {
    setEditingUser(u.id);
    setEditForm({ is_admin: u.is_admin, is_premium: u.is_premium, tier: u.tier, is_active: u.is_active ?? 1 });
  };

  const saveUser = async (userId) => {
    await api(`/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify(editForm) }).catch(e => setError(e.message));
    setEditingUser(null);
    api('/admin/users').then(setUsers).catch(() => {});
  };

  const deleteUser = async (userId, email) => {
    if (!window.confirm(`Delete user ${email} (ID ${userId})? This cannot be undone.`)) return;
    await api(`/admin/users/${userId}`, { method: 'DELETE' }).catch(e => setError(e.message));
    api('/admin/users').then(setUsers).catch(() => {});
  };

  const sendMarketing = async () => {
    if (!marketingSubject || !marketingBody) return;
    setMarketingSending(true);
    setMarketingResult(null);
    const result = await api('/admin/marketing-email', {
      method: 'POST',
      body: { subject: marketingSubject, body: marketingBody },
    }).catch(e => ({ error: e.message }));
    setMarketingResult(result);
    setMarketingSending(false);
  };

  if (!user?.is_admin) {
    return <div className="loading">Access denied</div>;
  }

  if (!stats) return <div className="loading">Loading admin panel...</div>;

  const tabs = ['overview', 'users', 'activity', 'sources', 'tracking', 'marketing'];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>🛠️ Admin Panel</h2>
        <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>
          Uptime: {Math.floor(stats.uptime / 60)}m · DB: {stats.dbSize}
        </span>
      </div>

      {error && (
        <div style={{ background: '#3d1f1f', border: '1px solid #f85149', borderRadius: 6, padding: '8px 12px', marginBottom: 16, fontSize: '0.85rem', color: '#f85149' }}>
          {error}
        </div>
      )}

      <div className="admin-tabs" style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid #30363d', paddingBottom: 8 }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              background: tab === t ? '#1f6feb' : 'transparent', color: tab === t ? '#fff' : '#8b949e',
              border: 'none', padding: '6px 16px', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem', textTransform: 'capitalize'
            }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          {analytics && (
            <>
              <h4 style={{ margin: '0 0 8px', color: '#f0f6fc', fontSize: '0.9rem' }}>Users & Visitors</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
                <StatBox label="Total Users" value={analytics.users.total} sub={`${analytics.users.today} today · ${analytics.users.thisWeek} this week`} />
                <StatBox label="Active Users (24h)" value={analytics.activeUsers.lastDay} sub={`${analytics.activeUsers.lastWeek} in 7 days`} />
                <StatBox label="Unique Visitors (IP)" value={`${analytics.visits.uniqueIpsAll}`} sub={`${analytics.visits.uniqueIpsToday} today · ${analytics.visits.uniqueIpsThisWeek} week`} />
                <StatBox label="Page Views" value={analytics.visits.totalViews} sub={`${analytics.visits.viewsToday} today`} />
              </div>

              <h4 style={{ margin: '0 0 8px', color: '#f0f6fc', fontSize: '0.9rem' }}>Subscription Funnel</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
                <StatBox label="Registered" value={analytics.funnel.registered} />
                <StatBox label="Viewed Pricing" value={analytics.funnel.viewedPricing} sub={analytics.funnel.viewRate} />
                <StatBox label="Started Checkout" value={analytics.funnel.startedCheckout} sub={analytics.funnel.checkoutRate} />
                <StatBox label="Paid" value={analytics.funnel.paid} sub={analytics.funnel.conversionRate} />
              </div>
            </>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
            <StatBox label="Total Users" value={stats.users.total} sub={`${stats.users.pro} pro · ${stats.users.free} free`} />
            <StatBox label="Scanned Posts" value={stats.content.posts} sub={`${stats.activity24h.posts} in 24h`} />
            <StatBox label="Alert Matches" value={stats.content.matches} sub={`${stats.activity24h.matches} in 24h`} />
            <StatBox label="Alert Rules" value={stats.content.rules} sub={`${stats.content.activeRules} active`} />
            <StatBox label="Saved Deals" value={stats.content.savedDeals} />
            <StatBox label="Pricing Views" value={analytics?.pricing?.totalViews || 0} sub={`${analytics?.pricing?.viewsToday || 0} today`} />
            <StatBox label="Checkout Starts" value={analytics?.checkout?.started || 0} sub={`${analytics?.checkout?.startedToday || 0} today`} />
          </div>

          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px', marginBottom: 24 }}>
            <h4 style={{ margin: '0 0 12px', color: '#f0f6fc', fontSize: '0.9rem' }}>Posts by Source</h4>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {stats.bySource.map(s => (
                <div key={s.source} style={{ flex: '1 1 120px', background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '10px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#f0f6fc' }}>{s.c}</div>
                  <div style={{ fontSize: '0.75rem', color: '#8b949e' }}>{s.source}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px' }}>
            <h4 style={{ margin: '0 0 12px', color: '#f0f6fc', fontSize: '0.9rem' }}>Memory Usage</h4>
            <div style={{ fontSize: '0.8rem', color: '#8b949e', fontFamily: 'monospace' }}>
              {stats.memory && Object.entries(stats.memory).map(([k, v]) =>
                <div key={k} style={{ marginBottom: 2 }}>{k}: {(v / 1024 / 1024).toFixed(1)} MB</div>
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'users' && (
        <>
          <div className="admin-table-wrap" style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: 700 }}>
              <thead>
                <tr style={{ background: '#0d1117' }}>
                  <th style={thStyle}>ID</th>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Tier</th>
                  <th style={thStyle}>Rules</th>
                  <th style={thStyle}>Matches</th>
                  <th style={thStyle}>Mails</th>
                  <th style={thStyle}>Last Active</th>
                  <th style={thStyle}>Created</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const act = userActivity.find(a => a.id === u.id);
                  const isEditing = editingUser === u.id;
                  return (
                    <tr key={u.id} style={{ borderTop: '1px solid #21262d', opacity: u.is_active === 0 ? 0.5 : 1 }}>
                      <td style={tdStyle}>{u.id}</td>
                      <td style={tdStyle}>{u.email}</td>
                      <td style={tdStyle}>
                        <span style={{ color: u.is_active === 0 ? '#f85149' : '#3fb950', fontSize: '0.75rem' }}>
                          {u.is_active === 0 ? '● Disabled' : '● Active'}
                        </span>
                      </td>
                      <td style={tdStyle}>{u.tier === 'pro' ? '⚡ Pro' : 'Free'}</td>
                      <td style={tdStyle}>{u.rule_count}</td>
                      <td style={tdStyle}>{u.match_count}</td>
                      <td style={tdStyle}>{u.mail_count || 0}</td>
                      <td style={{ ...tdStyle, fontSize: '0.7rem' }}>{act?.last_search_at?.split('.')[0]?.replace('T', ' ') || act?.last_notification_at?.split('.')[0]?.replace('T', ' ') || u.created_at?.split('T')[0]}</td>
                      <td style={tdStyle}>{u.created_at?.split('T')[0]}</td>
                      <td style={tdStyle}>
                        {isEditing ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 100 }}>
                            <label style={{ fontSize: '0.7rem', color: '#8b949e' }}>
                              <input type="checkbox" checked={!!editForm.is_admin}
                                onChange={e => setEditForm(f => ({ ...f, is_admin: e.target.checked ? 1 : 0 }))} /> Admin
                            </label>
                            <label style={{ fontSize: '0.7rem', color: '#8b949e' }}>
                              <input type="checkbox" checked={!!editForm.is_premium}
                                onChange={e => setEditForm(f => ({ ...f, is_premium: e.target.checked ? 1 : 0 }))} /> Premium
                            </label>
                            <label style={{ fontSize: '0.7rem', color: '#8b949e' }}>
                              <input type="checkbox" checked={!!editForm.is_active}
                                onChange={e => setEditForm(f => ({ ...f, is_active: e.target.checked ? 1 : 0 }))} /> Active
                            </label>
                              <select value={editForm.tier} onChange={e => setEditForm(f => ({ ...f, tier: e.target.value }))}
                                style={{ fontSize: '0.7rem', padding: '2px 4px', background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 3 }}>
                                <option value="free">Free</option>
                                <option value="pro">Pro</option>
                              </select>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button onClick={() => saveUser(u.id)} className="btn-sm" style={{ borderColor: '#238636', color: '#3fb950' }}>Save</button>
                              <button onClick={() => setEditingUser(null)} className="btn-sm">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 4 }}>
                             <button onClick={() => viewUser(u.id)} className="btn-sm">View</button>
                             <button onClick={() => startEditUser(u)} className="btn-sm">Edit</button>
                             <button onClick={() => { setMailingUser(u); setMailForm({ subject: marketingSubject, body: marketingBody }); setMailResult(null); }} className="btn-sm">Mail</button>
                             <button onClick={() => deleteUser(u.id, u.email)} className="btn-sm btn-danger">Del</button>
                           </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selectedUser && (
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h4 style={{ margin: 0, color: '#f0f6fc', fontSize: '0.9rem' }}>User #{selectedUser} Activity</h4>
                <button onClick={() => setSelectedUser(null)} className="btn-sm">Close</button>
              </div>

              <h5 style={{ color: '#8b949e', margin: '8px 0', fontSize: '0.8rem' }}>Searches ({userSearches.length})</h5>
              {userSearches.length === 0 ? (
                <p style={{ color: '#484f58', fontSize: '0.8rem' }}>No searches recorded</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', marginBottom: 16 }}>
                  <thead>
                    <tr style={{ background: '#0d1117' }}>
                      <th style={thStyle}>Query</th>
                      <th style={thStyle}>Results</th>
                      <th style={thStyle}>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userSearches.slice(0, 20).map((s, i) => (
                      <tr key={i} style={{ borderTop: '1px solid #21262d' }}>
                        <td style={tdStyle}>{s.query}</td>
                        <td style={tdStyle}>{s.results_count}</td>
                        <td style={{ ...tdStyle, fontSize: '0.7rem' }}>{s.searched_at?.split('.')[0]?.replace('T', ' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <h5 style={{ color: '#8b949e', margin: '8px 0', fontSize: '0.8rem' }}>Notifications ({userNotifications.length})</h5>
              {userNotifications.length === 0 ? (
                <p style={{ color: '#484f58', fontSize: '0.8rem' }}>No notifications sent</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ background: '#0d1117' }}>
                      <th style={thStyle}>Type</th>
                      <th style={thStyle}>Channel</th>
                      <th style={thStyle}>Subject</th>
                      <th style={thStyle}>Body</th>
                      <th style={thStyle}>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userNotifications.slice(0, 20).map((n, i) => (
                      <tr key={i} style={{ borderTop: '1px solid #21262d' }}>
                        <td style={tdStyle}>{n.type}</td>
                        <td style={tdStyle}>{n.channel}</td>
                        <td style={tdStyle}>{n.subject}</td>
                        <td style={tdStyle}>
                          {n.body ? (
                            <>
                              <button onClick={() => setExpandedNotif(expandedNotif === i ? null : i)}
                                style={{ background: 'none', border: '1px solid #30363d', borderRadius: 3, color: '#58a6ff', cursor: 'pointer', fontSize: '0.7rem', padding: '2px 6px' }}>
                                {expandedNotif === i ? 'Hide' : 'View'}
                              </button>
                              {expandedNotif === i && (
                                <pre style={{ margin: '4px 0 0', padding: 6, background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, fontSize: '0.7rem', color: '#c9d1d9', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxWidth: 300, maxHeight: 120, overflow: 'auto' }}>{n.body}</pre>
                              )}
                            </>
                          ) : <span style={{ color: '#484f58' }}>-</span>}
                        </td>
                        <td style={{ ...tdStyle, fontSize: '0.7rem' }}>{n.created_at?.split('.')[0]?.replace('T', ' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <h5 style={{ color: '#8b949e', margin: '8px 0', fontSize: '0.8rem' }}>Deal Clicks ({userClicks.length})</h5>
              {userClicks.length === 0 ? (
                <p style={{ color: '#484f58', fontSize: '0.8rem' }}>No deal clicks recorded</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', marginBottom: 16 }}>
                  <thead>
                    <tr style={{ background: '#0d1117' }}>
                      <th style={thStyle}>Source</th>
                      <th style={thStyle}>Link</th>
                      <th style={thStyle}>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userClicks.slice(0, 20).map((c, i) => (
                      <tr key={i} style={{ borderTop: '1px solid #21262d' }}>
                        <td style={tdStyle}>{c.source}</td>
                        <td style={tdStyle}><a href={c.permalink} target="_blank" rel="noreferrer" style={{ color: '#58a6ff' }}>{c.post_id}</a></td>
                        <td style={{ ...tdStyle, fontSize: '0.7rem' }}>{c.clicked_at?.split('.')[0]?.replace('T', ' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <h5 style={{ color: '#8b949e', margin: '8px 0', fontSize: '0.8rem' }}>Checkout Events ({userCheckoutEvents.length})</h5>
              {userCheckoutEvents.length === 0 ? (
                <p style={{ color: '#484f58', fontSize: '0.8rem' }}>No checkout events recorded</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ background: '#0d1117' }}>
                      <th style={thStyle}>Event</th>
                      <th style={thStyle}>Plan</th>
                      <th style={thStyle}>Method</th>
                      <th style={thStyle}>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userCheckoutEvents.slice(0, 20).map((e, i) => (
                      <tr key={i} style={{ borderTop: '1px solid #21262d' }}>
                        <td style={{ ...tdStyle, color: e.event === 'completed' ? '#3fb950' : e.event === 'cancelled' ? '#d29922' : '#f85149' }}>{e.event}</td>
                        <td style={tdStyle}>{e.plan}</td>
                        <td style={tdStyle}>{e.payment_method}</td>
                        <td style={{ ...tdStyle, fontSize: '0.7rem' }}>{e.created_at?.split('.')[0]?.replace('T', ' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {mailingUser && (
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 16, marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h4 style={{ margin: 0, color: '#f0f6fc', fontSize: '0.9rem' }}>Email to {mailingUser.email}</h4>
                <button onClick={() => setMailingUser(null)} className="btn-sm">Close</button>
              </div>
              <div style={{ marginBottom: 8 }}>
                <input value={mailForm.subject} onChange={e => setMailForm(f => ({ ...f, subject: e.target.value }))}
                  placeholder="Subject" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #30363d', background: '#0d1117', color: '#c9d1d9', fontSize: '0.85rem' }} />
              </div>
              <div style={{ marginBottom: 8 }}>
                <textarea value={mailForm.body} onChange={e => setMailForm(f => ({ ...f, body: e.target.value }))} rows={5}
                  placeholder="Email body..." style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #30363d', background: '#0d1117', color: '#c9d1d9', fontSize: '0.85rem', fontFamily: 'monospace', resize: 'vertical' }} />
              </div>
              <button onClick={async () => {
                setMailResult(null);
                try {
                  const r = await api(`/admin/user-email/${mailingUser.id}`, { method: 'POST', body: JSON.stringify({ subject: mailForm.subject, body: mailForm.body }) });
                  setMailResult(r);
                  setTimeout(() => { setMailingUser(null); api('/admin/users').then(setUsers).catch(() => {}); }, 2000);
                } catch (e) { setMailResult({ error: e.message }); }
              }} className="btn" disabled={!mailForm.subject || !mailForm.body}>Send Email</button>
              {mailResult && (
                <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 4, background: mailResult.error ? '#3d1f1f' : '#1f3d1f', border: `1px solid ${mailResult.error ? '#f85149' : '#3fb950'}`, color: mailResult.error ? '#f85149' : '#3fb950', fontSize: '0.8rem' }}>
                  {mailResult.error || mailResult.message}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'sources' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sourceHealth.map(s => (
            <div key={s.source} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h4 style={{ margin: 0, color: '#f0f6fc', fontSize: '0.9rem', textTransform: 'capitalize' }}>{s.source}</h4>
                <span style={{ fontSize: '0.7rem', color: s.last24h > 0 ? '#3fb950' : '#f85149' }}>
                  {s.last24h > 0 ? '● live' : '○ no data (24h)'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: '0.8rem', color: '#8b949e' }}>
                <span>Total: <strong style={{ color: '#f0f6fc' }}>{s.total}</strong></span>
                <span>Last 24h: <strong style={{ color: '#f0f6fc' }}>{s.last24h}</strong></span>
                <span>Active rules: <strong style={{ color: '#f0f6fc' }}>{s.activeRules}</strong></span>
                <span>Last scan: <strong style={{ color: '#f0f6fc' }}>{s.last_scanned?.split('.')[0]?.replace('T', ' ') || 'N/A'}</strong></span>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'tracking' && trackingStats && (
        <div>
          <h4 style={{ margin: '0 0 12px', color: '#f0f6fc', fontSize: '0.9rem' }}>Deal Click Tracking</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
            <StatBox label="Total Clicks" value={trackingStats.clicks.total} sub={`${trackingStats.clicks.today} today`} />
            <StatBox label="Started Checkout" value={trackingStats.checkout.started} />
            <StatBox label="Completed" value={trackingStats.checkout.completed} sub={`${trackingStats.checkout.completed > 0 ? ((trackingStats.checkout.completed / trackingStats.checkout.started) * 100).toFixed(0) : 0}% conversion`} />
            <StatBox label="Cancelled" value={trackingStats.checkout.cancelled} />
            <StatBox label="Failed" value={trackingStats.checkout.failed} />
          </div>

          {trackingStats.clicks.bySource.length > 0 && (
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 8px', color: '#f0f6fc', fontSize: '0.9rem' }}>Clicks by Source</h4>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {trackingStats.clicks.bySource.map(s => (
                  <div key={s.source} style={{ flex: '1 1 120px', background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '10px 14px', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#f0f6fc' }}>{s.c}</div>
                    <div style={{ fontSize: '0.75rem', color: '#8b949e' }}>{s.source || 'unknown'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {trackingStats.clicks.topUsers.length > 0 && (
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 16 }}>
              <h4 style={{ margin: '0 0 8px', color: '#f0f6fc', fontSize: '0.9rem' }}>Top Clickers</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ background: '#0d1117' }}>
                    <th style={thStyle}>User ID</th>
                    <th style={thStyle}>Email</th>
                    <th style={thStyle}>Clicks</th>
                  </tr>
                </thead>
                <tbody>
                  {trackingStats.clicks.topUsers.map(u => (
                    <tr key={u.user_id} style={{ borderTop: '1px solid #21262d' }}>
                      <td style={tdStyle}>{u.user_id}</td>
                      <td style={tdStyle}>{u.email}</td>
                      <td style={tdStyle}>{u.clicks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'marketing' && (
        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 20, maxWidth: 600 }}>
          <h4 style={{ margin: '0 0 12px', color: '#f0f6fc', fontSize: '0.9rem' }}>📧 Send Marketing Email to Free Users</h4>
          <p style={{ fontSize: '0.8rem', color: '#8b949e', marginBottom: 16 }}>
            This will send an email to all non-premium users promoting your Premium plan.
          </p>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', marginBottom: 4 }}>Subject</label>
            <input value={marketingSubject} onChange={e => setMarketingSubject(e.target.value)}
              placeholder="e.g. Unlock Premium — 50% off your first month"
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #30363d', background: '#0d1117', color: '#c9d1d9', fontSize: '0.85rem' }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', marginBottom: 4 }}>Body (plain text)</label>
            <textarea value={marketingBody} onChange={e => setMarketingBody(e.target.value)} rows={8}
              placeholder={`Hi there,\n\nWe noticed you're using MechAlert on the Free plan. Here's what you're missing:\n\n• Scan every 10 min instead of 3 hours\n• Price filters & history tracking\n• Discord/Telegram/Slack notifications\n• Deal collections & price drop alerts\n• API access\n\nUpgrade today and never miss a deal!\n\nhttps://mechalert-production.up.railway.app/pricing`}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #30363d', background: '#0d1117', color: '#c9d1d9', fontSize: '0.85rem', fontFamily: 'monospace', resize: 'vertical' }} />
          </div>
          <button onClick={sendMarketing} disabled={marketingSending || !marketingSubject || !marketingBody} className="btn">
            {marketingSending ? 'Sending...' : 'Send to All Free Users'}
          </button>
          {marketingResult && (
            <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: marketingResult.error ? '#3d1f1f' : '#1f3d1f', border: `1px solid ${marketingResult.error ? '#f85149' : '#3fb950'}`, color: marketingResult.error ? '#f85149' : '#3fb950', fontSize: '0.85rem' }}>
              {marketingResult.error || `Sent to ${marketingResult.sent} / ${marketingResult.total} free users`}
            </div>
          )}
        </div>
      )}

      {tab === 'activity' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <h4 style={{ margin: '0 0 8px', color: '#f0f6fc', fontSize: '0.9rem' }}>Recent Matches</h4>
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ background: '#0d1117' }}>
                    <th style={thStyle}>Keyword</th>
                    <th style={thStyle}>Title</th>
                    <th style={thStyle}>Price</th>
                    <th style={thStyle}>Source</th>
                    <th style={thStyle}>At</th>
                  </tr>
                </thead>
                <tbody>
                  {activity?.recentMatches?.slice(0, 30).map(m => (
                    <tr key={m.id} style={{ borderTop: '1px solid #21262d' }}>
                      <td style={tdStyle}><span style={{ color: '#58a6ff' }}>{m.matched_keyword}</span></td>
                      <td style={tdStyle}><a href={m.permalink} target="_blank" rel="noreferrer" style={{ color: '#f0f6fc' }}>{m.title?.substring(0, 40)}</a></td>
                      <td style={tdStyle}>{m.price ? `$${m.price}` : '-'}</td>
                      <td style={tdStyle}>{m.source}</td>
                      <td style={tdStyle}>{m.sent_at?.split('.')[0]?.replace('T', ' ')}</td>
                    </tr>
                  ))}
                  {(!activity?.recentMatches || activity.recentMatches.length === 0) && (
                    <tr><td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: '#8b949e' }}>No matches yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h4 style={{ margin: '0 0 8px', color: '#f0f6fc', fontSize: '0.9rem' }}>Recent Posts</h4>
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ background: '#0d1117' }}>
                    <th style={thStyle}>Title</th>
                    <th style={thStyle}>Price</th>
                    <th style={thStyle}>Source</th>
                    <th style={thStyle}>Score</th>
                    <th style={thStyle}>Scanned</th>
                  </tr>
                </thead>
                <tbody>
                  {activity?.recentPosts?.slice(0, 30).map(p => (
                    <tr key={p.post_id} style={{ borderTop: '1px solid #21262d' }}>
                      <td style={tdStyle}><span style={{ color: '#f0f6fc' }}>{p.title?.substring(0, 50)}</span></td>
                      <td style={tdStyle}>{p.price ? `$${p.price}` : '-'}</td>
                      <td style={tdStyle}>{p.source}</td>
                      <td style={tdStyle}>{p.deal_score ? `${Math.round(p.deal_score)}` : '-'}</td>
                      <td style={tdStyle}>{p.scanned_at?.split('.')[0]?.replace('T', ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const thStyle = { padding: '8px 12px', textAlign: 'left', color: '#8b949e', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', whiteSpace: 'nowrap' };
const tdStyle = { padding: '8px 12px', color: '#c9d1d9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 };
