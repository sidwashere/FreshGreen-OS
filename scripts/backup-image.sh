#!/usr/bin/env bash
# backup-image.sh — export a Cloud Run image to a standalone, restorable tarball
# in Google Cloud Storage, then verify it by round-trip.
#
# Why this exists
#   Images in Artifact Registry that carry only an untagged digest can be
#   garbage-collected. This produces a plain .tar in GCS that survives AR, and
#   verifies it by downloading it back and comparing checksums.
#
# Why crane
#   Cloud Build's service account can read Artifact Registry but cannot write to
#   GCS, so an export run inside Cloud Build fails at the upload step. crane is
#   daemonless (no Docker required) and runs locally under your gcloud
#   credentials, which do have GCS write access.
#
# Usage
#   scripts/backup-image.sh <image-ref> <gs-destination.tar> [--verify]
#
# Examples
#   scripts/backup-image.sh \
#     europe-west1-docker.pkg.dev/PROJECT/cloud-run-source-deploy/fgos-rollback@sha256:DIGEST \
#     gs://BUCKET/fgos-backups/images/fgos.tar --verify

set -euo pipefail

IMAGE_REF="${1:-}"
DEST="${2:-}"
VERIFY="${3:-}"

if [[ -z "$IMAGE_REF" || -z "$DEST" ]]; then
  echo "usage: $0 <image-ref> <gs-dest.tar> [--verify]" >&2
  exit 1
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
LOCAL_TAR="$WORKDIR/image.tar"

# The registry host must match the image ref so crane authenticates correctly.
REGISTRY="$(echo "$IMAGE_REF" | cut -d/ -f1)"
BASENAME="$(echo "$IMAGE_REF" | sed 's#.*/##; s#[:@].*##')"

command -v crane >/dev/null || { echo "crane is required: brew install crane" >&2; exit 1; }
command -v gcloud >/dev/null || { echo "gcloud is required" >&2; exit 1; }

echo "==> Authenticating crane to $REGISTRY"
gcloud auth print-access-token \
  | crane auth login "$REGISTRY" --username oauth2accesstoken --password-stdin >/dev/null

echo "==> Verifying image is readable"
crane manifest "$IMAGE_REF" >/dev/null

echo "==> Pulling image to $LOCAL_TAR"
crane pull "$IMAGE_REF" "$LOCAL_TAR" --platform linux/amd64
LOCAL_MD5="$(md5 -q "$LOCAL_TAR")"
echo "    size: $(du -h "$LOCAL_TAR" | cut -f1)  md5: $LOCAL_MD5"

echo "==> Uploading to $DEST"
gcloud storage cp "$LOCAL_TAR" "$DEST" >/dev/null
echo "    ok"

if [[ "$VERIFY" == "--verify" ]]; then
  echo "==> Verify: downloading back"
  RESTORED="$WORKDIR/restored.tar"
  gcloud storage cp "$DEST" "$RESTORED" >/dev/null
  RESTORED_MD5="$(md5 -q "$RESTORED")"
  if [[ "$LOCAL_MD5" == "$RESTORED_MD5" ]]; then
    echo "✅ VERIFIED — round-trip byte-identical ($RESTORED_MD5)"
  else
    echo "❌ CORRUPTED — local $LOCAL_MD5 vs restored $RESTORED_MD5" >&2
    exit 1
  fi
fi

echo
echo "Backup: $DEST"
echo "Restore:"
echo "  gcloud storage cp $DEST ./$BASENAME.tar"
echo "  crane push $BASENAME.tar <registry>/<repo>:<tag>     # republish"
echo "  gcloud run deploy fgos --image=<registry>/<repo>:<tag>"