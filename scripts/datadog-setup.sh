#!/usr/bin/env bash
set -euo pipefail

: "${DD_API_KEY:?defina DD_API_KEY (export ou .env)}"
: "${DD_APP_KEY:?defina DD_APP_KEY (export ou .env)}"
SITE="${DD_SITE:-us5.datadoghq.com}"
BASE="https://api.${SITE}"
hdr=(-H "DD-API-KEY: ${DD_API_KEY}" -H "DD-APPLICATION-KEY: ${DD_APP_KEY}" -H "Content-Type: application/json")

echo "==> Criando dashboard..."
curl -sS -X POST "${BASE}/api/v1/dashboard" "${hdr[@]}" -d @datadog/dashboard.json \
  | sed -n 's/.*"url":"\([^"]*\)".*/    Dashboard URL: https:\/\/'"${SITE}"'\1/p'

for m in error-rate latency security; do
  echo "==> Criando monitor ${m}..."
  curl -sS -X POST "${BASE}/api/v1/monitor" "${hdr[@]}" -d @datadog/monitor-${m}.json \
    -o /dev/null -w "    HTTP %{http_code}\n"
done

echo "==> Criando SLO de disponibilidade..."
curl -sS -X POST "${BASE}/api/v1/slo" "${hdr[@]}" -d @datadog/slo-availability.json \
  -o /dev/null -w "    HTTP %{http_code}\n"

echo "==> Concluido. Copie a Dashboard URL acima para DD_DASHBOARD_URL no .env."
