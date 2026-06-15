#!/usr/bin/env bash
# Roda só a demonstração de rate limit (cenário 05) numa fase.
# Defina PHASE=on (API com throttling) ou PHASE=off (API sem throttling) e
# garanta que o servidor está rodando na config correspondente:
#   ON :  pnpm dev                          (RATE_LIMIT_ENABLED=true, default)
#   OFF:  RATE_LIMIT_ENABLED=false pnpm dev
set -euo pipefail
cd "$(dirname "$0")"

PHASE="${PHASE:-on}"
BASE_URL="${K6_BASE_URL:-http://localhost:3333}"
mkdir -p results

echo "▶ Fase=$PHASE  Alvo=$BASE_URL"
K6_BASE_URL="$BASE_URL" RESULTS_DIR="results" PHASE="$PHASE" \
  K6_SUMMARY_TREND_STATS="avg,min,med,max,p(90),p(95),p(99)" \
  k6 run 05-rate-limit-demo.js
echo "✅ results/05-rate-limit-demo-$PHASE-summary.json"
