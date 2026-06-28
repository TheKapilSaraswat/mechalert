import fs from 'fs';
import path from 'path';
import db from './db.js';
import logger from './logger.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const backupDir = () => process.env.DB_BACKUP_DIR || path.join(__dirname, '..', 'backups');

export function ensureBackupDir() {
  const dir = backupDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function backupDatabase() {
  try {
    ensureBackupDir();
    const dir = backupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(dir, `mechmarket-${timestamp}.db`);
    const dbPath = db.name;
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, backupPath);
      logger.info('Database backup created', { path: backupPath });
    }
    cleanupOldBackups();
  } catch (err) {
    logger.error('Database backup failed', { error: err.message });
  }
}

export function runWALCheckpoint() {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    logger.error('WAL checkpoint failed', { error: err.message });
  }
}

function cleanupOldBackups() {
  try {
    const dir = backupDir();
    const maxBackups = parseInt(process.env.DB_MAX_BACKUPS) || 48;
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('mechmarket-') && f.endsWith('.db'))
      .map(f => ({ name: f, time: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    if (files.length > maxBackups) {
      const toRemove = files.slice(maxBackups);
      for (const f of toRemove) {
        fs.unlinkSync(path.join(dir, f.name));
        logger.debug('Removed old backup', { file: f.name });
      }
    }
  } catch (err) {
    logger.error('Backup cleanup failed', { error: err.message });
  }
}
