#!/usr/bin/env bash
# OGM Gönüllü API — Swagger / OpenAPI otomatik güncelleyici hook.
#
# settings.local.json içindeki PostToolUse hook'undan çağrılır.
# Edit / Write tool'u çalıştığında, eğer dokunulan dosya bir
# *.routes.js, *.controller.js, *.docs.js veya swagger.js ise
# `docs/openapi.json` dosyasını yeniden üretir.
#
# Hook stdin'inden Claude'un gönderdiği JSON payload'ı okur:
#   { "tool_name": "Edit"|"Write", "tool_input": { "file_path": "..." } }
#
# Sessiz çalışır; sadece path eşleşince çıktı verir.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

payload="$(cat)"
file_path="$(printf '%s' "$payload" | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin); ti=d.get("tool_input") or {}; print(ti.get("file_path") or "")
except Exception:
  print("")' 2>/dev/null)"

case "$file_path" in
  *.routes.js|*.controller.js|*.docs.js|*/config/swagger.js)
    cd "$PROJECT_ROOT"
    if [ -f scripts/export-openapi.js ] && [ -d node_modules/swagger-jsdoc ]; then
      LOG_DIR=./logs UPLOAD_DIR=./uploads NODE_ENV=test \
        node scripts/export-openapi.js 2>&1 | sed 's/^/[swagger-autoupdate] /'
    fi
    ;;
  *)
    : # nothing to do
    ;;
esac
