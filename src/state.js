// Fix state tracking — remembers when patches were applied so diagnosis can split before/after
// Stores in ~/.cc-token-doctor/state.json

const fs = require('fs');
const path = require('path');
const os = require('os');

const STATE_DIR = path.join(os.homedir(), '.cc-token-doctor');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return { fixes: {} };
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { fixes: {} };
  }
}

function saveState(state) {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function recordFixApplied(patchId) {
  const state = loadState();
  if (!state.fixes) state.fixes = {};
  state.fixes[patchId] = {
    appliedAt: new Date().toISOString(),
    version: getClaudeCodeVersion(),
  };
  saveState(state);
}

function clearFixRecord(patchId) {
  const state = loadState();
  if (state.fixes) delete state.fixes[patchId];
  saveState(state);
}

function getFixTimestamp() {
  const state = loadState();
  if (!state.fixes) return null;
  const times = Object.values(state.fixes)
    .map(f => new Date(f.appliedAt))
    .filter(d => !isNaN(d.getTime()));
  if (times.length === 0) return null;
  // Return the earliest fix time — that's when improvements should start
  return new Date(Math.min(...times.map(d => d.getTime())));
}

function getAppliedFixes() {
  const state = loadState();
  return state.fixes || {};
}

function hasAppliedFixes() {
  const fixes = getAppliedFixes();
  return Object.keys(fixes).length > 0;
}

function getClaudeCodeVersion() {
  try {
    const { execSync } = require('child_process');
    return execSync('claude --version', { encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    return 'unknown';
  }
}

module.exports = {
  loadState, saveState, recordFixApplied, clearFixRecord,
  getFixTimestamp, getAppliedFixes, hasAppliedFixes,
};
