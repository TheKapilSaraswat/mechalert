import { Routes, Route, Link, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import HomePage from './pages/HomePage';
import PricingPage from './pages/PricingPage';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import AnalyticsPage from './pages/AnalyticsPage';
import AdminPanel from './pages/AdminPanel';
import PrivacyPage from './pages/PrivacyPage';
import ContactPage from './pages/ContactPage';

function NavBar() {
  const { user, logout } = useAuth();
  return (
    <nav className="navbar">
      <Link to="/" className="logo">⌨️ MechAlert</Link>
      <div className="nav-links">
        {user ? (
          <>
            <Link to="/dashboard">Dashboard</Link>
            <Link to="/analytics">Analytics</Link>
            <Link to="/pricing">Pricing</Link>
            {user.is_admin && <Link to="/admin" style={{ color: '#f0883e' }}>🛠️ Admin</Link>}
            <span className="nav-email">{user.email}</span>
            {user.is_premium ? <span className="badge-premium">Premium ⚡</span> : <Link to="/pricing" className="badge-upgrade">Upgrade</Link>}
            <button onClick={logout}>Logout</button>
          </>
        ) : (
          <>
            <Link to="/pricing">Pricing</Link>
            <Link to="/login">Sign In</Link>
          </>
        )}
      </div>
    </nav>
  );
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading">Loading...</div>;
  return user ? children : <Navigate to="/login" />;
}

export default function App() {
  return (
    <AuthProvider>
      <NavBar />
      <div className="container">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/forgot" element={<ForgotPassword />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/reset" element={<ResetPassword />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/analytics" element={<ProtectedRoute><AnalyticsPage /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute><AdminPanel /></ProtectedRoute>} />
          <Route path="*" element={
            <div style={{ textAlign: 'center', padding: 80 }}>
              <h1>404</h1>
              <p style={{ color: '#8b949e' }}>Page not found</p>
              <Link to="/" className="btn btn-primary" style={{ marginTop: 20, display: 'inline-block' }}>Go Home</Link>
            </div>
          } />
        </Routes>
      </div>
    </AuthProvider>
  );
}
