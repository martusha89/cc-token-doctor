// Diagnostic engine — analyzes session data, produces a plain-English report
// No dependencies, pure logic

function diagnose(scanResults, options = {}) {
  const allTurns = scanResults.allTurns.filter(t => t.type === 'assistant' && t.usage);

  if (allTurns.length === 0) {
    return {
      overallHealth: 'unknown',
      cacheHealth: null,
      peakHours: null,
      tokenBurn: null,
      cacheTTL: null,
      sessionHealth: null,
      verdictLines: ['No assistant messages with usage data found. Run some Claude Code sessions first.'],
      recommendations: [],
      raw: {},
      fixAware: null,
    };
  }

  const fixTimestamp = options.fixTimestamp;
  let turns = allTurns;
  let preFixTurns = [];
  let usingPostFixOnly = false;
  let postFixCount = 0;

  if (fixTimestamp) {
    const fixTime = fixTimestamp.getTime();
    const postFix = allTurns.filter(t => new Date(t.timestamp).getTime() > fixTime);
    preFixTurns = allTurns.filter(t => new Date(t.timestamp).getTime() <= fixTime);
    postFixCount = postFix.length;

    // Need at least 10 post-fix messages for a meaningful diagnosis
    if (postFix.length >= 10) {
      turns = postFix;
      usingPostFixOnly = true;
    }
    // Otherwise use all data but flag it
  }

  const cache = analyzeCacheHealth(turns);
  const peak = analyzePeakHours(turns);
  const burn = analyzeTokenBurn(turns);
  const ttl = analyzeCacheTTL(turns);
  const sessions = analyzeSessionHealth(turns);

  const { overallHealth, verdictLines } = generateVerdict(cache, peak, burn, ttl, sessions);
  const recommendations = generateRecommendations(cache, peak, burn, ttl, sessions);

  // Build comparison if we have enough pre-fix and post-fix data
  let comparison = null;
  if (usingPostFixOnly && preFixTurns.length >= 5) {
    const preFix = {
      cache: analyzeCacheHealth(preFixTurns),
      ttl: analyzeCacheTTL(preFixTurns),
      burn: analyzeTokenBurn(preFixTurns),
    };
    comparison = {
      before: {
        hitRatio: preFix.cache.hitRatio,
        cacheStatus: preFix.cache.status,
        ttlRatio: preFix.ttl.oneHourRatio,
        ttlStatus: preFix.ttl.status,
        avgTokensPerTurn: preFix.burn.avgPerTurn,
      },
      after: {
        hitRatio: cache.hitRatio,
        cacheStatus: cache.status,
        ttlRatio: ttl.oneHourRatio,
        ttlStatus: ttl.status,
        avgTokensPerTurn: burn.avgPerTurn,
      },
    };
  }

  return {
    overallHealth,
    cacheHealth: cache,
    peakHours: peak,
    tokenBurn: burn,
    cacheTTL: ttl,
    sessionHealth: sessions,
    verdictLines,
    recommendations,
    raw: {
      totalTurns: turns.length,
      dateRange: {
        from: turns[0]?.timestamp,
        to: turns[turns.length - 1]?.timestamp,
      },
      sessionCount: scanResults.sessionCount,
    },
    fixAware: fixTimestamp ? {
      fixTimestamp: fixTimestamp.toISOString(),
      usingPostFixOnly,
      postFixTurns: postFixCount,
      preFixTurns: preFixTurns.length,
      totalTurns: allTurns.length,
    } : null,
    comparison,
  };
}

