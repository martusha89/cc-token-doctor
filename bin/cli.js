#!/usr/bin/env node

// CC Token Doctor — Diagnose and fix Claude Code's token drain
// One command: npx cc-token-doctor
// Zero dependencies.

const readline = require('readline');
const path = require('path');
const { scanAll } = require('../src/scanner');
const { diagnose } = require('../src/diagnose');
const { generateReport, saveReport, getDefaultReportPath } = require('../src/report');
const { getRecommendedPatches, applyPatch, getAvailablePatches, findClaudeBinary, verifyPatches } = require('../src/patches');
const { restoreAll, listBackups } = require('../src/backup');
const { hasAppliedFixes, getAppliedFixes, getFixTimestamp, recordFixApplied, clearFixRecord } = require('../src/state');
const ui = require('../src/display');

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')).map(a => a.toLowerCase()));

async function main() {
  ui.banner();

  // Handle --undo
  if (flags.has('--undo') || flags.has('--restore')) {
    return handleUndo();
  }

  // Handle --list-patches
  if (flags.has('--list-patches')) {
    return handleListPatches();
  }

  // Step 1: Scan
  ui.section('Scanning Sessions');
  const spin = ui.spinner('Reading your Claude Code sessions...');

  let scanResults;
  try {
    scanResults = await scanAll({
      maxSessions: flags.has('--all') ? 500 : 50,
      maxAgeDays: flags.has('--all') ? 365 : 30,
    });
    spin.stop(`Found ${scanResults.sessionCount} sessions with ${scanResults.totalTurns} messages`);
  } catch (e) {
    spin.fail('Failed to read sessions');
    ui.bad(`Error: ${e.message}`);
    ui.dim('Make sure you have Claude Code installed and have used it at least once.');
    ui.dim('Sessions are stored in ~/.claude/projects/');
    process.exit(1);
  }

  if (scanResults.totalTurns === 0) {
    ui.warning('No usage data found in your sessions.');
    ui.dim('This can happen if sessions are very old or empty.');
    ui.dim('Try running with --all to scan all sessions regardless of age.');
    process.exit(0);
  }

  // Step 2: Check if fixes were previously applied
  let fixTimestamp = null;
  let patchesWiped = false;

  if (hasAppliedFixes()) {
    const appliedFixes = getAppliedFixes();
    const verifyResults = verifyPatches();
    const status = ui.patchStatus(verifyResults, appliedFixes);

    if (status && status.anyWiped) {
      patchesWiped = true;
      console.log();
      const reapply = await ask(
        `${ui.c.bold}Reapply the wiped fixes now? ${ui.c.dim}[Y/n]${ui.c.reset} `
      );
      if (reapply.toLowerCase() !== 'n') {
        await handleReapply(verifyResults, appliedFixes);
      }
    }

    fixTimestamp = getFixTimestamp();
  }

  // Step 3: Diagnose (fix-aware if fixes were applied)
  ui.section('Analyzing');
  const diagSpin = ui.spinner('Running diagnostics...');
  const diagnosis = diagnose(scanResults, { fixTimestamp });
  diagSpin.stop('Diagnosis complete');

  // Show fix-aware context if applicable
  if (diagnosis.fixAware) {
    ui.fixAwareNote(diagnosis.fixAware);
  }

  // Step 4: Display results
  displayResults(diagnosis);

  // Show before/after comparison if we have enough data
  if (diagnosis.comparison) {
    ui.comparison(diagnosis.comparison);
  }

  // Step 5: Save report
  const report = generateReport(scanResults, diagnosis);
  const reportPath = getDefaultReportPath();
  saveReport(report, reportPath);
  ui.reportSaved(reportPath);

  // Offer to open dashboard with the report
  if (!flags.has('--no-open')) {
    console.log();
    const shouldOpen = await ask(
      `${ui.c.bold}Open the visual dashboard? ${ui.c.dim}[Y/n]${ui.c.reset} `
    );
    if (shouldOpen.toLowerCase() !== 'n') {
      openDashboard(report);
    }
  }

  // Step 6: Offer fixes (unless --diagnose-only)
  if (!flags.has('--diagnose-only') && diagnosis.overallHealth !== 'healthy' && !patchesWiped) {
    await handleFix(diagnosis);
  }

  if (flags.has('--fix') && diagnosis.overallHealth === 'healthy') {
    ui.info('Your installation looks healthy — no fixes needed right now.');
  }

  ui.credits();
}

