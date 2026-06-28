import jwt from 'jsonwebtoken';
import db from './db.js';

const JWT_SECRET = process.env.JWT_SECRET;

export function jwtAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET, { algorithms: ['HS256'] });
    const user = db.prepare('SELECT jwt_version FROM users WHERE id = ?').get(decoded.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.jwt_version !== decoded.version) return res.status(401).json({ error: 'Token revoked' });
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function adminAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET, { algorithms: ['HS256'] });
    const user = db.prepare('SELECT id, email, is_admin, jwt_version FROM users WHERE id = ?').get(decoded.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.jwt_version !== decoded.version) return res.status(401).json({ error: 'Token revoked' });
    if (!user.is_admin && user.email !== process.env.ADMIN_EMAIL) return res.status(403).json({ error: 'Admin access required' });
    if (!user.is_admin && user.email === process.env.ADMIN_EMAIL) {
      db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
      user.is_admin = 1;
    }
    req.user = decoded;
    req.adminUser = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
