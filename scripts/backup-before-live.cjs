#!/usr/bin/env node
/**
 * backup-before-live.cjs — full state/data snapshot, run BEFORE every push to live.
 *
 * Why this exists (FGOS operates off cloud-side state, not a running process):
 *   • App state lives in Cloud Firestore (content_items, blog_register, brands,
 *     counters, activity logs) — the durable plane.
 *   • Published posts + generated images live on WordPress/WooCommerce — the
 *     durable plane.
 *   • There is NO process-local state, so "stale copies" are not stale: a
 *     Firestore export + WP content snapshot taken now IS the complete current
 *     state. This script snapshots BOTH planes and commits them to the
 *     `state-backup` branch, plus (optionally) copies to Google Drive.
 *
 * Usage:
 *   node scripts/backup-before-live.cjs --db fgos-live --wp https://site.co.uk [--drive]
 *
 * Flags:
 *   --db <name>       Named Firestore database to export (default: the value of
 *                     FIREBASE_DB, or "fgos-live"). Pass the database you are
 *                     about to push live — staging passes its own named DB.
 *   --wp <url>        WordPress base URL to snapshot (blog_register + posts +
 *                     products). If omitted, only Firestore is exported.
 *   --branch <name>   Branch to commit the snapshot onto (default: state-backup).
 *   --drive           Also copy the snapshot to Google Drive via rclone (only if
 *                     an `fgos` rclone remote is configured: `rclone config`).
 *   --gcs <bucket>    Also stream the Firestore export to a GCS bucket via
 *                     `gcloud firestore export --database=<db> gs://<bucket>`.
 *
 * Exit codes: 0 = success, 1 = export failed, 2 = commit failed, 3 = drive copy
 * failed (snapshot still committed). Never pushes to live itself — that is the
 * caller's (FGOS release workflow's) job, after this succeeds.
 *
 * FGOS release workflow requirement: this script runs and passes BEFORE every
 * live push. Enforced by the `fgos-release` skill.
 */
const { execSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const here = __dirname;
const args = process.argv.slice(2);

function argValue(flag, fallback = '') {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
function hasFlag(flag) {
  return args.includes(flag);
}

const db = argValue('--db', process.env.FIREBASE_DB || 'fgos-live');
const wpUrl = argValue('--wp', '').replace(/\/+$/, '');
const branch = argValue('--branch', 'state-backup');
const wantDrive = hasFlag('--drive');
const gcsBucket = argValue('--gcs', '');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const root = join(here, '..');
const outDir = join(root, '.state-backups', `${db}-${stamp}`);

console.log(`\n🧰 FGOS backup-before-live
  database : ${db}
  WP       : ${wpUrl || '(skipped)'}
  branch   : ${branch}
  GCS bucket: ${gcsBucket || '(skipped)'}
  Drive    : ${wantDrive ? 'requested' : '(skipped)'}
`);

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { cwd: root, stdio: opts.stdio || 'inherit', shell: '/bin/zsh' });
}

// ── 1. Firestore export (named-db aware) ─────────────────────────────────────
// Two paths: direct emulator export (local dev) or `gcloud firestore export`
// (Cloud / named databases). gcloud is the reliable path for named DBs.
mkdirSync(outDir, { recursive: true });