function displayResults(diagnosis) {
  // Cache Health
  if (diagnosis.cacheHealth) {
    ui.section('Cache Health');
    const ch = diagnosis.cacheHealth;
    console.log(`  Hit ratio:  ${ui.progressBar(ch.hitRatio)} ${ui.percentage(ch.hitRatio)}`);
    console.log(`  ${ui.c.dim}Cache reads: ${ui.tokenCount(ch.totalCacheRead)} | New writes: ${ui.tokenCount(ch.totalCacheCreation)} | Uncached: ${ui.tokenCount(ch.totalInput)}${ui.c.reset}`);

    if (ch.cacheBreaks > 0) {
      ui.warning(`${ch.cacheBreaks} cache breaks detected (cache dropped to zero mid-session)`);
    }
    if (ch.status === 'broken') {
      ui.bad('Your cache is barely working. Most of your context is being re-read at full price every turn.');
    } else if (ch.status === 'degraded') {
      ui.warning('Your cache is underperforming. You should be getting more hits than this.');
    } else {
      ui.ok('Cache is working well.');
    }
  }

  // Cache TTL
  if (diagnosis.cacheTTL) {
    ui.section('Cache TTL');
    const ttl = diagnosis.cacheTTL;
    if (ttl.status === 'suboptimal') {
      ui.bad(`Using 5-minute cache TTL. ${ui.tokenCount(ttl.fiveMinTotal)} tokens on short-lived cache vs ${ui.tokenCount(ttl.oneHourTotal)} on 1-hour.`);
      ui.dim('Every pause longer than 5 minutes invalidates your entire cache.');
    } else if (ttl.status === 'mixed') {
      ui.warning(`Mixed TTL. ${ui.c.bold}${Math.round(ttl.oneHourRatio * 100)}%${ui.c.reset} on 1-hour, rest on 5-minute.`);
    } else {
      ui.ok(`1-hour TTL active (${Math.round(ttl.oneHourRatio * 100)}% of cache writes).`);
    }
  }

  // Token Burn
  if (diagnosis.tokenBurn) {
    ui.section('Token Usage');
    ui.dim('Tokens = the units Claude Code uses to read and write. More tokens = more of your quota used up.');
    console.log();
    const burn = diagnosis.tokenBurn;
    console.log(`  Each message uses:  ${ui.c.bold}~${ui.tokenCount(burn.medianPerTurn)} tokens${ui.c.reset} typically ${ui.c.dim}(${ui.tokenCount(burn.avgPerTurn)} avg, worst case ${ui.tokenCount(burn.p95PerTurn)})${ui.c.reset}`);
    console.log(`  Total scanned:      ${ui.c.bold}${ui.tokenCount(burn.grandTotal)}${ui.c.reset} tokens across ${diagnosis.raw.totalTurns} messages`);
    console.log(`  Estimated cost:     ${ui.c.bold}$${burn.estimatedCost.toFixed(2)}${ui.c.reset} ${ui.c.dim}(what this would cost at API rates — your subscription may differ)${ui.c.reset}`);

    if (burn.spikeCount > 0) {
      console.log();
      ui.warning(`${burn.spikeCount} spikes — messages that used way more tokens than normal. Could be a counter bug.`);
    }
  }

  // Peak Hours
  if (diagnosis.peakHours) {
    ui.section('Peak Hours');
    const ph = diagnosis.peakHours;
    const pctPeak = Math.round(ph.peakRatio * 100);

    if (ph.status === 'heavy') {
      ui.bad(`${pctPeak}% of your usage falls during Anthropic's peak window (weekdays 5-11am PT).`);
      ui.dim('Session limits burn faster during peak hours. ~7% of users affected.');
    } else if (ph.status === 'moderate') {
      ui.warning(`${pctPeak}% of your usage is during peak hours.`);
    } else {
      ui.ok(`Only ${pctPeak}% of usage during peak hours. You're mostly in the clear.`);
    }
  }

  // Session Resumes
  if (diagnosis.sessionHealth) {
    ui.section('Session Resumes');
    const sh = diagnosis.sessionHealth;
    const pctOk = Math.round(sh.resumeSuccessRate * 100);

    console.log(`  ${sh.totalSessions} sessions, ${sh.totalResumes} resumes detected`);
    if (sh.totalResumes > 0) {
      console.log(`  Resume success: ${ui.progressBar(sh.resumeSuccessRate)} ${ui.percentage(sh.resumeSuccessRate)}`);
      if (sh.resumeBreaks > 0) {
        ui.warning(`${sh.resumeBreaks} resumes broke the cache (full re-read on return).`);
      }
    } else {
      ui.dim('No session resumes detected (or all sessions were single-sitting).');
    }
  }

  // Verdict
  ui.verdict(diagnosis);

  // Recommendations
  if (diagnosis.recommendations.length > 0) {
    ui.recommendations(diagnosis.recommendations);
  }
}