function analyzeCacheHealth(turns) {
  let totalInput = 0;
  let totalCacheCreation = 0;
  let totalCacheRead = 0;
  let cacheBreaks = 0;
  let prevCacheRead = 0;
  const turnRatios = [];

  for (const t of turns) {
    const u = t.usage;
    totalInput += u.inputTokens;
    totalCacheCreation += u.cacheCreation;
    totalCacheRead += u.cacheRead;

    const turnTotal = u.inputTokens + u.cacheCreation + u.cacheRead;
    const turnRatio = turnTotal > 0 ? u.cacheRead / turnTotal : 0;
    turnRatios.push({ timestamp: t.timestamp, ratio: turnRatio, total: turnTotal });

    // Detect cache breaks: cache read drops to near 0 after being substantial
    if (prevCacheRead > 5000 && u.cacheRead < 1000 && u.cacheCreation > 5000) {
      cacheBreaks++;
    }
    prevCacheRead = u.cacheRead;
  }

  const totalBilled = totalInput + totalCacheCreation + totalCacheRead;
  const hitRatio = totalBilled > 0 ? totalCacheRead / totalBilled : 0;
  const creationRatio = totalBilled > 0 ? totalCacheCreation / totalBilled : 0;
  const uncachedRatio = totalBilled > 0 ? totalInput / totalBilled : 0;

  // Healthy = 60%+ cache read, Degraded = 30-60%, Broken = <30%
  const status = hitRatio >= 0.6 ? 'healthy' : hitRatio >= 0.3 ? 'degraded' : 'broken';

  return {
    status,
    hitRatio,
    creationRatio,
    uncachedRatio,
    totalInput,
    totalCacheCreation,
    totalCacheRead,
    totalBilled,
    cacheBreaks,
    turnRatios,
  };
}

function analyzePeakHours(turns) {
  // Anthropic confirmed peak hours: weekday 5am-11am PT (12:00-18:00 UTC)
  let peakTurns = 0;
  let offPeakTurns = 0;
  let peakTokens = 0;
  let offPeakTokens = 0;
  const hourDistribution = new Array(24).fill(0);

  for (const t of turns) {
    const d = new Date(t.timestamp);
    const utcHour = d.getUTCHours();
    const day = d.getUTCDay(); // 0=Sun, 6=Sat
    const isWeekday = day >= 1 && day <= 5;
    const isPeak = isWeekday && utcHour >= 12 && utcHour < 18;
    const totalTokens = t.usage.inputTokens + t.usage.cacheCreation + t.usage.cacheRead;

    hourDistribution[utcHour]++;

    if (isPeak) {
      peakTurns++;
      peakTokens += totalTokens;
    } else {
      offPeakTurns++;
      offPeakTokens += totalTokens;
    }
  }

  const total = peakTurns + offPeakTurns;
  const peakRatio = total > 0 ? peakTurns / total : 0;
  const status = peakRatio >= 0.5 ? 'heavy' : peakRatio >= 0.2 ? 'moderate' : 'minimal';

  // Calculate user's local timezone offset from their usage pattern
  const peakHourLocal = hourDistribution.indexOf(Math.max(...hourDistribution));

  return {
    status,
    peakRatio,
    peakTurns,
    offPeakTurns,
    peakTokens,
    offPeakTokens,
    hourDistribution,
    busiestHourUTC: peakHourLocal,
  };
}

function analyzeTokenBurn(turns) {
  if (turns.length === 0) return { status: 'unknown', avgPerTurn: 0, spikes: [] };

  const perTurn = turns.map(t => ({
    timestamp: t.timestamp,
    total: t.usage.inputTokens + t.usage.cacheCreation + t.usage.cacheRead + t.usage.outputTokens,
    input: t.usage.inputTokens,
    output: t.usage.outputTokens,
    session: t.sessionId,
  }));

  const totals = perTurn.map(p => p.total);
  const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
  const sorted = [...totals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];

  // Spikes: turns that use more than 3x the median
  const spikeThreshold = median * 3;
  const spikes = perTurn.filter(p => p.total > spikeThreshold);

  // Grand total
  const grandTotal = totals.reduce((a, b) => a + b, 0);

  // Estimate cost (rough: $3/Mtok input, $15/Mtok output for Opus; cached reads are 0.1x)
  let estimatedCost = 0;
  for (const t of turns) {
    const u = t.usage;
    estimatedCost += (u.inputTokens / 1_000_000) * 15;          // Full price uncached
    estimatedCost += (u.cacheCreation / 1_000_000) * 18.75;     // 1.25x for cache write
    estimatedCost += (u.cacheRead / 1_000_000) * 1.50;          // 0.1x for cache read
    estimatedCost += (u.outputTokens / 1_000_000) * 75;         // Output price
  }

  const status = spikes.length > turns.length * 0.1 ? 'spiking' :
                 avg > 50000 ? 'high' : 'normal';

  return {
    status,
    avgPerTurn: Math.round(avg),
    medianPerTurn: Math.round(median),
    p95PerTurn: Math.round(p95),
    grandTotal,
    spikeCount: spikes.length,
    spikes: spikes.slice(0, 10), // Top 10 spikes
    estimatedCost: Math.round(estimatedCost * 100) / 100,
    perTurn,
  };
}

