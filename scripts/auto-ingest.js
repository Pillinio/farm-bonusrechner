#!/usr/bin/env node
/**
 * auto-ingest.js — Orchestrator for automatic PDF ingestion.
 *
 * Walks Data_Input/ (post GDrive sync), routes each new file to the right
 * parser based on its subdirectory, POSTs the parsed JSON to the `ingest`
 * Edge Function, and records the outcome in the `data_imports` table.
 *
 * Deduplication: SHA-256 of file content — if the hash exists in
 * data_imports.file_hash, the file is skipped.
 *
 * Env:
 *   SUPABASE_URL           (default: project URL)
 *   SUPABASE_SERVICE_KEY   (required — service_role key, used for auth +
 *                          for direct inserts into data_imports)
 *   DATA_INPUT_DIR         (default: <repo>/Data_Input)
 *
 * Usage:
 *   node scripts/auto-ingest.js            # ingest all new files
 *   node scripts/auto-ingest.js --dry-run  # list what would be done, don't ingest
 *   node scripts/auto-ingest.js --verbose  # more logs
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// ── Config ───────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vhwlcnfxslkftswksqrw.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const DATA_DIR = process.env.DATA_INPUT_DIR || path.resolve(__dirname, '..', 'Data_Input');

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

const SCRIPT_DIR = __dirname;

// Subdirectory → handler config
const ROUTES = [
  { dir: 'LPO-Weekly',            parser: 'parse-lpo.js',    kind: 'market-prices-lpo',      sourceType: 'lpo' },
  { dir: 'Meatco-Slaughter',      parser: 'parse-meatco.js', kind: 'slaughter-report-meatco', sourceType: 'meatco' },
  { dir: 'Slaughterhouses-Other', parser: null,              kind: null,                      sourceType: 'slaughter_other' }, // no parser yet → pending_review
  { dir: 'Bank-Nedbank',          parser: null,              kind: null,                      sourceType: 'bank_nedbank' },
  { dir: 'Bank-Pointbreak',       parser: null,              kind: null,                      sourceType: 'bank_pointbreak' },
  { dir: 'Accounting',            parser: null,              kind: null,                      sourceType: 'accounting' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function log(level, ...args) {
  const line = `[${new Date().toISOString()}] [${level}] ${args.join(' ')}`;
  if (level === 'ERROR') console.error(line);
  else if (level === 'DEBUG' && !VERBOSE) return;
  else console.log(line);
}

function sha256Sync(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

async function fetchWithRetry(url, options, label) {
  const attempts = 3;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        const delay = (i + 1) * 1500;
        log('DEBUG', `${label} transient error, retrying in ${delay}ms: ${err.message}`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw new Error(`${label}: fetch failed after ${attempts} attempts: ${lastErr.message}`);
}

async function supabaseQuery(table, query = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
  const res = await fetchWithRetry(url, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  }, `select ${table}`);
  if (!res.ok) throw new Error(`supabase select ${table} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supabaseInsert(table, row) {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  }, `insert ${table}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase insert ${table} failed: ${res.status} ${text}`);
  return JSON.parse(text);
}

async function callIngest(kind, sourceFile, payloadData) {
  const url = `${SUPABASE_URL}/functions/v1/ingest`;
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ kind, source: sourceFile, data: payloadData }),
  }, `ingest ${kind}`);
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { error: text }; }
  if (!res.ok) {
    throw new Error(`ingest ${kind} failed: ${res.status} ${parsed.error || text}`);
  }
  return parsed;
}

function runParser(parser, pdfPath) {
  const scriptPath = path.join(SCRIPT_DIR, parser);
  const out = execFileSync('node', [scriptPath, '--json', pdfPath], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return JSON.parse(out);
}

// ── Core ─────────────────────────────────────────────────────────────────────
async function processFile(route, absPath) {
  const filename = path.basename(absPath);
  const stat = fs.statSync(absPath);
  const fileHash = sha256Sync(absPath);

  // Dedup check — rolled-back imports don't block a re-import of the same file
  const existing = await supabaseQuery(
    'data_imports',
    `?file_hash=eq.${fileHash}&status=neq.rolled_back&select=id,status&limit=1`
  );
  if (existing.length > 0) {
    log('DEBUG', `skip (already imported): ${filename}`);
    return { skipped: true };
  }

  // No parser → write pending_review row, keep file for later
  if (!route.parser) {
    log('INFO', `no parser yet for ${route.sourceType}: ${filename} → pending_review`);
    if (!DRY_RUN) {
      await supabaseInsert('data_imports', {
        source_type: route.sourceType,
        file_name: filename,
        file_path: absPath.replace(DATA_DIR + '/', ''),
        file_size_bytes: stat.size,
        file_hash: fileHash,
        records_count: 0,
        status: 'pending_review',
        triggered_by: 'auto',
        notes: 'No parser configured for this source type yet',
      });
    }
    return { pending: true };
  }

  log('INFO', `parsing ${filename} with ${route.parser}`);

  let parsedJson;
  try {
    parsedJson = runParser(route.parser, absPath);
  } catch (err) {
    log('ERROR', `parser failed for ${filename}:`, err.message.split('\n')[0]);
    if (!DRY_RUN) {
      await supabaseInsert('data_imports', {
        source_type: route.sourceType,
        file_name: filename,
        file_path: absPath.replace(DATA_DIR + '/', ''),
        file_size_bytes: stat.size,
        file_hash: fileHash,
        records_count: 0,
        status: 'failed',
        error_message: err.message.slice(0, 500),
        triggered_by: 'auto',
      });
    }
    return { failed: true, error: err.message };
  }

  if (DRY_RUN) {
    log('INFO', `[dry-run] would ingest ${filename} (${route.kind})`);
    return { dryRun: true };
  }

  // Ingest
  let ingestResp;
  try {
    ingestResp = await callIngest(route.kind, filename, parsedJson);
  } catch (err) {
    log('ERROR', `ingest failed for ${filename}:`, err.message.split('\n')[0]);
    await supabaseInsert('data_imports', {
      source_type: route.sourceType,
      file_name: filename,
      file_path: absPath.replace(DATA_DIR + '/', ''),
      file_size_bytes: stat.size,
      file_hash: fileHash,
      records_count: 0,
      status: 'failed',
      error_message: err.message.slice(0, 500),
      triggered_by: 'auto',
    });
    return { failed: true, error: err.message };
  }

  // Edge Function sagt "duplicate" via raw_events-Hash — kein neuer data_imports-Eintrag
  if (ingestResp.status === 'duplicate') {
    log('INFO', `↺ ${filename}: duplicate (raw_events hash match, keine neue DB-Schreibung)`);
    return { skipped: true };
  }

  const records = ingestResp.records_inserted || 0;
  const rawEventId = ingestResp.raw_event_id || null;

  log('INFO', `✓ ${filename}: success (${records} records)`);

  await supabaseInsert('data_imports', {
    source_type: route.sourceType,
    file_name: filename,
    file_path: absPath.replace(DATA_DIR + '/', ''),
    file_size_bytes: stat.size,
    file_hash: fileHash,
    records_count: records,
    status: 'success',
    triggered_by: 'auto',
    raw_event_id: rawEventId,
    period_start: parsedJson.price_date || parsedJson.report_date || null,
    period_end:   parsedJson.price_date || parsedJson.report_date || null,
  });

  return { success: true, records };
}

async function main() {
  if (!SUPABASE_SERVICE_KEY) {
    log('ERROR', 'SUPABASE_SERVICE_KEY env var is required');
    process.exit(1);
  }

  log('INFO', `Scanning ${DATA_DIR}${DRY_RUN ? ' (dry-run)' : ''}`);

  const stats = { scanned: 0, skipped: 0, success: 0, failed: 0, pending: 0 };

  for (const route of ROUTES) {
    const subDir = path.join(DATA_DIR, route.dir);
    if (!fs.existsSync(subDir)) {
      log('DEBUG', `subdir missing: ${route.dir}`);
      continue;
    }

    const entries = fs.readdirSync(subDir).filter(f => f.toLowerCase().endsWith('.pdf'));
    if (entries.length === 0) continue;

    log('INFO', `→ ${route.dir}: ${entries.length} file(s)`);

    for (const entry of entries) {
      const absPath = path.join(subDir, entry);
      stats.scanned++;
      try {
        const r = await processFile(route, absPath);
        if (r.skipped) stats.skipped++;
        else if (r.pending) stats.pending++;
        else if (r.failed) stats.failed++;
        else if (r.success) stats.success++;
      } catch (err) {
        log('ERROR', `unexpected error on ${entry}:`, err.message);
        stats.failed++;
      }
    }
  }

  log('INFO', `Done: ${stats.success} ok, ${stats.skipped} skipped, ${stats.pending} pending-review, ${stats.failed} failed (scanned: ${stats.scanned})`);

  if (stats.failed > 0) process.exit(2);
}

main().catch(err => {
  log('ERROR', 'fatal:', err.stack || err.message);
  process.exit(1);
});
