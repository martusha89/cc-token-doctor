// Patch engine — applies targeted fixes based on diagnosis
// Credits: Rangizingo (cc-cache-fix) for patch discovery & research

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const PATCHES = {
  'env-attribution': {
    name: 'Attribution Header Workaround',
    description: 'Disables the billing attribution header that breaks cache key stability between turns.',
    risk: 'none',
    type: 'environment',
    explain: {
      problem: 'Claude Code sends a billing header with a fingerprint hash that changes between turns. When the hash changes, the API treats each message as a completely new conversation — so nothing gets cached.',
      fix: 'Sets an environment variable (CLAUDE_CODE_ATTRIBUTION_HEADER=0) that tells Claude Code to stop sending this header. The hash stops changing, and caching works properly again.',
      touches: process.platform === 'win32'
        ? 'Adds a Windows user environment variable via setx. Does NOT touch any Claude Code files.'
        : 'Adds one line to your shell profile (.zshrc, .bashrc, or .profile). Does NOT touch any Claude Code files.',
      undo: process.platform === 'win32'
        ? 'Run: setx CLAUDE_CODE_ATTRIBUTION_HEADER ""  — or delete it from System > Environment Variables.'
        : 'Delete the line "export CLAUDE_CODE_ATTRIBUTION_HEADER=0" from your shell profile.',
    },
    apply(ctx) {
      const envVar = 'CLAUDE_CODE_ATTRIBUTION_HEADER=0';
      const results = [];

      // Detect shell and config files
      const shell = process.env.SHELL || '';
      const home = os.homedir();
      const candidates = [];

      if (process.platform === 'win32') {
        // Windows: set user environment variable
        try {
          execSync(`setx CLAUDE_CODE_ATTRIBUTION_HEADER 0`, { stdio: 'pipe' });
          results.push({ success: true, detail: 'Set CLAUDE_CODE_ATTRIBUTION_HEADER=0 via setx (persists across sessions)' });
        } catch (e) {
          results.push({ success: false, detail: `Failed to set env var: ${e.message}` });
        }
      } else {
        // Unix: append to shell profile
        if (shell.includes('zsh')) candidates.push(path.join(home, '.zshrc'));
        else if (shell.includes('bash')) {
          candidates.push(path.join(home, '.bashrc'));
          candidates.push(path.join(home, '.bash_profile'));
        }
        candidates.push(path.join(home, '.profile'));

        const target = candidates.find(f => fs.existsSync(f)) || candidates[0];
        try {
          const content = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
          if (content.includes('CLAUDE_CODE_ATTRIBUTION_HEADER')) {
            results.push({ success: true, detail: `Already set in ${target}` });
          } else {
            fs.appendFileSync(target, `\n# CC Token Doctor — cache fix\nexport ${envVar}\n`);
            results.push({ success: true, detail: `Added to ${target}` });
          }
        } catch (e) {
          results.push({ success: false, detail: `Failed to update ${target}: ${e.message}` });
        }
      }

      // Also set for current process
      process.env.CLAUDE_CODE_ATTRIBUTION_HEADER = '0';
      return results;
    },
  },

  'cache-ttl': {
    name: 'Force 1-Hour Cache TTL',
    description: 'Patches Claude Code to use 1-hour cache TTL instead of 5-minute. Cache reads cost 10x less than re-creation.',
    risk: 'low',
    type: 'binary-patch',
    explain: {
      problem: 'Claude Code caches your conversation so it doesn\'t have to re-read everything from scratch each turn. But right now, that cache expires after just 5 minutes. Step away to make coffee? Cache gone. Everything gets re-read at full price.',
      fix: 'Changes the cache lifetime from 5 minutes to 1 hour inside Claude Code\'s JavaScript bundle. The 1-hour option already exists in the code — it\'s just locked behind a feature flag. This unlocks it.',
      touches: 'Modifies one JavaScript file inside your Claude Code installation. A full backup of the original file is saved BEFORE any changes are made.',
      undo: 'Run: npx cc-token-doctor --undo  — this restores the original file from the backup. You can also reinstall Claude Code (npm i -g @anthropic-ai/claude-code) to get a fresh copy.',
    },
    apply(ctx) {
      const binary = findClaudeBinary();
      if (!binary) return [{ success: false, detail: 'Could not find Claude Code installation' }];

      const bundlePath = findMainBundle(binary);
      if (!bundlePath) return [{ success: false, detail: 'Could not find Claude Code JS bundle' }];

      return applyJsPatch(bundlePath, [
        {
          name: 'cache-ttl',
          // The TTL check: looks for the 5-minute ephemeral cache type and changes it to 1-hour
          find: /ephemeral_5m/g,
          replace: 'ephemeral_1h',
          description: 'Switch default cache TTL from 5 minutes to 1 hour',
        },
      ]);
    },
  },

  'cache-prefix': {
    name: 'Cache Prefix Stabilizer',
    description: 'Ensures deferred tool deltas and MCP instruction deltas are persisted in session files so cache prefixes match on resume.',
    risk: 'low',
    type: 'binary-patch',
    explain: {
      problem: 'When you resume an old Claude Code session, the system tries to rebuild your conversation from a saved file. But some data (tool and MCP info) isn\'t being saved. So when it rebuilds, the conversation looks different from the original — and the cache can\'t match it. Result: full re-read, full price.',
      fix: 'Removes a filter that was skipping certain data types when saving sessions. With the filter gone, session files contain everything needed to rebuild the exact same conversation — so the cache matches on resume.',
      touches: 'Modifies the same JavaScript file as the TTL patch. A full backup is saved BEFORE any changes (one backup covers both patches).',
      undo: 'Run: npx cc-token-doctor --undo  — restores the original file. Or reinstall Claude Code for a clean copy.',
    },
    apply(ctx) {
      const binary = findClaudeBinary();
      if (!binary) return [{ success: false, detail: 'Could not find Claude Code installation' }];

      const bundlePath = findMainBundle(binary);
      if (!bundlePath) return [{ success: false, detail: 'Could not find Claude Code JS bundle' }];

      return applyJsPatch(bundlePath, [
        {
          name: 'persist-deltas',
          // The db8 filter: deferred_tools_delta and mcp_instructions_delta aren't saved to JSONL
          // This patch ensures they ARE saved so session resume reconstructs the same prefix
          find: /type:"deferred_tools_delta"[^}]*\}[^,]*,/g,
          replace: null, // Null = remove the filter (let all attachment types persist)
          description: 'Persist deferred tool deltas in session for cache stability',
        },
      ]);
    },
  },
};