function analyzeCacheTTL(turns) {
  let fiveMinTotal = 0;
  let oneHourTotal = 0;

  for (const t of turns) {
    fiveMinTotal += t.cacheTTL?.fiveMin || 0;
    oneHourTotal += t.cacheTTL?.oneHour || 0;
  }

  const total = fiveMinTotal + oneHourTotal;
  const oneHourRatio = total > 0 ? oneHourTotal / total : 0;

  // If mostly 5-minute TTL, cache is expiring too fast
  const status = oneHourRatio >= 0.8 ? 'optimal' :
                 oneHourRatio >= 0.3 ? 'mixed' : 'suboptimal';

  return {
    status,
    fiveMinTotal,
    oneHourTotal,
    oneHourRatio,
  };
}

function analyzeSessionHealth(turns) {
  // Group turns by session
  const sessions = {};
  for (const t of turns) {
    const sid = t.sessionId || 'unknown';
    if (!sessions[sid]) sessions[sid] = [];
    sessions[sid].push(t);
  }

  const sessionIds = Object.keys(sessions);
  let resumeBreaks = 0;
  let totalResumes = 0;

  for (const sid of sessionIds) {
    const sessionTurns = sessions[sid];
    for (let i = 1; i < sessionTurns.length; i++) {
      const prev = new Date(sessionTurns[i - 1].timestamp);
      const curr = new Date(sessionTurns[i].timestamp);
      const gapMinutes = (curr - prev) / 60000;

      // If gap > 5 minutes, this is likely a session resume
      if (gapMinutes > 5) {
        totalResumes++;
        const u = sessionTurns[i].usage;
        // If cache read is very low on resume, cache broke
        if (u.cacheRead < 1000 && u.cacheCreation > 5000) {
          resumeBreaks++;
        }
      }
    }
  }

  const resumeSuccessRate = totalResumes > 0
    ? (totalResumes - resumeBreaks) / totalResumes
    : 1;

  const status = resumeSuccessRate >= 0.8 ? 'healthy' :
                 resumeSuccessRate >= 0.5 ? 'degraded' : 'broken';

  return {
    status,
    totalSessions: sessionIds.length,
    totalResumes,
    resumeBreaks,
    resumeSuccessRate,
  };
}

function generateVerdict(cache, peak, burn, ttl, sessions) {
  const problems = [];

  if (cache.status === 'broken') {
    problems.push('Your prompt cache is broken. The system is re-reading your entire context on almost every message instead of using cached data. This is the #1 reason tokens vanish.');
  } else if (cache.status === 'degraded') {
    problems.push('Your prompt cache is underperforming. You\'re getting some cache hits, but not enough — tokens are leaking.');
  }

  if (peak.status === 'heavy') {
    problems.push('More than half your usage falls during Anthropic\'s peak hours (weekdays 5-11am PT). Limits burn faster during these windows.');
  } else if (peak.status === 'moderate') {
    problems.push('A chunk of your usage overlaps with Anthropic\'s peak hours (weekdays 5-11am PT). This may be eating into your limits.');
  }

  if (ttl.status === 'suboptimal') {
    problems.push('Your cache is using 5-minute TTL instead of 1-hour. Every time you pause for more than 5 minutes, the entire cache expires and gets re-billed.');
  }

  if (sessions.status === 'broken') {
    problems.push('Session resumes are consistently breaking the cache. When you come back to a session, the cache prefix doesn\'t match — so everything gets re-read at full price.');
  } else if (sessions.status === 'degraded') {
    problems.push('Some session resumes are breaking the cache. This means returning to older sessions sometimes costs more than starting fresh.');
  }

  if (burn.status === 'spiking') {
    problems.push(`You have ${burn.spikeCount} token spikes — individual turns that consumed 3x+ the normal amount. This could indicate counter desync bugs.`);
  }

  let overallHealth;
  if (problems.length === 0) {
    overallHealth = 'healthy';
  } else if (cache.status === 'broken' || sessions.status === 'broken' || problems.length >= 3) {
    overallHealth = 'critical';
  } else {
    overallHealth = 'degraded';
  }

  const verdictLines = problems.length > 0 ? problems : [
    'Your Claude Code installation looks healthy. Cache is working, no major spikes, and you\'re not heavily affected by peak hours.',
  ];

  return { overallHealth, verdictLines };
}

