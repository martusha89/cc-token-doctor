// Terminal display — zero dependencies, ANSI colors, plain English

const c = {
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
  white: '\x1b[37m', gray: '\x1b[90m',
  bold: '\x1b[1m', dim: '\x1b[2m', reset: '\x1b[0m',
  bg: { red: '\x1b[41m', green: '\x1b[42m', yellow: '\x1b[43m' },
};

const isWindows = process.platform === 'win32';
const check = isWindows ? '[OK]' : '\u2714';
const cross = isWindows ? '[!!]' : '\u2718';
const warn = isWindows ? '[!]' : '\u26A0';
const dot = isWindows ? '*' : '\u2022';
const bar = { full: isWindows ? '#' : '\u2588', empty: isWindows ? '-' : '\u2591' };

function banner() {
  console.log(`
${c.bold}${c.cyan}  _____ _____   _____     _                ____             _
 / ____/ ____| |_   _|   | |              |  _ \\           | |
| |   | |        | | ___ | | _____ _ __   | | | | ___   ___| |_ ___  _ __
| |   | |        | |/ _ \\| |/ / _ \\ '_ \\  | | | |/ _ \\ / __| __/ _ \\| '__|
| |___| |____    | | (_) |   <  __/ | | | | |_| | (_) | (__| || (_) | |
 \\_____\\_____|   |_|\\___/|_|\\_\\___|_| |_| |____/ \\___/ \\___|\\__\\___/|_|${c.reset}
`);
  console.log(`${c.dim}  Diagnose and fix Claude Code's token drain problem${c.reset}`);
  console.log(`${c.dim}  Built on research by Rangizingo, flightlesstux, kitaekatt & community${c.reset}`);
  console.log();
}

function status(icon, color, msg) {
  console.log(`  ${color}${icon}${c.reset} ${msg}`);
}

function ok(msg) { status(check, c.green, msg); }
function bad(msg) { status(cross, c.red, msg); }
function warning(msg) { status(warn, c.yellow, msg); }
function info(msg) { status(dot, c.cyan, msg); }
function dim(msg) { console.log(`  ${c.dim}${msg}${c.reset}`); }

function section(title) {
  console.log();
  console.log(`  ${c.bold}${c.white}${title}${c.reset}`);
  console.log(`  ${c.dim}${'─'.repeat(Math.min(title.length + 4, 50))}${c.reset}`);
}

function progressBar(ratio, width = 30) {
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const color = ratio >= 0.6 ? c.green : ratio >= 0.3 ? c.yellow : c.red;
  return `${color}${bar.full.repeat(filled)}${c.dim}${bar.empty.repeat(empty)}${c.reset}`;
}

function percentage(ratio) {
  const pct = (ratio * 100).toFixed(1);
  const color = ratio >= 0.6 ? c.green : ratio >= 0.3 ? c.yellow : c.red;
  return `${color}${c.bold}${pct}%${c.reset}`;
}

function tokenCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function verdict(diagnosis) {
  console.log();
  console.log(`  ${c.bold}${'═'.repeat(54)}${c.reset}`);

  const level = diagnosis.overallHealth;
  const color = level === 'healthy' ? c.green : level === 'degraded' ? c.yellow : c.red;
  const label = level === 'healthy' ? 'HEALTHY' : level === 'degraded' ? 'NEEDS ATTENTION' : 'BROKEN';

  console.log(`  ${c.bold}  VERDICT: ${color}${label}${c.reset}`);
  console.log(`  ${c.bold}${'═'.repeat(54)}${c.reset}`);
  console.log();

  for (const line of diagnosis.verdictLines) {
    console.log(`  ${line}`);
  }
  console.log();
}

function recommendations(recs) {
  section('What To Do');
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    const priority = rec.priority === 'high' ? `${c.red}[HIGH]${c.reset}` :
                     rec.priority === 'medium' ? `${c.yellow}[MED]${c.reset}` :
                     `${c.green}[LOW]${c.reset}`;
    console.log(`  ${c.bold}${i + 1}.${c.reset} ${priority} ${rec.title}`);
    console.log(`     ${c.dim}${rec.description}${c.reset}`);
    if (rec.command) {
      console.log(`     ${c.cyan}$ ${rec.command}${c.reset}`);
    }
    console.log();
  }
}

function patchStatus(verifyResults, appliedFixes) {
  section('Patch Status');
  const fixIds = Object.keys(appliedFixes);
  if (fixIds.length === 0) {
    dim('No fixes have been applied yet.');
    return;
  }

  let allIntact = true;
  let anyWiped = false;

  for (const result of verifyResults) {
    // Only show status for patches the user actually applied
    if (!appliedFixes[result.id]) continue;

    if (result.intact) {
      ok(`${getPatchName(result.id)} ${c.dim}— ${result.detail}${c.reset}`);
    } else {
      bad(`${getPatchName(result.id)} ${c.dim}— ${result.detail}${c.reset}`);
      allIntact = false;
      anyWiped = true;
    }
  }

  // Show when fixes were applied
  const times = Object.values(appliedFixes).map(f => f.appliedAt).filter(Boolean);
  if (times.length > 0) {
    const earliest = new Date(Math.min(...times.map(t => new Date(t).getTime())));
    dim(`Fixes applied: ${formatTimeAgo(earliest)}`);
  }

  if (anyWiped) {
    console.log();
    warning(`Claude Code was updated since you applied fixes. Binary patches were lost.`);
  }

  return { allIntact, anyWiped };
}

