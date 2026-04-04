// Report generator — creates JSON for the web dashboard
// Also handles loading reports from file

const fs = require('fs');
const path = require('path');

function generateReport(scanResults, diagnosis) {
  return {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    generator: 'cc-token-doctor',

    summary: {
      overallHealth: diagnosis.overallHealth,
      sessionCount: diagnosis.raw.sessionCount,
      totalTurns: diagnosis.raw.totalTurns,
      dateRange: diagnosis.raw.dateRange,
    },

    cache: diagnosis.cacheHealth ? {
      status: diagnosis.cacheHealth.status,
      hitRatio: round(diagnosis.cacheHealth.hitRatio, 4),
      creationRatio: round(diagnosis.cacheHealth.creationRatio, 4),
      uncachedRatio: round(diagnosis.cacheHealth.uncachedRatio, 4),
      cacheBreaks: diagnosis.cacheHealth.cacheBreaks,
      totals: {
        input: diagnosis.cacheHealth.totalInput,
        cacheCreation: diagnosis.cacheHealth.totalCacheCreation,
        cacheRead: diagnosis.cacheHealth.totalCacheRead,
        billed: diagnosis.cacheHealth.totalBilled,
      },
      // Sampled turn ratios for the chart (max 200 points)
      timeline: sampleTimeline(diagnosis.cacheHealth.turnRatios, 200),
    } : null,

    peakHours: diagnosis.peakHours ? {
      status: diagnosis.peakHours.status,
      peakRatio: round(diagnosis.peakHours.peakRatio, 4),
      peakTurns: diagnosis.peakHours.peakTurns,
      offPeakTurns: diagnosis.peakHours.offPeakTurns,
      hourDistribution: diagnosis.peakHours.hourDistribution,
    } : null,

    tokenBurn: diagnosis.tokenBurn ? {
      status: diagnosis.tokenBurn.status,
      avgPerTurn: diagnosis.tokenBurn.avgPerTurn,
      medianPerTurn: diagnosis.tokenBurn.medianPerTurn,
      p95PerTurn: diagnosis.tokenBurn.p95PerTurn,
      grandTotal: diagnosis.tokenBurn.grandTotal,
      spikeCount: diagnosis.tokenBurn.spikeCount,
      estimatedCost: diagnosis.tokenBurn.estimatedCost,
      // Sampled per-turn data for chart (max 200 points)
      timeline: sampleTimeline(
        diagnosis.tokenBurn.perTurn.map(p => ({ timestamp: p.timestamp, total: p.total })),
        200
      ),
    } : null,

    cacheTTL: diagnosis.cacheTTL ? {
      status: diagnosis.cacheTTL.status,
      oneHourRatio: round(diagnosis.cacheTTL.oneHourRatio, 4),
      fiveMinTotal: diagnosis.cacheTTL.fiveMinTotal,
      oneHourTotal: diagnosis.cacheTTL.oneHourTotal,
    } : null,

    sessions: diagnosis.sessionHealth ? {
      status: diagnosis.sessionHealth.status,
      totalSessions: diagnosis.sessionHealth.totalSessions,
      totalResumes: diagnosis.sessionHealth.totalResumes,
      resumeBreaks: diagnosis.sessionHealth.resumeBreaks,
      resumeSuccessRate: round(diagnosis.sessionHealth.resumeSuccessRate, 4),
    } : null,

    verdict: diagnosis.verdictLines,
    recommendations: diagnosis.recommendations,
  };
}

function sampleTimeline(data, maxPoints) {
  if (!data || data.length <= maxPoints) return data || [];
  const step = Math.ceil(data.length / maxPoints);
  return data.filter((_, i) => i % step === 0);
}

function round(n, decimals) {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

function saveReport(report, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
  return outputPath;
}

function loadReport(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function getDefaultReportPath() {
  const os = require('os');
  // Save to ~/.cc-token-doctor/ — predictable location regardless of where you run the command
  const dir = path.join(os.homedir(), '.cc-token-doctor');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'report.json');
}

module.exports = { generateReport, saveReport, loadReport, getDefaultReportPath };