function generateRecommendations(cache, peak, burn, ttl, sessions) {
  const recs = [];

  if (cache.status !== 'healthy' || sessions.status !== 'healthy') {
    recs.push({
      priority: 'high',
      title: 'Fix the prompt cache',
      description: 'Your cache is broken — Claude Code is re-reading your entire conversation from scratch on almost every message. Fixing this can cut your token usage by 10-20x. Run the fix command below and it will walk you through exactly what it changes.',
      command: 'npx cc-token-doctor --fix',
      fixId: 'cache-patches',
    });
  }

  if (ttl.status !== 'optimal') {
    recs.push({
      priority: 'high',
      title: 'Stop your cache from expiring every 5 minutes',
      description: 'Right now, if you pause for more than 5 minutes (to think, grab coffee, read docs), your entire cache gets thrown away. The fix extends this to 1 hour, so short breaks don\'t cost you.',
      command: 'npx cc-token-doctor --fix',
      fixId: 'cache-ttl',
    });
  }

  if (peak.status === 'heavy') {
    recs.push({
      priority: 'medium',
      title: 'Try to avoid Anthropic\'s busy hours',
      description: 'Anthropic slows things down during their busiest times — weekdays 5-11am California time (that\'s 1-7pm in the UK, 8am-2pm US East Coast). Your heaviest work will go further outside that window.',
      fixId: 'peak-hours',
    });
  }

  if (burn.spikeCount > 0) {
    recs.push({
      priority: 'medium',
      title: 'You have suspicious token spikes',
      description: `${burn.spikeCount} times, a single message used way more tokens than normal (3x+ the average). This is a known bug where the usage counter jumps randomly. If you see your usage go from 20% to 80% on one message, it\'s not you — it\'s a bug. Report it on GitHub so Anthropic can track it.`,
      fixId: 'spikes',
    });
  }

  // Always recommend these
  recs.push({
    priority: 'low',
    title: 'Use /compact when conversations get long',
    description: 'After 30+ messages back and forth, Claude Code has to read the entire conversation every time you send something. Type /compact to have it summarize the conversation so far — this shrinks it down and saves tokens on every message after that.',
    fixId: 'compact',
  });

  recs.push({
    priority: 'low',
    title: 'Check how many MCP servers you have connected',
    description: 'Every MCP server you have connected (tools, integrations, plugins) adds extra data that gets sent with every single message. If you have 5+ servers, that could be 10,000+ extra tokens per message. Disconnect any you\'re not actively using.',
    fixId: 'mcp-audit',
  });

  recs.push({
    priority: 'low',
    title: 'Disable the attribution tracking header',
    description: 'Claude Code sends a tracking ID with each message that can accidentally break caching. Turning it off is harmless — it just stops the ID from changing between messages, which helps the cache stay stable. The fix command handles this automatically.',
    command: process.platform === 'win32'
      ? 'setx CLAUDE_CODE_ATTRIBUTION_HEADER 0'
      : 'export CLAUDE_CODE_ATTRIBUTION_HEADER=0',
    fixId: 'attribution-header',
  });

  return recs;
}

module.exports = { diagnose };
