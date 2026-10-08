# Rollback runbook

The last known-good build, preserved three independent ways so it survives
repository cleanup, image pruning, and accidental branch deletion.

## What "last known good" means

| | |
|---|---|
| Cloud Run revision | `fgos-00063-bdf` (2026-09-18) — the build that served production until 2026-10-08 |
| Image digest | `sha256:9aaccba44399654d58aefdf9567100a3a6a4339ffae2d4a95ef1d92b62fd7ccf` |
| Git commit | `1ec5817` ("Revised README for clarity") |
| Git branch | `rollback/live-1ec5817` |
| Git tag | `pre-bridge-live-20261008` |

This is the last revision deployed **before** the FGOS Bridge plugin
(`deacedb`) and the deploy-pipeline changes went live. If you need to return to
exactly this state, use one of the methods below.

---

## The three preserved copies

### 1. Container image, tagged — survives AR garbage collection

```
europe-west1-docker.pkg.dev/gen-lang-client-0697329654/cloud-run-source-deploy/fgos-rollback
```

Tags (all resolve to digest `9aaccba4…`):

- `rollback-last-known-good`
- `commit-1ec5817`
- `revision-fgos-00063-bdf`

> **Why this matters:** every image in `cloud-run-source-deploy/fgos` is an
> **untagged digest**, which Artifact Registry is free to garbage-collect. A
> future cleanup could silently delete the production image. These tags pin it.

### 2. Git branch + tag

`rollback/live-1ec5817` and tag `pre-bridge-live-20261008` both point at
`1ec5817` — the exact source that produced the good image.

### 3. Cloud Run revision (retained, do not purge)

`fgos-00063-bdf` still exists and can be rolled back to directly. Cloud Run keeps
a limited number of revisions; this one is the reference point.

---

## How to roll back

### Option A — serve the old revision (fastest, ~30s, no rebuild)

```bash
gcloud run services update fgos \
  --region=europe-west1 \
  --image=europe-west1-docker.pkg.dev/gen-lang-client-0697329654/cloud-run-source-deploy/fgos-rollback:rollback-last-known-good
```

Verify:

```bash
gcloud run services describe fgos --region=europe-west1 \
  --format="value(status.latestReadyRevisionName)"
curl -s -o /dev/null -w "%{http_code}\n" https://fgos.freshgreenclassics.co.uk
```

### Option B — roll back to the retained revision

```bash
gcloud run services update fgos --region=europe-west1 \
  --image=europe-west1-docker.pkg.dev/gen-lang-client-0697329654/cloud-run-source-deploy/fgos@sha256:9aaccba44399654d58aefdf9567100a3a6a4339ffae2d4a95ef1d92b62fd7ccf
```

### Option C — roll back the code and rebuild

```bash
git checkout rollback/live-1ec5817
git push origin HEAD:main          # only after you decide
npm run build
gcloud builds submit --config=cloudbuild-live.yaml --region=europe-west1 \
  --substitutions=_TAG=$(git rev-parse --short HEAD) .
```

### Option D — split traffic (canary a fix without full rollback)

```bash
gcloud run services update fgos --region=europe-west1 \
  --no-traffic \
  --image=europe-west1-docker.pkg.dev/gen-lang-client-0697329654/cloud-run-source-deploy/fgos:<new-tag>

gcloud run services update fgos --region=europe-west1 \
  --traffic fgos-00064-xmd=90,fgos-00063-bdf=10
```

---

## Data is separate from code

Rolling back the **image** does **not** roll back data. Application state lives
in Cloud Firestore, and is therefore forward-compatible across image rollbacks.

If you need to roll back *data* too, the pre-push snapshot is stored at:

```
gs://ai-studio-bucket-876707527934-europe-west2/fgos-backups/fgos-live-2026-10-08T08-14-18-644Z/
```

with WordPress content JSON in this repo on the `state-backup` branch.

**Restoring Firestore is destructive** — it overwrites current state. Always take
a fresh backup first, and confirm with the owner before restoring.

---

## Current production state (for reference)

| | |
|---|---|
| Live revision | `fgos-00064-xmd` |
| Live digest | `sha256:4cf340f3ace9daf50a2a5052e8e6f6a191b824e96f47f805f4f4a23d54cec848` |
| Live git commit | `195788e` |
| Branch | `main` → `origin/main` |
| Rollback target | `rollback-last-known-good` (`9aaccba4…`) |

The live build contains the FGOS Bridge plugin. The Bridge plugin itself is
**not yet installed on any WordPress site**, so FGOS publishing behaves exactly
as it did before — the Bridge code path is inert until the plugin is installed
and a brand has `wpBridge` enabled.