function comparison(comp) {
  if (!comp) return;

  section('Before vs After Fixes');
  console.log();

  const bHit = comp.before.hitRatio;
  const aHit = comp.after.hitRatio;
  const hitDelta = aHit - bHit;
  const hitArrow = hitDelta > 0 ? `${c.green}+${(hitDelta * 100).toFixed(1)}%${c.reset}` :
                   hitDelta < 0 ? `${c.red}${(hitDelta * 100).toFixed(1)}%${c.reset}` :
                   `${c.dim}no change${c.reset}`;

  console.log(`  Cache hit ratio:  ${percentage(bHit)} ${c.dim}->${c.reset} ${percentage(aHit)}  ${hitArrow}`);

  const bTTL = comp.before.ttlRatio;
  const aTTL = comp.after.ttlRatio;
  const ttlDelta = aTTL - bTTL;
  const ttlArrow = ttlDelta > 0 ? `${c.green}+${(ttlDelta * 100).toFixed(1)}%${c.reset}` :
                   ttlDelta < 0 ? `${c.red}${(ttlDelta * 100).toFixed(1)}%${c.reset}` :
                   `${c.dim}no change${c.reset}`;

  console.log(`  1-hour TTL ratio: ${percentage(bTTL)} ${c.dim}->${c.reset} ${percentage(aTTL)}  ${ttlArrow}`);

  const bAvg = comp.before.avgTokensPerTurn;
  const aAvg = comp.after.avgTokensPerTurn;
  const saved = bAvg - aAvg;
  if (saved > 0) {
    console.log(`  Avg tokens/msg:   ${c.bold}${tokenCount(bAvg)}${c.reset} ${c.dim}->${c.reset} ${c.bold}${tokenCount(aAvg)}${c.reset}  ${c.green}saving ~${tokenCount(saved)}/msg${c.reset}`);
  } else {
    console.log(`  Avg tokens/msg:   ${c.bold}${tokenCount(bAvg)}${c.reset} ${c.dim}->${c.reset} ${c.bold}${tokenCount(aAvg)}${c.reset}`);
  }

  console.log();
}

function fixAwareNote(fixAware) {
  if (!fixAware) return;

  if (fixAware.usingPostFixOnly) {
    info(`Analyzing ${c.bold}${fixAware.postFixTurns}${c.reset} messages since fixes were applied ${c.dim}(ignoring ${fixAware.preFixTurns} pre-fix messages)${c.reset}`);
  } else if (fixAware.postFixTurns > 0 && fixAware.postFixTurns < 10) {
    warning(`Only ${fixAware.postFixTurns} messages since fixes were applied — not enough to measure impact yet.`);
    dim(`Using all ${fixAware.totalTurns} messages for now. Run more sessions, then check again.`);
  }
}

function getPatchName(id) {
  const names = {
    'env-attribution': 'Attribution Header',
    'cache-ttl': 'Cache TTL (1-hour)',
    'cache-prefix': 'Cache Prefix Stabilizer',
  };
  return names[id] || id;
}

function formatTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 2) return 'just now';
  if (diffMins < 60) return `${diffMins} minutes ago`;
  if (diffHrs < 24) return `${diffHrs} hour${diffHrs === 1 ? '' : 's'} ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 30) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

function credits() {
  console.log();
  dim('─────────────────────────────────────────────────────');
  dim('Built on research by:');
  dim('  Rangizingo (cc-cache-fix) — patch discovery & implementation');
  dim('  flightlesstux (prompt-caching) — API-level caching research');
  dim('  kitaekatt (cache-kit) — cache reporting');
  dim('  Claude Code community — bug reports & documentation');
  dim('');
  dim('GitHub Issues: #38335, #38029, #37436, #34410');
  dim('─────────────────────────────────────────────────────');
  console.log();
}

function reportSaved(filePath) {
  console.log();
  info(`Report saved to ${c.bold}${filePath}${c.reset}`);
  info(`Dashboard: ${c.bold}${c.cyan}https://aidhd.co/token-doctor${c.reset} — drop the file in for the full visual report.`);
}

function spinner(text) {
  const frames = isWindows ? ['-', '\\', '|', '/'] : ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const id = setInterval(() => {
    process.stdout.write(`\r  ${c.cyan}${frames[i++ % frames.length]}${c.reset} ${text}`);
  }, 80);
  return {
    stop(finalText) {
      clearInterval(id);
      process.stdout.write(`\r  ${c.green}${check}${c.reset} ${finalText || text}\n`);
    },
    fail(finalText) {
      clearInterval(id);
      process.stdout.write(`\r  ${c.red}${cross}${c.reset} ${finalText || text}\n`);
    },
  };
}

module.exports = {
  c, banner, ok, bad, warning, info, dim, section,
  progressBar, percentage, tokenCount,
  verdict, recommendations, credits, reportSaved, spinner,
  patchStatus, comparison, fixAwareNote,
};
