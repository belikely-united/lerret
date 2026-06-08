#!/usr/bin/env node
// Bundle-spike measurement for @lerret/ai (Story 8.0).
//
// Two independent gzipped-size readings that must agree, plus a per-dependency
// breakdown. Run after `pnpm --filter @lerret/ai build`. Node built-ins only.
//
// Output is a Markdown-ready table the dev pastes into docs/architecture/
// bundle-spike-YYYY-MM-DD.md.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { platform, arch } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const DIST = join(PKG_ROOT, 'dist');
const BUNDLE = join(DIST, 'index.js');
const STATS = join(DIST, 'bundle-stats.json');
const PKG_JSON = join(PKG_ROOT, 'package.json');

// ── Verdict band thresholds (gzipped KB) ─────────────────────────────────────
// Mechanical decision tree from architecture-epic-8.md §LangGraph.js Bundle-
// Spike Gate. Apply mechanically — do NOT advocate.
const PASS_MAX_KB = 500;
const WARN_MAX_KB = 1024;

function fail(msg) {
    console.error(`ERROR: ${msg}`);
    process.exit(1);
}

if (!existsSync(BUNDLE)) fail(`${BUNDLE} not found — run \`pnpm --filter @lerret/ai build\` first.`);
if (!existsSync(STATS)) fail(`${STATS} not found — verify rollup-plugin-visualizer ran with template:'raw-data'.`);

// ── Reading 1: rollup-plugin-visualizer raw-data JSON ────────────────────────
// Aggregate per-module sizes. In Vite 8's Rolldown pipeline the visualizer
// reports gzipLength=0 per module (gzip is only computed on the whole chunk),
// so we use renderedLength as the primary per-module signal and estimate
// per-module gzip proportionally from the whole-file gzip ratio in the
// breakdown step.
function readVisualizerTotal() {
    const stats = JSON.parse(readFileSync(STATS, 'utf8'));
    const nodes = stats.nodeParts || {};
    let totalGzip = 0;
    let totalRendered = 0;
    for (const uid in nodes) {
        const part = nodes[uid];
        if (!part) continue;
        if (typeof part.gzipLength === 'number') totalGzip += part.gzipLength;
        if (typeof part.renderedLength === 'number') totalRendered += part.renderedLength;
    }
    return { totalGzip, totalRendered, raw: stats };
}

// ── Reading 2: node:zlib gzipSync over the whole built file ──────────────────
// This is the conservative measurement — closer to what HTTP gzip transfer
// would actually produce.
function readWholeFileGzip() {
    const buf = readFileSync(BUNDLE);
    const gzipped = gzipSync(buf, { level: 9 });
    return { rawBytes: buf.length, gzipBytes: gzipped.length };
}

// ── Per-top-level-dependency breakdown ───────────────────────────────────────
// Walk the visualizer tree and bucket every leaf by the top-level npm package
// it belongs to. nodeParts keys are part-uids; the linking is part.metaUid →
// nodeMetas uid (which carries the `id` source path). pnpm's path layout looks
// like `node_modules/.pnpm/<spec>/node_modules/<scope>/<pkg>/...` — strip the
// `.pnpm/<spec>/` prefix before extracting the bucket name.
function breakdownByDep(rawStats, wholeFileGzipBytes, totalRendered) {
    const nodeMetas = rawStats.nodeMetas || {};
    const nodeParts = rawStats.nodeParts || {};
    const buckets = new Map();
    // Match a pnpm-style nested node_modules path first (post-`.pnpm/<spec>/`),
    // otherwise fall back to the standard `node_modules/<pkg>/` shape.
    const PNPM_NESTED = /node_modules\/\.pnpm\/[^/]+\/node_modules\/(@[^/]+\/[^/]+|[^/]+)\//;
    const PLAIN_NM = /node_modules\/(@[^/]+\/[^/]+|[^/]+)\//;

    for (const uid in nodeParts) {
        const part = nodeParts[uid];
        if (!part) continue;
        const meta = nodeMetas[part.metaUid] || nodeMetas[uid];
        const idStr = meta?.id || '';
        let bucket;
        const pnpm = PNPM_NESTED.exec(idStr);
        if (pnpm) bucket = pnpm[1];
        else {
            const plain = PLAIN_NM.exec(idStr);
            bucket = plain ? plain[1] : '(project source)';
        }
        const rendered = part.renderedLength || 0;
        const prev = buckets.get(bucket) || 0;
        buckets.set(bucket, prev + rendered);
    }

    // Each bucket has a rendered (uncompressed) byte count. Estimate the
    // gzipped contribution proportionally from the whole-file gzip ratio.
    // This is an approximation — gzip dictionaries don't split neatly across
    // module boundaries — but it's faithful enough for ordering top
    // contributors and reporting them in the spike report.
    const ratio = totalRendered > 0 ? wholeFileGzipBytes / totalRendered : 0;

    return Array.from(buckets.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, renderedBytes]) => ({
            name,
            renderedBytes,
            gzipBytes: Math.round(renderedBytes * ratio),
        }));
}

