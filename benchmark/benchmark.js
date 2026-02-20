#!/usr/bin/env node
/**
 * qmd-bridge Benchmark Runner
 *
 * Tests 9 scenarios:
 *   1. Docker  — qmd search  (native, CPU)
 *   2. Mac     — qmd search  (native, GPU/Metal)
 *   3. Bridge  — qmd search  (Docker → Bridge → Mac GPU)
 *   4. Docker  — qmd vsearch (native, CPU)
 *   5. Mac     — qmd vsearch (native, GPU/Metal)
 *   6. Bridge  — qmd vsearch (Docker → Bridge → Mac GPU)
 *   7. Docker  — qmd query   (native, CPU)
 *   8. Mac     — qmd query   (native, GPU/Metal)
 *   9. Bridge  — qmd query   (Docker → Bridge → Mac GPU)
 *
 * Warmup strategy:
 *   Each scenario runs one un-timed warmup query before the benchmark loop.
 *   This ensures model loading / GPU cache / OS file buffers are hot before
 *   any latency numbers are recorded — so results reflect steady-state
 *   throughput, not cold-start overhead.
 *
 * Metrics: latency (mean/p50/p95/min/max), precision@5, result overlap vs Mac
 */

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────────

// After warmup, each command type runs this many times per query for stable averaging.
// Note: Docker native query re-loads ~2.1 GB GGUF models per docker exec (new process each
// time), so warmup helps via OS file cache but can't eliminate per-invocation load cost.
// RUNS_QUERY=1 avoids a ~50-minute Docker query run while still capturing steady-state perf.
const RUNS_SEARCH  = 1;  // BM25 — 1 run (fast, consistent)
const RUNS_VSEARCH = 1;  // vector — 1 run (model warm after warmup)
const RUNS_QUERY   = 1;  // LLM — 1 run (warmup pre-heats OS file cache)

const COLLECTION       = 'benchmark';
const BRIDGE_URL       = 'http://localhost:3333';
const DOCKER_CONTAINER = 'qmd-benchmark';
const RESULTS_DIR      = join(__dirname, 'results');
const QUERIES          = JSON.parse(readFileSync(join(__dirname, 'queries.json'), 'utf-8'));

// Warmup query — first query in the list; result discarded
const WARMUP_Q = QUERIES[0].query;

// ─── Percentile helper ───────────────────────────────────────────────────────

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    mean: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
    min:  sorted[0],
    max:  sorted[sorted.length - 1],
    p50:  percentile(sorted, 50),
    p95:  percentile(sorted, 95),
  };
}

// ─── Result parsing ──────────────────────────────────────────────────────────

function parseFiles(output) {
  const matches = output.match(/qmd:\/\/[a-zA-Z0-9_/-]+\.md/g) || [];
  return matches.map(m => m.split('/').pop());
}

function overlap(a, b) {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  return b.filter(x => setA.has(x)).length / Math.max(a.length, b.length);
}

function precision(results, expected) {
  if (!results.length) return 0;
  const setE = new Set(expected);
  return results.filter(r => setE.has(r)).length / results.length;
}

// ─── Execution strategies ────────────────────────────────────────────────────

async function runMac(command, query) {
  const start = Date.now();
  let output = '';
  try {
    const { stdout, stderr } = await execFileAsync(
      'qmd', [command, query, '-c', COLLECTION, '-n', '5'],
      { timeout: 300_000 }
    );
    output = stdout + stderr;
  } catch (err) {
    output = (err.stdout || '') + (err.stderr || '');
  }
  return { ms: Date.now() - start, output };
}

async function runDocker(command, query) {
  const start = Date.now();
  let output = '';
  try {
    const { stdout, stderr } = await execFileAsync(
      'docker', ['exec', DOCKER_CONTAINER,
        'qmd', command, query, '-c', COLLECTION, '-n', '5'],
      { timeout: 300_000 }
    );
    output = stdout + stderr;
  } catch (err) {
    output = (err.stdout || '') + (err.stderr || '');
  }
  return { ms: Date.now() - start, output };
}

