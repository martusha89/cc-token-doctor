// Backup and restore — keeps stock Claude Code safe

const fs = require('fs');
const path = require('path');
const os = require('os');

const BACKUP_DIR = path.join(os.homedir(), '.cc-token-doctor', 'backups');

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  return BACKUP_DIR;
}

function createBackup(filePath) {
  try {
    ensureBackupDir();
    const basename = path.basename(filePath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `${basename}.${timestamp}.bak`;
    const backupPath = path.join(BACKUP_DIR, backupName);

    fs.copyFileSync(filePath, backupPath);

    // Also save a manifest entry
    const manifest = loadManifest();
    manifest.push({
      original: filePath,
      backup: backupPath,
      timestamp: new Date().toISOString(),
      size: fs.statSync(filePath).size,
    });
    saveManifest(manifest);

    return backupPath;
  } catch (e) {
    return null;
  }
}

function restoreLatest(originalPath) {
  const manifest = loadManifest();
  const entries = manifest
    .filter(e => e.original === originalPath)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (entries.length === 0) return { success: false, detail: 'No backup found for this file' };

  const latest = entries[0];
  if (!fs.existsSync(latest.backup)) {
    return { success: false, detail: `Backup file missing: ${latest.backup}` };
  }

  try {
    fs.copyFileSync(latest.backup, originalPath);
    return { success: true, detail: `Restored from ${latest.backup} (${latest.timestamp})` };
  } catch (e) {
    return { success: false, detail: `Restore failed: ${e.message}` };
  }
}

function restoreAll() {
  const manifest = loadManifest();
  const results = [];
  const seen = new Set();

  // Group by original path, take latest for each
  const sorted = [...manifest].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  for (const entry of sorted) {
    if (seen.has(entry.original)) continue;
    seen.add(entry.original);
    results.push(restoreLatest(entry.original));
  }

  return results;
}

function listBackups() {
  return loadManifest();
}

function cleanOldBackups(keepDays = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keepDays);

  const manifest = loadManifest();
  const keep = [];
  let removed = 0;

  for (const entry of manifest) {
    if (new Date(entry.timestamp) < cutoff) {
      try { fs.unlinkSync(entry.backup); } catch {}
      removed++;
    } else {
      keep.push(entry);
    }
  }

  saveManifest(keep);
  return removed;
}

// Manifest — tracks what we've backed up
function loadManifest() {
  const manifestPath = path.join(BACKUP_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return [];
  }
}

function saveManifest(manifest) {
  ensureBackupDir();
  const manifestPath = path.join(BACKUP_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

module.exports = { createBackup, restoreLatest, restoreAll, listBackups, cleanOldBackups, BACKUP_DIR };
