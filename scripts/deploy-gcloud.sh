#!/usr/bin/env bash
# Deploy FGOS to Google Cloud Run.
#
# Prerequisites:
#   1. gcloud CLI installed and authenticated (gcloud auth login)
#   2. The Firestore database created (or this script will create it)
#   3. GEMINI_API_KEY available (set as env var or in .env)
#
# Usage:
#   ./scripts/deploy-gcloud.sh
set -euo pipefail

PROJECT_ID="gen-lang-client-0697329654"
REGION="europe-west1"
SERVICE="fgos"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE}"

echo "=== 1. Verify gcloud auth ==="
gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | grep -q . || {
  echo "❌ Not authenticated. Run: gcloud auth login"
  exit 1
}
ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -1)
echo "   Authenticated as: ${ACCOUNT}"

echo ""
echo "=== 2. Set project ==="
gcloud config set project "${PROJECT_ID}"

echo ""
echo "=== 3. Ensure Firestore database exists ==="
# Try to create the (default) Firestore database; ignore "already exists" errors.
if ! gcloud firestore databases list --project="${PROJECT_ID}" 2>/dev/null | grep -q "(default)"; then
  echo "   Creating Firestore database (default)..."
  gcloud firestore databases create --project="${PROJECT_ID}" --location="${REGION}" --type=firestore-native 2>&1 | tail -3 || echo "   (database may already exist)"
else
  echo "   Firestore database already exists."
fi

echo ""
echo "=== 4. Build and push image ==="
gcloud builds submit --config=cloudbuild.yaml --project="${PROJECT_ID}" --region="${REGION}"

echo ""
echo "=== 5. Deploy to Cloud Run ==="
# Read GEMINI_API_KEY from .env if not set in environment
GEMINI_KEY="${GEMINI_API_KEY:-}"
if [ -z "${GEMINI_KEY}" ] && [ -f .env ]; then
  GEMINI_KEY=$(grep -E '^GEMINI_API_KEY=' .env | head -1 | cut -d'=' -f2- | tr -d '"')
fi

ENV_ARGS="NODE_ENV=production"
if [ -n "${GEMINI_KEY}" ]; then
  ENV_ARGS="${ENV_ARGS},GEMINI_API_KEY=${GEMINI_KEY}"
fi

gcloud run deploy "${SERVICE}" \
  --image="${IMAGE}" \
  --platform=managed \
  --region="${REGION}" \
  --allow-unauthenticated \
  --set-env-vars="${ENV_ARGS}" \
  --memory=512Mi \
  --cpu=1

echo ""
echo "=== 6. Get service URL ==="
URL=$(gcloud run services describe "${SERVICE}" --region="${REGION}" --format="value(status.url)")
echo "   Service URL: ${URL}"

echo ""
echo "✅ Deployment complete!"
echo "   Service URL: ${URL}"
echo ""
echo "Next: point fgos.freshgreenclassics.co.uk to this URL via DNS"
echo "  (CNAME record: fgos -> ${URL#https://})"
