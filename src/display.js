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
  info(`Open the dashboard and drop the file in for the full visual report.`);
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
};
