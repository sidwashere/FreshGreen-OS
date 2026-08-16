#!/usr/bin/env bash
# FreshGreenOps local emulators (Firestore + Auth).
# - Firestore emulator runs in-memory only (firebase-tools has no disk
#   persistence for it): it OOM'd after ~22h in Aug 2026 and lost the working
#   DB. Give the JVM a big heap, and snapshot data with:
#     firebase emulators:export /path/to/backup --project gen-lang-client-0697329654
#   Restore with:  firebase emulators:start ... --import /path/to/backup
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_TOOL_OPTIONS="-Xmx8g"
exec nohup "$HOME/.npm-global/bin/firebase" emulators:start \
  --only auth,firestore \
  --project gen-lang-client-0697329654 \
  > /tmp/fg-emulators.log 2>&1 &
echo "emulators starting (log: /tmp/fg-emulators.log, java heap 8g)"