async function runBridge(command, query, token) {
  const start = Date.now();
  let output = '';
  try {
    const res = await fetch(`${BRIDGE_URL}/qmd`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command, query }),
      signal: AbortSignal.timeout(300_000),
    });
    const json = await res.json();
    output = json.data || json.error || '';
  } catch (err) {
    output = err.message || '';
  }
  return { ms: Date.now() - start, output };
}

// ─── Docker health ───────────────────────────────────────────────────────────

function isDockerRunning() {
  try {
    const out = execFileSync(
      'docker', ['inspect', '--format', '{{.State.Running}}', DOCKER_CONTAINER],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    return out === 'true';
  } catch {
    return false;
  }
}

// ─── Scenario runner ─────────────────────────────────────────────────────────

/**
 * @param {string}   name         - display name
 * @param {Function} runner       - (cmd, query) => { ms, output }
 * @param {string}   command      - 'search' | 'vsearch' | 'query'
 * @param {Array}    queries      - query list
 * @param {number}   runsPerQuery - timed runs per query
 * @param {boolean}  doWarmup     - whether to run an un-timed warmup first
 * @param {boolean}  isDocker     - if true, bail out scenario when container is down
 */
async function runScenario(name, runner, command, queries, runsPerQuery, doWarmup, isDocker = false) {
  // ── Warmup phase ──────────────────────────────────────────────────────────
  if (doWarmup) {
    process.stdout.write(`  [warmup] ${name} [${command}] — loading models...`);
    const { ms } = await runner(command, WARMUP_Q);
    console.log(` done (${(ms / 1000).toFixed(1)}s)`);
  }

  // ── Timed phase ───────────────────────────────────────────────────────────
  console.log(`  Running ${name} [${command}] (${runsPerQuery}x per query)...`);
  const results = [];
  let containerDown = false;

  for (const q of queries) {
    // If Docker container died (OOM), mark remaining queries as failed
    if (isDocker && !isDockerRunning()) {
      containerDown = true;
      console.log('\n  ⚠  Docker container is no longer running (OOM?). Skipping remaining queries.');
    }
    if (containerDown) {
      results.push({
        queryId: q.id,
        query:   q.query,
        latency: { mean: 0, min: 0, max: 0, p50: 0, p95: 0 },
        files:   [],
        expected: q.expected,
        error:   'container_down',
      });
      continue;
    }

    const times = [];
    const fileResults = [];

    for (let i = 0; i < runsPerQuery; i++) {
      const { ms, output } = await runner(command, q.query);
      times.push(ms);
      if (i === runsPerQuery - 1) {
        fileResults.push(...parseFiles(output));
      }
      process.stdout.write('.');
    }

    results.push({
      queryId: q.id,
      query:   q.query,
      latency: stats(times),
      files:   [...new Set(fileResults)],
      expected: q.expected,
    });
  }

  console.log(' done');
  return results;
}

// ─── Setup checks ────────────────────────────────────────────────────────────

function checkBridgeRunning() {
  try {
    execFileSync('curl', ['-sf', `${BRIDGE_URL}/health`], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function getBridgeToken() {
  try {
    const out = execFileSync('node', [
      join(__dirname, '..', 'bin', 'cli.js'),
      'token', 'show', COLLECTION,
    ], { encoding: 'utf-8' }).trim();
    return out.split('\n')[0].trim();
  } catch {
    return null;
  }
}

// ─── Report ──────────────────────────────────────────────────────────────────

function buildReport(allScenarios) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const macSearchRef  = allScenarios.find(s => s.id === 'mac-search')?.results;
  const macVsearchRef = allScenarios.find(s => s.id === 'mac-vsearch')?.results;
  const macQueryRef   = allScenarios.find(s => s.id === 'mac-query')?.results;
  const refs = { search: macSearchRef, vsearch: macVsearchRef, query: macQueryRef };

  const table = allScenarios.map(s => {
    const validResults = s.results.filter(r => !r.error);
    const times = validResults.map(r => r.latency.mean);
    const overallLatency = times.length ? stats(times) : { mean: 0, min: 0, max: 0, p50: 0, p95: 0 };
    const ref = refs[s.command];

    const avgOverlap = ref
      ? validResults.reduce((sum, r, i) => {
          const refFiles = ref[i]?.files || [];
          return sum + overlap(r.files, refFiles);
        }, 0) / (validResults.length || 1)
      : null;

    const avgPrecision = validResults.reduce((sum, r) => {
      return sum + precision(r.files, r.expected);
    }, 0) / (validResults.length || 1);

    const failed = s.results.filter(r => r.error).length;
    return { id: s.id, name: s.name, command: s.command, latency: overallLatency, overlap: avgOverlap, precision: avgPrecision, failed };
  });

  // ── Console table ─────────────────────────────────────────────────────────
  console.log('\n');
  console.log('═'.repeat(118));
  console.log('  qmd-bridge Benchmark Results');
  console.log(`  Queries: ${QUERIES.length} | Runs (after warmup): search×${RUNS_SEARCH} vsearch×${RUNS_VSEARCH} query×${RUNS_QUERY} | ${new Date().toLocaleString()}`);
  console.log('═'.repeat(118));
  console.log(
    pad('Scenario', 38), pad('Cmd', 8),
    pad('Mean(ms)', 9), pad('P50(ms)', 8), pad('P95(ms)', 8),
    pad('Min(ms)', 8),  pad('Max(ms)', 8),
    pad('Precision', 10), pad('vs Mac', 8), pad('Failed', 7),
  );
  console.log('─'.repeat(118));

  for (const row of table) {
    console.log(
      pad(row.name, 38), pad(row.command, 8),
      pad(row.latency.mean, 9), pad(row.latency.p50, 8), pad(row.latency.p95, 8),
      pad(row.latency.min, 8),  pad(row.latency.max, 8),
      pad(pct(row.precision), 10),
      pad(row.overlap !== null ? pct(row.overlap) : 'N/A', 8),
      pad(row.failed ? `${row.failed}/${QUERIES.length}` : '-', 7),
    );
  }
  console.log('─'.repeat(118));

  // ── Per-query breakdown ───────────────────────────────────────────────────
  console.log('\n📋 Per-Query Latency (mean ms)\n');
  const header = ['Query'.padEnd(40), ...allScenarios.map(s => s.name.slice(0, 16).padStart(17))].join(' ');
  console.log(header);
  console.log('─'.repeat(header.length));

  for (let i = 0; i < QUERIES.length; i++) {
    const row = [QUERIES[i].description.padEnd(40)];
    for (const s of allScenarios) {
      const r = s.results[i];
      row.push((r?.error ? 'OOM' : String(r?.latency.mean ?? '-')).padStart(17));
    }
    console.log(row.join(' '));
  }

  // ── Save JSON ─────────────────────────────────────────────────────────────
  const jsonPath = join(RESULTS_DIR, `benchmark-${ts}.json`);
  writeFileSync(jsonPath, JSON.stringify({ table, scenarios: allScenarios, queries: QUERIES }, null, 2));
  console.log(`\n💾 Full results saved to: ${jsonPath}`);
  return table;
}

function pad(v, w) { return String(v).padEnd(w); }
function pct(v) { return (v * 100).toFixed(1) + '%'; }

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   qmd-bridge Benchmark Suite  (warmup + timed runs)      ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const bridgeRunning = checkBridgeRunning();
  const dockerRunning = isDockerRunning();
  const bridgeToken   = getBridgeToken();

  console.log('Pre-flight checks:');
  console.log(`  Mac qmd:       ✓`);
  console.log(`  Bridge:        ${bridgeRunning ? '✓ running' : '✗ not running'}`);
  console.log(`  Bridge token:  ${bridgeToken ? '✓ ' + bridgeToken.slice(0, 16) + '...' : '✗ missing'}`);
  console.log(`  Docker:        ${dockerRunning ? '✓ container running' : '✗ container not found'}`);

  if (!dockerRunning) { console.error('\n✗ Docker container not running.'); process.exit(1); }
  if (!bridgeRunning) { console.error('\n✗ qmd-bridge not running.'); process.exit(1); }
  if (!bridgeToken)   { console.error('\n✗ Bridge token not found.'); process.exit(1); }

  console.log('\n📌 Warmup strategy: one un-timed query runs before each scenario to load');
  console.log('   models into memory / GPU cache / OS buffers, then timed runs follow.\n');

  const allScenarios = [];

  // ── SEARCH ────────────────────────────────────────────────────────────────
  console.log('── SEARCH (BM25 keyword) ─────────────────────────────────────────');

  // BM25 needs no model warmup, but we still warmup to prime SQLite page cache
  allScenarios.push({ id: 'docker-search', name: 'Docker (native)',    command: 'search',
    results: await runScenario('Docker native',    (c, q) => runDocker(c, q),             'search', QUERIES, RUNS_SEARCH,  true, true)  });
  allScenarios.push({ id: 'mac-search',    name: 'Mac (native)',       command: 'search',
    results: await runScenario('Mac native',       (c, q) => runMac(c, q),                'search', QUERIES, RUNS_SEARCH,  true)  });
  allScenarios.push({ id: 'bridge-search', name: 'Docker via Bridge',  command: 'search',
    results: await runScenario('Docker via Bridge',(c, q) => runBridge(c, q, bridgeToken),'search', QUERIES, RUNS_SEARCH,  true)  });

  // ── VSEARCH ───────────────────────────────────────────────────────────────
  console.log('\n── VSEARCH (vector / semantic) ───────────────────────────────────');
  console.log('   Note: warmup loads embeddinggemma-300M (~300 MB) into memory.\n');

  allScenarios.push({ id: 'docker-vsearch', name: 'Docker (native)',   command: 'vsearch',
    results: await runScenario('Docker native',    (c, q) => runDocker(c, q),             'vsearch', QUERIES, RUNS_VSEARCH, true, true) });
  allScenarios.push({ id: 'mac-vsearch',    name: 'Mac (native)',      command: 'vsearch',
    results: await runScenario('Mac native',       (c, q) => runMac(c, q),                'vsearch', QUERIES, RUNS_VSEARCH, true) });
  allScenarios.push({ id: 'bridge-vsearch', name: 'Docker via Bridge', command: 'vsearch',
    results: await runScenario('Docker via Bridge',(c, q) => runBridge(c, q, bridgeToken),'vsearch', QUERIES, RUNS_VSEARCH, true) });

  // ── QUERY ─────────────────────────────────────────────────────────────────
  console.log('\n── QUERY (LLM expansion + reranking) ────────────────────────────');
  console.log('   Note: warmup loads query-expansion-1.7B + reranker-0.6B (~1.8 GB total).\n');

  allScenarios.push({ id: 'docker-query', name: 'Docker (native)',     command: 'query',
    results: await runScenario('Docker native',    (c, q) => runDocker(c, q),             'query', QUERIES, RUNS_QUERY, true, true) });
  allScenarios.push({ id: 'mac-query',    name: 'Mac (native)',        command: 'query',
    results: await runScenario('Mac native',       (c, q) => runMac(c, q),                'query', QUERIES, RUNS_QUERY, true) });
  allScenarios.push({ id: 'bridge-query', name: 'Docker via Bridge',   command: 'query',
    results: await runScenario('Docker via Bridge',(c, q) => runBridge(c, q, bridgeToken),'query', QUERIES, RUNS_QUERY, true) });

  buildReport(allScenarios);
}

main().catch(err => {
  console.error('\n✗ Benchmark failed:', err.message);
  process.exit(1);
});