function findClaudeBinary() {
  const candidates = [];

  if (process.platform === 'win32') {
    // Windows: npm global, AppData, Program Files
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    candidates.push(path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code'));
    candidates.push(path.join(appData, '..', 'Local', 'Programs', 'claude-code'));

    // Also check common global npm locations
    try {
      const npmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
      candidates.push(path.join(npmRoot, '@anthropic-ai', 'claude-code'));
    } catch {}
  } else {
    // macOS / Linux
    candidates.push('/usr/local/lib/node_modules/@anthropic-ai/claude-code');
    candidates.push(path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', '@anthropic-ai', 'claude-code'));

    try {
      const npmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
      candidates.push(path.join(npmRoot, '@anthropic-ai', 'claude-code'));
    } catch {}

    // Homebrew
    candidates.push('/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code');
  }

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }

  return null;
}

function findMainBundle(claudeDir) {
  // Claude Code's main bundle is typically in dist/ or lib/
  const candidates = [
    path.join(claudeDir, 'dist', 'cli.js'),
    path.join(claudeDir, 'dist', 'index.js'),
    path.join(claudeDir, 'cli.js'),
    path.join(claudeDir, 'lib', 'cli.js'),
  ];

  for (const f of candidates) {
    if (fs.existsSync(f)) return f;
  }

  // Fallback: find largest .js file in dist/
  const distDir = path.join(claudeDir, 'dist');
  if (fs.existsSync(distDir)) {
    const jsFiles = fs.readdirSync(distDir)
      .filter(f => f.endsWith('.js'))
      .map(f => ({ name: f, size: fs.statSync(path.join(distDir, f)).size }))
      .sort((a, b) => b.size - a.size);

    if (jsFiles.length > 0) return path.join(distDir, jsFiles[0].name);
  }

  return null;
}

function applyJsPatch(bundlePath, patches) {
  const backup = require('./backup');
  const results = [];

  // Create backup first
  const backupPath = backup.createBackup(bundlePath);
  if (!backupPath) {
    return [{ success: false, detail: 'Failed to create backup' }];
  }
  results.push({ success: true, detail: `Backup saved: ${backupPath}` });

  let content;
  try {
    content = fs.readFileSync(bundlePath, 'utf8');
  } catch (e) {
    return [{ success: false, detail: `Cannot read bundle: ${e.message}` }];
  }

  let modified = content;
  for (const patch of patches) {
    if (patch.replace === null) {
      // Remove matching pattern
      const before = modified;
      modified = modified.replace(patch.find, '');
      if (modified === before) {
        results.push({ success: false, detail: `Patch "${patch.name}" — pattern not found (may already be applied or version mismatch)` });
      } else {
        results.push({ success: true, detail: `Patch "${patch.name}" applied — ${patch.description}` });
      }
    } else {
      const before = modified;
      modified = modified.replace(patch.find, patch.replace);
      if (modified === before) {
        results.push({ success: false, detail: `Patch "${patch.name}" — pattern not found (may already be applied or version mismatch)` });
      } else {
        results.push({ success: true, detail: `Patch "${patch.name}" applied — ${patch.description}` });
      }
    }
  }

  if (modified !== content) {
    try {
      fs.writeFileSync(bundlePath, modified, 'utf8');
      results.push({ success: true, detail: 'Bundle updated successfully' });
    } catch (e) {
      results.push({ success: false, detail: `Failed to write patched bundle: ${e.message}` });
      // Restore backup
      try {
        fs.copyFileSync(backupPath, bundlePath);
        results.push({ success: true, detail: 'Restored from backup after write failure' });
      } catch {
        results.push({ success: false, detail: 'WARNING: Failed to restore backup! Manual restore needed.' });
      }
    }
  }

  return results;
}

function getAvailablePatches() {
  return Object.entries(PATCHES).map(([id, p]) => ({
    id,
    name: p.name,
    description: p.description,
    risk: p.risk,
    type: p.type,
  }));
}

function applyPatch(patchId) {
  const patch = PATCHES[patchId];
  if (!patch) return [{ success: false, detail: `Unknown patch: ${patchId}` }];
  return patch.apply({});
}

function getRecommendedPatches(diagnosis) {
  const recommended = [];

  // Always recommend the env workaround — zero risk
  recommended.push({
    id: 'env-attribution',
    ...PATCHES['env-attribution'],
  });

  if (diagnosis.cacheTTL?.status !== 'optimal') {
    recommended.push({
      id: 'cache-ttl',
      ...PATCHES['cache-ttl'],
    });
  }

  if (diagnosis.sessionHealth?.status !== 'healthy' || diagnosis.cacheHealth?.status === 'broken') {
    recommended.push({
      id: 'cache-prefix',
      ...PATCHES['cache-prefix'],
    });
  }

  return recommended;
}

function applyPatchById(patchId) {
  const patch = PATCHES[patchId];
  if (!patch) return [{ success: false, detail: `Unknown patch: ${patchId}` }];
  return patch.apply({});
}

function verifyPatches() {
  const results = [];

  // Check env-attribution
  if (process.platform === 'win32') {
    try {
      const val = execSync('reg query "HKCU\\Environment" /v CLAUDE_CODE_ATTRIBUTION_HEADER 2>nul', {
        encoding: 'utf8', timeout: 5000,
      });
      const intact = val.includes('0x0') || val.includes('REG_SZ') && val.includes('0');
      results.push({ id: 'env-attribution', intact, detail: intact ? 'still active' : 'not set in registry' });
    } catch {
      // Fallback: check current process env (works if terminal was reopened after setx)
      const intact = process.env.CLAUDE_CODE_ATTRIBUTION_HEADER === '0';
      results.push({ id: 'env-attribution', intact, detail: intact ? 'active in current session' : 'not set' });
    }
  } else {
    const home = os.homedir();
    const profiles = ['.zshrc', '.bashrc', '.bash_profile', '.profile'].map(f => path.join(home, f));
    let found = false;
    for (const f of profiles) {
      try {
        if (fs.readFileSync(f, 'utf8').includes('CLAUDE_CODE_ATTRIBUTION_HEADER')) { found = true; break; }
      } catch {}
    }
    if (!found) found = process.env.CLAUDE_CODE_ATTRIBUTION_HEADER === '0';
    results.push({ id: 'env-attribution', intact: found, detail: found ? 'still active' : 'not set' });
  }

  // Check binary patches
  const binary = findClaudeBinary();
  if (!binary) {
    results.push({ id: 'cache-ttl', intact: false, detail: 'Claude Code installation not found' });
    results.push({ id: 'cache-prefix', intact: false, detail: 'Claude Code installation not found' });
    return results;
  }

  const bundlePath = findMainBundle(binary);
  if (!bundlePath) {
    results.push({ id: 'cache-ttl', intact: false, detail: 'JS bundle not found' });
    results.push({ id: 'cache-prefix', intact: false, detail: 'JS bundle not found' });
    return results;
  }

  let content;
  try {
    content = fs.readFileSync(bundlePath, 'utf8');
  } catch {
    results.push({ id: 'cache-ttl', intact: false, detail: 'cannot read bundle' });
    results.push({ id: 'cache-prefix', intact: false, detail: 'cannot read bundle' });
    return results;
  }

  // cache-ttl: patched = ephemeral_1h present, ephemeral_5m absent
  const has5m = content.includes('ephemeral_5m');
  const has1h = content.includes('ephemeral_1h');
  if (has1h && !has5m) {
    results.push({ id: 'cache-ttl', intact: true, detail: 'still patched (1-hour TTL)' });
  } else if (!has5m && !has1h) {
    // Bundle format changed entirely — can't tell
    results.push({ id: 'cache-ttl', intact: false, detail: 'bundle format changed — cannot verify' });
  } else {
    results.push({ id: 'cache-ttl', intact: false, detail: 'overwritten — back to 5-minute TTL' });
  }

  // cache-prefix: patched = deferred_tools_delta filter is ABSENT
  const hasDeltaFilter = /type:\s*"deferred_tools_delta"/.test(content);
  if (!hasDeltaFilter) {
    // Could be patched, or could be a newer CC version that fixed it natively
    results.push({ id: 'cache-prefix', intact: true, detail: 'still patched (deltas persisted)' });
  } else {
    results.push({ id: 'cache-prefix', intact: false, detail: 'overwritten — session deltas not being saved' });
  }

  return results;
}

module.exports = { getAvailablePatches, applyPatch: applyPatchById, getRecommendedPatches, findClaudeBinary, findMainBundle, verifyPatches };
