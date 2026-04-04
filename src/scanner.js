// Session scanner — finds and parses Claude Code session files
// Zero dependencies, reads ~/.claude/projects/**/*.jsonl

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

function getClaudeProjectsDir() {
  return path.join(os.homedir(), '.claude', 'projects');
}

function findSessionFiles(claudeDir) {
  if (!fs.existsSync(claudeDir)) return [];

  const sessions = [];
  let projects;
  try {
    projects = fs.readdirSync(claudeDir);
  } catch { return []; }

  for (const project of projects) {
    const projectDir = path.join(claudeDir, project);
    let stat;
    try { stat = fs.statSync(projectDir); } catch { continue; }
    if (!stat.isDirectory()) continue;

    let files;
    try { files = fs.readdirSync(projectDir); } catch { continue; }

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = path.join(projectDir, file);
      let fstat;
      try { fstat = fs.statSync(filePath); } catch { continue; }

      sessions.push({
        project: decodeProjectName(project),
        sessionId: path.basename(file, '.jsonl'),
        path: filePath,
        size: fstat.size,
        modified: fstat.mtime,
      });
    }
  }

  // Sort by most recent first
  sessions.sort((a, b) => b.modified - a.modified);
  return sessions;
}

function decodeProjectName(encoded) {
  // Claude Code encodes paths as C--Users-Marta-project -> C:\Users\Marta\project
  return encoded.replace(/--/g, ':\\').replace(/-/g, '\\');
}

async function parseSession(sessionPath, onProgress) {
  const turns = [];
  const fileStream = fs.createReadStream(sessionPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let lineNum = 0;
  for await (const line of rl) {
    lineNum++;
    if (!line.trim()) continue;

    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    if (entry.type === 'assistant' && entry.message?.usage) {
      const u = entry.message.usage;
      turns.push({
        type: 'assistant',
        timestamp: entry.timestamp,
        model: entry.message.model,
        sessionId: entry.sessionId,
        version: entry.version,
        requestId: entry.requestId,
        stopReason: entry.message.stop_reason,
        usage: {
          inputTokens: u.input_tokens || 0,
          cacheCreation: u.cache_creation_input_tokens || 0,
          cacheRead: u.cache_read_input_tokens || 0,
          outputTokens: u.output_tokens || 0,
          serviceTier: u.service_tier || 'unknown',
        },
        cacheTTL: {
          fiveMin: u.cache_creation?.ephemeral_5m_input_tokens || 0,
          oneHour: u.cache_creation?.ephemeral_1h_input_tokens || 0,
        },
      });
    } else if (entry.type === 'user' && entry.message) {
      turns.push({
        type: 'user',
        timestamp: entry.timestamp,
        sessionId: entry.sessionId,
        version: entry.version,
        contentLength: typeof entry.message.content === 'string'
          ? entry.message.content.length
          : JSON.stringify(entry.message.content).length,
      });
    }

    if (onProgress && lineNum % 500 === 0) onProgress(lineNum);
  }

  return turns;
}

async function scanAll(options = {}) {
  const claudeDir = options.claudeDir || getClaudeProjectsDir();
  const maxSessions = options.maxSessions || 50; // Most recent N sessions
  const maxAge = options.maxAgeDays || 30; // Only sessions from last N days

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAge);

  let sessionFiles = findSessionFiles(claudeDir);

  // Filter by age
  sessionFiles = sessionFiles.filter(s => s.modified >= cutoff);

  // Limit count
  sessionFiles = sessionFiles.slice(0, maxSessions);

  const results = {
    scanTime: new Date().toISOString(),
    claudeDir,
    sessionCount: sessionFiles.length,
    sessions: [],
    allTurns: [],
  };

  for (const sf of sessionFiles) {
    try {
      const turns = await parseSession(sf.path);
      if (turns.length === 0) continue;

      results.sessions.push({
        project: sf.project,
        sessionId: sf.sessionId,
        modified: sf.modified.toISOString(),
        size: sf.size,
        turnCount: turns.length,
      });

      for (const turn of turns) {
        turn.project = sf.project;
        results.allTurns.push(turn);
      }
    } catch {
      // Skip unreadable sessions
    }
  }

  // Sort all turns chronologically
  results.allTurns.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  results.totalTurns = results.allTurns.length;

  return results;
}

module.exports = { scanAll, parseSession, findSessionFiles, getClaudeProjectsDir };
