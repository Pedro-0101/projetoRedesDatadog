# Expansão do Demo Datadog — Índice dos Planos de Implementação

Spec de origem: [`docs/superpowers/specs/2026-06-15-datadog-demo-expansion-design.md`](../specs/2026-06-15-datadog-demo-expansion-design.md)

Este plano foi dividido em arquivos por etapa (cada um executável isoladamente). Use
**superpowers:subagent-driven-development** (recomendado) ou **superpowers:executing-plans**
para executar cada arquivo tarefa a tarefa.

## Arquivos

| Etapa | Plano | Produz |
|---|---|---|
| 0 | [`2026-06-15-stage-0-foundation.md`](2026-06-15-stage-0-foundation.md) | flags de produto Datadog + tooling de teste |
| 1 | [`2026-06-15-stage-1-postgres-dbm.md`](2026-06-15-stage-1-postgres-dbm.md) | PostgreSQL + DBM + persistência de vendas |
| 2 | [`2026-06-15-stage-2-scenarios-profiler.md`](2026-06-15-stage-2-scenarios-profiler.md) | 5 cenários novos + Continuous Profiler + `/reset` |
| 3 | [`2026-06-15-stage-3-attacks-asm.md`](2026-06-15-stage-3-attacks-asm.md) | endpoints vulneráveis + 4 ataques + ASM |
| 4 | [`2026-06-15-stage-4-ui-redesign.md`](2026-06-15-stage-4-ui-redesign.md) | UI em abas + roteiro + topologia |
| 5 | [`2026-06-15-stage-5-dashboards-slos.md`](2026-06-15-stage-5-dashboards-slos.md) | dashboards, SLOs, monitors, runbook |

## Ordem de execução

```
Etapa 0 (fundação)
   ├─► Etapa 1 (Postgres + DBM)      ┐
   ├─► Etapa 2 (cenários + Profiler) ├─ podem rodar em paralelo após a 0
   └─► Etapa 3 (ataques + ASM)       ┘
            └─► Etapa 4 (UI) ──► Etapa 5 (dashboards/SLOs/runbook)
```

## Convenções comuns a todos os planos

- **Diretório raiz:** `C:\Users\User\Documents\Projetos\projetoRedesDatadog`
- **Branch:** trabalhar fora de `main`/`master` se for abrir PR; commits frequentes.
- **API:** Node 20 + Express + TypeScript, build via `tsc` (`api/`). Testes com **vitest**
  (adicionado na Etapa 0). Comando de teste: `npm test` dentro de `api/`.
- **Worker:** Go 1.22 (`worker/`). Testes nativos: `go test ./...` dentro de `worker/`.
- **Subir o ambiente:** `docker compose up --build` na raiz.
- **`.env`** (não versionado) na raiz com `DD_API_KEY`, `DD_APP_KEY`, `DD_SITE=us5.datadoghq.com`.
