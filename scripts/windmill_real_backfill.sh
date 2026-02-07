#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
FROM="${FROM:-}"
TO="${TO:-}"
QUERY="${QUERY:-}"
OFFSET="${OFFSET:-0}"
BATCH_SIZE="${BATCH_SIZE:-100}"
PERSIST="${PERSIST:-true}"

payload="$(python3 - <<'PY'
import json
import os

payload = {
    "offset": int(os.environ.get("OFFSET", "0")),
    "batchSize": int(os.environ.get("BATCH_SIZE", "100")),
    "persist": os.environ.get("PERSIST", "true").lower() == "true",
}
if os.environ.get("FROM"):
    payload["from"] = os.environ["FROM"]
if os.environ.get("TO"):
    payload["to"] = os.environ["TO"]
if os.environ.get("QUERY"):
    payload["query"] = os.environ["QUERY"]
print(json.dumps(payload))
PY
)"

curl -sS -X POST "${API_BASE_URL}/api/backfill/real" -H "content-type: application/json" -d "${payload}"