async function handleFix(diagnosis) {
  const recommended = getRecommendedPatches(diagnosis);
  if (recommended.length === 0) {
    ui.info('No fixes needed — your installation looks healthy.');
    return;
  }

  ui.section('Available Fixes');
  console.log();
  console.log(`  Based on the diagnosis, here's what can help:`);
  console.log();

  // Show all recommended fixes with full explanations
  for (let i = 0; i < recommended.length; i++) {
    const patch = recommended[i];
    const num = i + 1;
    const riskColor = patch.risk === 'none' ? ui.c.green :
                      patch.risk === 'low' ? ui.c.yellow : ui.c.red;
    const riskLabel = patch.risk === 'none' ? 'SAFE' :
                      patch.risk === 'low' ? 'LOW RISK' : 'MODERATE';

    console.log(`  ${ui.c.bold}${ui.c.cyan}Fix ${num}: ${patch.name}${ui.c.reset}  ${riskColor}[${riskLabel}]${ui.c.reset}`);
    console.log();
    console.log(`  ${ui.c.bold}The problem:${ui.c.reset}`);
    wrapPrint(patch.explain.problem, 60, 4);
    console.log();
    console.log(`  ${ui.c.bold}What this fix does:${ui.c.reset}`);
    wrapPrint(patch.explain.fix, 60, 4);
    console.log();
    console.log(`  ${ui.c.bold}What it touches:${ui.c.reset}`);
    wrapPrint(patch.explain.touches, 60, 4);
    console.log();
    console.log(`  ${ui.c.bold}How to undo:${ui.c.reset}`);
    wrapPrint(patch.explain.undo, 60, 4);
    console.log();
    console.log(`  ${ui.c.dim}${'─'.repeat(50)}${ui.c.reset}`);
    console.log();
  }

  // Ask for consent
  const answer = await ask(
    `${ui.c.bold}Apply these fixes? ${ui.c.reset}[${ui.c.green}a${ui.c.reset}]ll / [${ui.c.cyan}p${ui.c.reset}]ick one by one / [${ui.c.dim}n${ui.c.reset}]one: `
  );

  const mode = answer.toLowerCase().trim();
  if (mode === 'n' || mode === 'none') {
    console.log();
    ui.dim('No changes made. You can come back any time with: npx cc-token-doctor --fix');
    return;
  }

  console.log();
  ui.section('Applying Fixes');

  let applied = 0;
  for (let i = 0; i < recommended.length; i++) {
    const patch = recommended[i];

    // In pick mode, ask for each one
    if (mode === 'p' || mode === 'pick') {
      const yesNo = await ask(
        `  Apply "${patch.name}"? [Y/n]: `
      );
      if (yesNo.toLowerCase() === 'n') {
        ui.dim(`  Skipped: ${patch.name}`);
        console.log();
        continue;
      }
    }

    console.log();
    ui.info(`${ui.c.bold}${patch.name}${ui.c.reset}`);
    const results = applyPatch(patch.id);

    let patchSucceeded = false;
    for (const r of results) {
      if (r.success) {
        ui.ok(r.detail);
        patchSucceeded = true;
      } else {
        ui.bad(r.detail);
      }
    }

    if (patchSucceeded) {
      recordFixApplied(patch.id);
    }
    applied++;
  }

  console.log();
  if (applied > 0) {
    ui.ok(`${applied} fix${applied === 1 ? '' : 'es'} applied. Restart Claude Code for changes to take effect.`);
    console.log();
    ui.dim('Changed your mind? Run this to undo everything:');
    console.log(`  ${ui.c.cyan}npx cc-token-doctor --undo${ui.c.reset}`);
  } else {
    ui.dim('No fixes applied.');
  }
}