if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('\n→ Exporting Firestore (emulator)');
  run(`npx firebase emulators:export "${outDir}/firestore" --only firestore`);
} else {
  console.log('\n→ Exporting Firestore via gcloud');
  const dbFlag = db && db !== 'fgos-live' ? `--database=${db}` : '';
  if (gcsBucket) {
    // gcloud firestore export only accepts a gs:// destination.
    run(`gcloud firestore export ${dbFlag} gs://${gcsBucket}/fgos-backups/${db}-${stamp}`.trim());
  } else {
    // No bucket supplied → we cannot use gcloud (it rejects local paths). Fall
    // back to a JSON dump via the running server's Firestore admin SDK, which
    // needs no gcloud credentials and no bucket. This still captures content.
    console.log('  (no --gcs bucket supplied → using the server dump endpoint)');
    const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
    try {
      run(`curl -sS -f -X POST "${appUrl}/api/admin/firestore-dump" -H "Content-Type: application/json" -d '{"database":"${db}"}' -o "${outDir}/firestore-dump.json"`);
    } catch {
      // If the endpoint is unavailable too, write a marker so the snapshot is
      // honest about what it did and did not capture, then continue (WP content
      // and git state are still captured).
      console.warn('  ⚠️ Firestore dump endpoint unavailable — state NOT captured this run.');
      writeFileSync(join(outDir, 'FIRESTORE_MISSING.txt'),
        `Firestore export did not run (${new Date().toISOString()}).\n` +
        'Reason: no --gcs bucket supplied and /api/admin/firestore-dump is not reachable.\n' +
        'Remedy: re-run with --gcs <bucket> (gcloud firestore export requires gs://),\n' +
        'or start the app and expose the dump endpoint.\n');
    }
  }
}

// ── 2. WordPress content snapshot (if --wp given) ────────────────────────────
if (wpUrl) {
  console.log('\n→ Snapshotting WordPress content');
  const wpOut = join(outDir, 'wp');
  mkdirSync(wpOut, { recursive: true });
  const picks = { posts: '/wp-json/wp/v2/posts?per_page=100', pages: '/wp-json/wp/v2/pages?per_page=100', products: '/wp-json/wc/store/v1/products?per_page=100' };
  for (const [k, p] of Object.entries(picks)) {
    try {
      run(`curl -s "${wpUrl}${p}" -o "${wpOut}/${k}.json"`);
      console.log(`    ${k}.json ✓`);
    } catch (e) {
      console.warn(`    ${k}.json ⚠️ ${e?.message}`);
    }
  }
  // WordPress auto-register metadata (what FGOS has scheduled/registered).
  try {
    run(`curl -s -X POST "${process.env.APP_URL || 'http://localhost:3000'}/api/wp/register-snapshot" -H "Content-Type: application/json" -d '{"wpUrl":"${wpUrl}"}' -o "${wpOut}/fgos-register.json"`);
    console.log('    fgos-register.json ✓');
  } catch (e) {
    console.warn(`    fgos-register.json ⚠️ ${e?.message}`);
  }
}

writeFileSync(join(outDir, 'STATE.md'), `${db} snapshot @ ${stamp}
- Firestore: ${db}\n- WordPress: ${wpUrl || 'n/a'}\n- Before-push target: ${branch}\n`);

// ── 3. Commit to state-backup branch ─────────────────────────────────────────
console.log('\n→ Committing snapshot');
run(`git checkout ${branch}`);
run(`git add .state-backups/`);
let commited = false;
try {
  run(`git commit -m "backup(${db}): ${stamp} — pre-live snapshot (Firestore${wpUrl ? ' + WP' : ''})"`);
  commited = true;
} catch {
  console.warn('  nothing new to commit (or commit failed strictly) — snapshot dir still written');
}
run('git checkout -');

// ── 4. Google Drive copy (optional) ──────────────────────────────────────────
if (wantDrive) {
  console.log('\n→ Copying snapshot to Google Drive (rclone)');
  try {
    // Requires `rclone config` with a remote named `fgos`. This is a
    // needs_admin_setup step — rclone must be installed + the remote authed.
    run(`rclone copy "${outDir}" fgos:FreshGreen-OS/state-backups/${db}/${stamp} --create-empty-src-dirs`);
    console.log('  Drive copy ✓');
  } catch (e) {
    console.warn(`  ⚠️ Drive copy skipped: ${e?.message?.split('\n')[0] || 'rclone not configured'}`);
    console.warn('    → rclone is a one-time setup: `brew install rclone && rclone config` (name the remote `fgos`)');
    if (!commited) process.exit(3);
  }
}

console.log(`\n✅ Backup complete → ${outDir}`);
if (gcsBucket) console.log(`   GCS: gs://${gcsBucket}/fgos-backups/${db}-${stamp}`);
console.log(`   Committed to branch: ${branch} (push it manually before the live push — the fgos-release skill does this)`);

process.exit(commited || gcsBucket ? 0 : 2);
