#!/usr/bin/env bash
# Mirror + verify the Null Registry checkpoint chain.
#
# Clone (or update) a full copy of the registry and independently verify every
# signed checkpoint: signatures, the prev_checkpoint hash chain, and — the point
# of the exercise — that each root really is the Merkle root over the registry as
# it stood at that checkpoint's commit. Exit non-zero on any failure; wire that
# into your alerting (mail, PagerDuty, a failing cron job).
#
#   registry/scripts/mirror-verify.sh [REPO_URL] [TARGET_DIR]
#
# Cron example (verify every hour, mail on failure):
#   0 * * * * /path/to/mirror-verify.sh >>/var/log/nr-mirror.log 2>&1 \
#             || echo "Null Registry checkpoint verification FAILED" | mail -s alert you@example.org
set -euo pipefail

REPO_URL="${1:-https://github.com/therealcodyinman/nullregistry.git}"
TARGET_DIR="${2:-nullregistry-mirror}"

if [ ! -d "$TARGET_DIR/.git" ]; then
  echo "Cloning $REPO_URL -> $TARGET_DIR (full history)"
  git clone "$REPO_URL" "$TARGET_DIR"
fi

cd "$TARGET_DIR"
echo "Fetching latest main..."
git fetch --prune origin
# Fast-forward only: a mirror should never diverge. A non-ff means tampering or a
# force-push upstream — fail loudly rather than paper over it.
git checkout -q main
git merge --ff-only origin/main

echo "Verifying checkpoint chain..."
node registry/scripts/verify-checkpoint.js
echo "Mirror verification passed for $REPO_URL"