async function handleReapply(verifyResults, appliedFixes) {
  ui.section('Reapplying Fixes');

  let reapplied = 0;
  for (const result of verifyResults) {
    // Only reapply patches that were previously applied and are now wiped
    if (!appliedFixes[result.id] || result.intact) continue;

    console.log();
    ui.info(`${ui.c.bold}${result.id}${ui.c.reset}`);
    const results = applyPatch(result.id);

    let patchSucceeded = false;
    for (const r of results) {
      if (r.success) {
        ui.ok(r.detail);
        patchSucceeded = true;
      } else {
        ui.bad(r.detail);
      }
    }

    if (patchSucceeded) {
      recordFixApplied(result.id);
      reapplied++;
    }
  }

  console.log();
  if (reapplied > 0) {
    ui.ok(`${reapplied} fix${reapplied === 1 ? '' : 'es'} reapplied. Restart Claude Code for changes to take effect.`);
  } else {
    ui.warning('Could not reapply fixes — Claude Code bundle may have changed format.');
    ui.dim('Try updating cc-token-doctor: npx cc-token-doctor@latest');
  }
}

function wrapPrint(text, width, indent) {
  const pad = ' '.repeat(indent);
  const words = text.split(' ');
  let line = pad;

  for (const word of words) {
    if (line.length + word.length + 1 > width + indent && line.trim()) {
      console.log(line);
      line = pad + word;
    } else {
      line += (line.trim() ? ' ' : '') + word;
    }
  }
  if (line.trim()) console.log(line);
}

function handleUndo() {
  ui.section('Restoring Backups');

  const backups = listBackups();
  if (backups.length === 0) {
    ui.info('No backups found. Nothing to restore.');
    return;
  }

  ui.info(`Found ${backups.length} backup(s).`);
  const results = restoreAll();

  for (const r of results) {
    if (r.success) ui.ok(r.detail);
    else ui.bad(r.detail);
  }

  // Clear fix records for binary patches (env var stays — it's harmless)
  clearFixRecord('cache-ttl');
  clearFixRecord('cache-prefix');

  console.log();
  ui.info('Restored to pre-patch state. Restart Claude Code.');
}

function handleListPatches() {
  ui.section('Available Patches');
  const patches = getAvailablePatches();
  for (const p of patches) {
    const risk = p.risk === 'none' ? ui.c.green : p.risk === 'low' ? ui.c.yellow : ui.c.red;
    console.log(`  ${ui.c.bold}${p.id}${ui.c.reset} — ${p.name}`);
    console.log(`  ${ui.c.dim}${p.description}${ui.c.reset}`);
    console.log(`  Risk: ${risk}${p.risk}${ui.c.reset} | Type: ${p.type}`);
    console.log();
  }
}

function openDashboard(report) {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const os = require('os');

  // Find dashboard HTML template
  const candidates = [
    path.join(__dirname, '..', 'dashboard', 'index.html'),
    path.join(process.cwd(), 'dashboard', 'index.html'),
  ];
  const templatePath = candidates.find(f => fs.existsSync(f));

  if (!templatePath) {
    ui.warning('Dashboard template not found.');
    ui.dim(`Visit ${ui.c.cyan}https://aidhd.co/token-doctor${ui.c.reset} and drop your report file in.`);
    return;
  }

  // Read the template and inject report data so it loads instantly
  let html = fs.readFileSync(templatePath, 'utf8');
  const injection = `<script>window.__CC_TOKEN_DOCTOR_REPORT__ = ${JSON.stringify(report)};</script>`;
  html = html.replace('</head>', `${injection}\n</head>`);

  // Save the self-contained report HTML
  const outDir = path.join(os.homedir(), '.cc-token-doctor');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'report.html');
  fs.writeFileSync(outPath, html, 'utf8');

  // Open in default browser
  const openCmd = process.platform === 'win32' ? 'start ""' :
                  process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    execSync(`${openCmd} "${outPath}"`, { stdio: 'ignore' });
    ui.ok('Dashboard opened in your browser — your results are already loaded.');
  } catch {
    ui.warning(`Couldn't open browser automatically.`);
    ui.dim(`Open this file: ${outPath}`);
  }
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

main().catch(e => {
  console.error(`\n${ui.c.red}Fatal error: ${e.message}${ui.c.reset}`);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});