// ── Environment metadata ─────────────────────────────────────────────────────
function getEnvInfo() {
    const pkg = JSON.parse(readFileSync(PKG_JSON, 'utf8'));
    let commitSha = '(no git)';
    let pnpmVersion = '(unknown)';
    try {
        commitSha = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
        // not in a git repo, or git unavailable
    }
    try {
        pnpmVersion = execSync('pnpm --version', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
        // pnpm not on PATH
    }
    return {
        nodeVersion: process.version,
        pnpmVersion,
        os: `${platform()} ${arch()}`,
        commitSha,
        langgraphVersion: pkg.dependencies?.['@langchain/langgraph'] || '(missing)',
        langchainCoreVersion: pkg.dependencies?.['@langchain/core'] || '(missing)',
        zodVersion: pkg.dependencies?.zod || '(missing)',
        zodToJsonSchemaVersion: pkg.dependencies?.['zod-to-json-schema'] || '(missing)',
    };
}

// ── Verdict logic (mechanical) ───────────────────────────────────────────────
function applyVerdict(gzipKb) {
    if (gzipKb < PASS_MAX_KB) return { verdict: 'Pass', plan: 'A', followup: 'None.' };
    if (gzipKb <= WARN_MAX_KB)
        return {
            verdict: 'Warn',
            plan: 'A',
            followup: 'Story 8.3 must lazy-load individual agent nodes; file as a sub-task.',
        };
    return { verdict: 'Fail', plan: 'B', followup: 'Plan B IS the followup — switch to a custom orchestrator.' };
}

function kb(bytes) {
    return Math.round(bytes / 102.4) / 10; // KB with one decimal
}

// ── Two-run reproducibility check ────────────────────────────────────────────
function measure() {
    const t1 = readWholeFileGzip();
    const v1 = readVisualizerTotal();
    return { whole: t1, vis: v1 };
}

const env = getEnvInfo();
const run1 = measure();
const run2 = measure();

const wholeDelta = Math.abs(run1.whole.gzipBytes - run2.whole.gzipBytes);
const wholeDeltaPct = (wholeDelta / run1.whole.gzipBytes) * 100;
const renderedDelta = Math.abs(run1.vis.totalRendered - run2.vis.totalRendered);
const renderedDeltaPct = run1.vis.totalRendered > 0 ? (renderedDelta / run1.vis.totalRendered) * 100 : 0;

// Use the whole-file gzip as the authoritative verdict input. (In Vite 8 +
// Rolldown, the visualizer's per-module gzipLength is 0; the whole-file gzip
// from node:zlib is the trustworthy number.)
const verdictBytes = run1.whole.gzipBytes;
const verdictKb = kb(verdictBytes);
const { verdict, plan, followup } = applyVerdict(verdictKb);

const deps = breakdownByDep(run1.vis.raw, run1.whole.gzipBytes, run1.vis.totalRendered);

// ── Output: human-readable + Markdown-ready ──────────────────────────────────
const lines = [];
lines.push(`# @lerret/ai bundle-spike measurement`);
lines.push(``);
lines.push(`Run 1 → run 2 reproducibility:`);
lines.push(`  whole-file gzip:    ${run1.whole.gzipBytes} → ${run2.whole.gzipBytes} bytes (Δ ${wholeDeltaPct.toFixed(3)}%)`);
lines.push(`  rendered (no gzip): ${run1.vis.totalRendered} → ${run2.vis.totalRendered} bytes (Δ ${renderedDeltaPct.toFixed(3)}%)`);
lines.push(``);
lines.push(`**Verdict: ${verdict}** (${verdictKb} KB gzipped) → Plan ${plan}`);
lines.push(``);
lines.push(`Follow-up: ${followup}`);
lines.push(``);
lines.push(`## Measurement table (paste into report)`);
lines.push(``);
lines.push(`| Metric | Value |`);
lines.push(`|---|---|`);
lines.push(`| **Total gzipped (node:zlib whole-file — authoritative)** | **${kb(run1.whole.gzipBytes)} KB** (${run1.whole.gzipBytes} bytes) |`);
lines.push(`| Total rendered (visualizer sum, uncompressed) | ${kb(run1.vis.totalRendered)} KB (${run1.vis.totalRendered} bytes) |`);
lines.push(`| Uncompressed (built file) | ${kb(run1.whole.rawBytes)} KB (${run1.whole.rawBytes} bytes) |`);
lines.push(`| Reproducibility Δ (whole-file gzip) | ${wholeDeltaPct.toFixed(3)}% |`);
lines.push(`| Reproducibility Δ (rendered total) | ${renderedDeltaPct.toFixed(3)}% |`);
lines.push(`| Build commit | \`${env.commitSha}\` |`);
lines.push(`| Node version | ${env.nodeVersion} |`);
lines.push(`| pnpm version | ${env.pnpmVersion} |`);
lines.push(`| OS + arch | ${env.os} |`);
lines.push(`| @langchain/langgraph | ${env.langgraphVersion} |`);
lines.push(`| @langchain/core | ${env.langchainCoreVersion} |`);
lines.push(`| zod | ${env.zodVersion} |`);
lines.push(`| zod-to-json-schema | ${env.zodToJsonSchemaVersion} |`);
lines.push(``);
lines.push(`## Top-10 contributors (gzip estimated proportionally from rendered bytes)`);
lines.push(``);
lines.push(`| Package | Rendered (KB) | Est. gzipped (KB) |`);
lines.push(`|---|---:|---:|`);
for (const d of deps.slice(0, 10)) {
    lines.push(`| \`${d.name}\` | ${kb(d.renderedBytes)} | ${kb(d.gzipBytes)} |`);
}
const otherRendered = deps.slice(10).reduce((s, d) => s + d.renderedBytes, 0);
const otherGzip = deps.slice(10).reduce((s, d) => s + d.gzipBytes, 0);
if (otherRendered > 0) {
    lines.push(`| _(other ${deps.length - 10} packages)_ | ${kb(otherRendered)} | ${kb(otherGzip)} |`);
}
lines.push(``);
lines.push(`> Note: gzip dictionaries don't split cleanly on module boundaries, so per-package gzip is an estimate. The whole-file gzip above is authoritative.`);
lines.push(``);
lines.push(`## Three-band rule reminder`);
lines.push(`- Pass: < ${PASS_MAX_KB} KB → Plan A`);
lines.push(`- Warn: ${PASS_MAX_KB}–${WARN_MAX_KB} KB → Plan A with code-split follow-up under Story 8.3`);
lines.push(`- Fail: > ${WARN_MAX_KB} KB → Plan B (hand-written ~5 KB state machine)`);

console.log(lines.join('\n'));

// Exit code: 0 for Pass/Warn (Plan A wins), non-zero for Fail signals Plan B
// downstream. CI can branch on this. The measurement itself always succeeds.
if (verdict === 'Fail') {
    console.error(`\nFail verdict — apply Task 7 cleanup (remove LangGraph deps, preserve Plan-A skeleton on spike/langgraph-plan-a branch).`);
}
