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

for m in error-rate latency security \
         sdn-worker-degraded route-flapping all-workers-blocked \
         qos-bronze-starvation shaping-exhausted; do
  echo "==> Criando monitor ${m}..."
  curl -sS -X POST "${BASE}/api/v1/monitor" "${hdr[@]}" -d @datadog/monitor-${m}.json \
    -o /dev/null -w "    HTTP %{http_code}\n"
done

for s in availability routing; do
  echo "==> Criando SLO ${s}..."
  curl -sS -X POST "${BASE}/api/v1/slo" "${hdr[@]}" -d @datadog/slo-${s}.json \
    -o /dev/null -w "    HTTP %{http_code}\n"
done

echo "==> Concluido. Copie a Dashboard URL acima para DD_DASHBOARD_URL no .env."
