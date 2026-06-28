import { useState, useEffect } from 'react';
import { api } from '../api';
import { Link } from 'react-router-dom';

export default function AnalyticsPage() {
  const [stats, setStats] = useState(null);
  const [distribution, setDistribution] = useState(null);
  const [trends, setTrends] = useState(null);
  const [days, setDays] = useState(30);
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api('/stats').then(setStats),
      api('/analytics/deal-distribution').then(setDistribution),
      api(`/analytics/price-trends?days=${days}${category ? `&category=${category}` : ''}`).then(setTrends),
    ]).catch(err => setError(err.message)).finally(() => setLoading(false));
  }, [days, category]);

  if (loading) return <div className="loading">Loading analytics...</div>;
  if (error) return <div className="alert alert-error">{error}</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2>📊 Deal Analytics</h2>
        <Link to="/dashboard" className="btn btn-secondary btn-sm">← Back to Dashboard</Link>
      </div>

      {stats && (
        <div className="stats-bar">
          <div className="stat"><span className="stat-num">{stats.totalPosts}</span> Total posts scanned</div>
          <div className="stat"><span className="stat-num">{stats.totalMatches}</span> Total matches</div>
          <div className="stat"><span className="stat-num">{stats.totalUsers}</span> Users</div>
          <div className="stat"><span className="stat-num">{stats.totalRules}</span> Active rules</div>
          <div className="stat"><span className="stat-num">{stats.scansToday}</span> Scans today</div>
          {stats.avgScore && <div className="stat"><span className="stat-num">{Math.round(stats.avgScore)}</span> Avg score</div>}
        </div>
      )}

      {/* Distribution by Source */}
      {distribution && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 20 }}>
            <h3 style={{ marginBottom: 12 }}>By Source</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {distribution.bySource.map(s => {
                const total = distribution.bySource.reduce((a, b) => a + b.c, 0);
                const pct = total > 0 ? ((s.c / total) * 100).toFixed(1) : 0;
                return (
                  <div key={s.source}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#c9d1d9', marginBottom: 2 }}>
                      <span>{s.source}</span>
                      <span>{s.c} ({pct}%)</span>
                    </div>
                    <div style={{ background: '#0d1117', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                      <div style={{ background: '#58a6ff', width: `${pct}%`, height: '100%', borderRadius: 4 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 20 }}>
            <h3 style={{ marginBottom: 12 }}>By Category</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {distribution.byCategory.slice(0, 8).map(s => {
                const total = distribution.byCategory.reduce((a, b) => a + b.c, 0);
                const pct = total > 0 ? ((s.c / total) * 100).toFixed(1) : 0;
                return (
                  <div key={s.category}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#c9d1d9', marginBottom: 2 }}>
                      <span>{s.category}</span>
                      <span>{s.c} ({pct}%)</span>
                    </div>
                    <div style={{ background: '#0d1117', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                      <div style={{ background: '#3fb950', width: `${pct}%`, height: '100%', borderRadius: 4 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 20 }}>
            <h3 style={{ marginBottom: 12 }}>AI Score Distribution</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {distribution.scoreDistribution.map(s => {
                const total = distribution.scoreDistribution.reduce((a, b) => a + b.c, 0);
                const pct = total > 0 ? ((s.c / total) * 100).toFixed(1) : 0;
                const color = s.bucket.startsWith('hot') ? '#3fb950' : s.bucket.startsWith('good') ? '#d29922' : '#f85149';
                return (
                  <div key={s.bucket}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#c9d1d9', marginBottom: 2 }}>
                      <span>{s.bucket}</span>
                      <span>{s.c} ({pct}%)</span>
                    </div>
                    <div style={{ background: '#0d1117', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                      <div style={{ background: color, width: `${pct}%`, height: '100%', borderRadius: 4 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 20 }}>
            <h3 style={{ marginBottom: 12 }}>Price Range</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {distribution.priceRange.map(s => {
                const total = distribution.priceRange.reduce((a, b) => a + b.c, 0);
                const pct = total > 0 ? ((s.c / total) * 100).toFixed(1) : 0;
                return (
                  <div key={s.bucket}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#c9d1d9', marginBottom: 2 }}>
                      <span>{s.bucket}</span>
                      <span>{s.c} ({pct}%)</span>
                    </div>
                    <div style={{ background: '#0d1117', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                      <div style={{ background: '#d29922', width: `${pct}%`, height: '100%', borderRadius: 4 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Price Trends */}
      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3>Price Trends</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={days} onChange={e => setDays(parseInt(e.target.value))} style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid #30363d', background: '#0d1117', color: '#c9d1d9', fontSize: '0.85rem' }}>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
            <select value={category} onChange={e => setCategory(e.target.value)} style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid #30363d', background: '#0d1117', color: '#c9d1d9', fontSize: '0.85rem' }}>
              <option value="">All categories</option>
              <option value="mechmarket">mechmarket</option>
              <option value="hardwareswap">hardwareswap</option>

            </select>
          </div>
        </div>
        {trends && trends.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ color: '#8b949e', borderBottom: '1px solid #30363d' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Date</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Avg Price</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Min</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Max</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Samples</th>
                </tr>
              </thead>
              <tbody>
                {trends.map(t => (
                  <tr key={t.day} style={{ borderBottom: '1px solid #21262d' }}>
                    <td style={{ padding: '6px 8px', color: '#c9d1d9' }}>{t.day}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#3fb950' }}>${parseFloat(t.avg_price).toFixed(2)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#c9d1d9' }}>${parseFloat(t.min_price).toFixed(2)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#c9d1d9' }}>${parseFloat(t.max_price).toFixed(2)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#8b949e' }}>{t.samples}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ color: '#8b949e', textAlign: 'center', padding: 20 }}>No price data available yet. Data will appear as deals are scanned.</p>
        )}
      </div>
    </div>
  );
}
