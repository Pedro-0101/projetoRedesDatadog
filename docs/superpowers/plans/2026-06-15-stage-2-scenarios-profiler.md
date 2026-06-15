# Etapa 2 — Novos cenários de performance + Continuous Profiler — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar 5 cenários (`memory-leak`, `cpu-spike`, `degradacao-gradual`, `timeout-cascata`, `cold-start`), habilitar o Continuous Profiler + runtime metrics no worker, e um endpoint `/reset` para repetibilidade ao vivo.

**Architecture:** O worker Go ganha comportamentos controlados por headers (`X-Cpu-Burn-Ms`, `X-Mem-Leak-KB`, `X-Degrade`) e estado global resetável (memory leak, contador de degradação, cold-start). A API ganha um campo `behavior` nos cenários e mapeia cada um para headers/timeout; o `testRunner` chama `/reset` no início de cada batch.

**Tech Stack:** Go (testing nativo, dd-trace-go profiler), TypeScript/vitest, axios.

**Pré-requisito:** Etapa 0 concluída.

---

### Task 1: Helpers de simulação do worker (TDD)

**Files:**
- Modify: `worker/main.go` (imports + bloco de helpers)
- Test: `worker/main_test.go`

- [ ] **Step 1: Escrever os testes (falham na compilação — funções não existem)**

Create `worker/main_test.go`:
```go
package main

import (
	"testing"
	"time"
)

func TestDegradationDelayFor(t *testing.T) {
	if got := degradationDelayFor(0); got != 0 {
		t.Errorf("count 0: esperado 0, obtido %v", got)
	}
	if got := degradationDelayFor(50); got != 500*time.Millisecond {
		t.Errorf("count 50: esperado 500ms, obtido %v", got)
	}
	if got := degradationDelayFor(1000); got != 5*time.Second {
		t.Errorf("count 1000 (cap): esperado 5s, obtido %v", got)
	}
}

func TestColdDelayFor(t *testing.T) {
	if got := coldDelayFor(0); got != 0 {
		t.Errorf("remaining 0: esperado 0, obtido %v", got)
	}
	if got := coldDelayFor(5); got != 1500*time.Millisecond {
		t.Errorf("remaining 5: esperado 1500ms, obtido %v", got)
	}
}

func TestTakeColdDecrements(t *testing.T) {
	resetState()
	coldRemaining = 2
	if takeCold() == 0 {
		t.Error("1ª requisição deveria ser fria")
	}
	if takeCold() == 0 {
		t.Error("2ª requisição deveria ser fria")
	}
	if takeCold() != 0 {
		t.Error("3ª requisição deveria ser quente")
	}
}

func TestBurnCPURunsAtLeastDuration(t *testing.T) {
	start := time.Now()
	burnCPU(30 * time.Millisecond)
	if time.Since(start) < 30*time.Millisecond {
		t.Error("burnCPU retornou cedo demais")
	}
}
```

- [ ] **Step 2: Rodar e confirmar a falha de compilação**

Run (em `worker/`):
```bash
go test ./...
```
Expected: FAIL — `undefined: degradationDelayFor` (e demais).

- [ ] **Step 3: Atualizar os imports do `main.go`**

Em `worker/main.go`, substituir o bloco de import por:
```go
import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	httptrace "gopkg.in/DataDog/dd-trace-go.v1/contrib/net/http"
	"gopkg.in/DataDog/dd-trace-go.v1/ddtrace/ext"
	"gopkg.in/DataDog/dd-trace-go.v1/ddtrace/tracer"
)
```

- [ ] **Step 4: Adicionar o bloco de estado e helpers**

Em `worker/main.go`, logo após a função `logJSON` (antes de `parseFloatHeader`), inserir:
```go
// --- estado global de simulação (resetável via /reset) ---
var (
	leaked        [][]byte
	leakMu        sync.Mutex
	degradeCount  int64
	coldRemaining int64
)

func degradationDelayFor(count int64) time.Duration {
	d := time.Duration(count*10) * time.Millisecond
	if d > 5*time.Second {
		return 5 * time.Second
	}
	return d
}

func coldDelayFor(remaining int64) time.Duration {
	if remaining <= 0 {
		return 0
	}
	return 1500 * time.Millisecond
}

func burnCPU(d time.Duration) {
	deadline := time.Now().Add(d)
	x := 0
	for time.Now().Before(deadline) {
		x++
		_ = x * x
	}
}

func applyMemoryLeak(kb int) {
	leakMu.Lock()
	leaked = append(leaked, make([]byte, kb*1024))
	leakMu.Unlock()
}

func resetState() {
	leakMu.Lock()
	leaked = nil
	leakMu.Unlock()
	atomic.StoreInt64(&degradeCount, 0)
	atomic.StoreInt64(&coldRemaining, 0)
}

// takeCold decrementa coldRemaining (se > 0) e retorna o delay "frio".
func takeCold() time.Duration {
	for {
		cur := atomic.LoadInt64(&coldRemaining)
		if cur <= 0 {
			return 0
		}
		if atomic.CompareAndSwapInt64(&coldRemaining, cur, cur-1) {
			return coldDelayFor(cur)
		}
	}
}
```

- [ ] **Step 5: Rodar e confirmar verde**

Run (em `worker/`):
```bash
go test ./...
```
Expected: PASS — 4 testes.

- [ ] **Step 6: Commit**

```bash
git add worker/main.go worker/main_test.go
git commit -m "feat(worker): add resettable simulation helpers (leak, cpu, degrade, cold)"
```

---

### Task 2: Wiring do handler, `/reset`, Profiler e runtime metrics

**Files:**
- Modify: `worker/main.go` (handler, main, novo import profiler)
- Modify: `worker/go.mod`, `worker/go.sum` (via `go mod tidy`)

- [ ] **Step 1: Aplicar os comportamentos no `processarHandler`**

Em `worker/main.go`, localizar:
```go
	delay := time.Duration(minDelay+rand.Intn(delayRange)) * time.Millisecond
	time.Sleep(delay)
```
Substituir por:
```go
	delay := time.Duration(minDelay+rand.Intn(delayRange)) * time.Millisecond

	if cpuMs := parseIntHeader(r, "X-Cpu-Burn-Ms", 0); cpuMs > 0 {
		burnCPU(time.Duration(cpuMs) * time.Millisecond)
	}
	if leakKB := parseIntHeader(r, "X-Mem-Leak-KB", 0); leakKB > 0 {
		applyMemoryLeak(leakKB)
	}
	if r.Header.Get("X-Degrade") == "1" {
		n := atomic.AddInt64(&degradeCount, 1)
		delay += degradationDelayFor(n)
	}
	delay += takeCold()

	time.Sleep(delay)
```

- [ ] **Step 2: Adicionar o handler `/reset`**

Em `worker/main.go`, após a função `processarHandler`, inserir:
```go
func resetHandler(w http.ResponseWriter, r *http.Request) {
	resetState()
	if cold := r.URL.Query().Get("cold"); cold != "" {
		if n, err := strconv.Atoi(cold); err == nil && n > 0 {
			atomic.StoreInt64(&coldRemaining, int64(n))
		}
	}
	logJSON("info", "Estado de simulacao resetado", nil)
	w.WriteHeader(http.StatusOK)
}
```

- [ ] **Step 3: Adicionar o import do profiler**

Em `worker/main.go`, no bloco de import, após a linha do `tracer`, adicionar:
```go
	"gopkg.in/DataDog/dd-trace-go.v1/profiler"
```

- [ ] **Step 4: Atualizar `main()` — runtime metrics, profiler e rota `/reset`**

Em `worker/main.go`, substituir a função `main` inteira por:
```go
func main() {
	tracer.Start(
		tracer.WithService(os.Getenv("DD_SERVICE")),
		tracer.WithEnv(os.Getenv("DD_ENV")),
		tracer.WithServiceVersion(os.Getenv("DD_VERSION")),
		tracer.WithRuntimeMetrics(),
	)
	defer tracer.Stop()

	if err := profiler.Start(
		profiler.WithService(os.Getenv("DD_SERVICE")),
		profiler.WithEnv(os.Getenv("DD_ENV")),
		profiler.WithVersion(os.Getenv("DD_VERSION")),
		profiler.WithProfileTypes(
			profiler.CPUProfile,
			profiler.HeapProfile,
			profiler.GoroutineProfile,
			profiler.MutexProfile,
		),
	); err != nil {
		logJSON("error", "Falha ao iniciar profiler: "+err.Error(), nil)
	}
	defer profiler.Stop()

	mux := httptrace.NewServeMux()
	mux.HandleFunc("/processar", processarHandler)
	mux.HandleFunc("/reset", resetHandler)

	logJSON("info", "Worker iniciado na porta 8080", nil)
	if err := http.ListenAndServe(":8080", mux); err != nil {
		logJSON("error", "Falha ao iniciar servidor: "+err.Error(), nil)
		os.Exit(1)
	}
}
```

- [ ] **Step 5: Resolver dependências e compilar**

Run (em `worker/`):
```bash
go mod tidy
go build ./...
go test ./...
```
Expected: build OK; testes ainda PASS (4).

- [ ] **Step 6: Commit**

```bash
git add worker/main.go worker/go.mod worker/go.sum
git commit -m "feat(worker): wire behaviors, add /reset, enable profiler + runtime metrics"
```

---

### Task 3: `behaviorHeaders` na API (TDD)

**Files:**
- Create: `api/src/behavior.ts`
- Test: `api/src/behavior.test.ts`

- [ ] **Step 1: Escrever o teste (falha — módulo não existe)**

Create `api/src/behavior.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { behaviorHeaders } from './behavior';

describe('behaviorHeaders', () => {
  it('cpu-burn → X-Cpu-Burn-Ms', () => {
    expect(behaviorHeaders('cpu-burn')).toEqual({ 'X-Cpu-Burn-Ms': '200' });
  });
  it('mem-leak → X-Mem-Leak-KB', () => {
    expect(behaviorHeaders('mem-leak')).toEqual({ 'X-Mem-Leak-KB': '2048' });
  });
  it('degrade → X-Degrade', () => {
    expect(behaviorHeaders('degrade')).toEqual({ 'X-Degrade': '1' });
  });
  it('cold-start e timeout não geram headers de worker', () => {
    expect(behaviorHeaders('cold-start')).toEqual({});
    expect(behaviorHeaders('timeout')).toEqual({});
  });
  it('undefined → vazio', () => {
    expect(behaviorHeaders(undefined)).toEqual({});
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run (em `api/`):
```bash
npm test -- src/behavior.test.ts
```
Expected: FAIL — `Failed to resolve import './behavior'`.

- [ ] **Step 3: Implementar `behavior.ts`**

Create `api/src/behavior.ts`:
```ts
export type Behavior = 'mem-leak' | 'cpu-burn' | 'degrade' | 'cold-start' | 'timeout';

// Headers estáticos por requisição que ativam comportamentos no worker.
// cold-start é armado via POST /reset?cold=N; timeout é tratado no axios (não há header).
export function behaviorHeaders(behavior?: string): Record<string, string> {
  switch (behavior) {
    case 'cpu-burn':
      return { 'X-Cpu-Burn-Ms': '200' };
    case 'mem-leak':
      return { 'X-Mem-Leak-KB': '2048' }; // ~2MB/req => OOM antes de ~256MB
    case 'degrade':
      return { 'X-Degrade': '1' };
    default:
      return {};
  }
}
```

- [ ] **Step 4: Rodar e confirmar verde**

Run (em `api/`):
```bash
npm test -- src/behavior.test.ts
```
Expected: PASS — 5 testes.

- [ ] **Step 5: Commit**

```bash
git add api/src/behavior.ts api/src/behavior.test.ts
git commit -m "feat(api): add behaviorHeaders mapping for new scenarios"
```

---

### Task 4: Definir os 5 cenários novos

**Files:**
- Modify: `api/src/scenarios.ts`
- Modify: `api/src/index.ts` (repassar `behavior` no preset)
- Test: `api/src/scenarios.test.ts` (estender)

- [ ] **Step 1: Adicionar o campo `behavior` às interfaces**

Em `api/src/scenarios.ts`, na interface `Scenario`, após `cascading: boolean;` adicionar:
```ts
  behavior?: string;
```
Na interface `TestParams`, após `cascading: boolean;` adicionar:
```ts
  behavior?: string;
```

- [ ] **Step 2: Adicionar os 5 cenários ao array `SCENARIOS`**

Em `api/src/scenarios.ts`, dentro do array `SCENARIOS`, antes do `]` de fechamento (após o
cenário `falha-cascata`), adicionar:
```ts
  {
    id: 'memory-leak',
    name: 'Memory Leak',
    description: '200 requisicoes; worker acumula memoria ate estourar',
    count: 200,
    errorRate: 0.0,
    minDelay: 50,
    maxDelay: 150,
    concurrency: 10,
    cascading: false,
    behavior: 'mem-leak',
  },
  {
    id: 'cpu-spike',
    name: 'Pico de CPU',
    description: '100 requisicoes que queimam CPU (flame graph no Profiler)',
    count: 100,
    errorRate: 0.0,
    minDelay: 50,
    maxDelay: 100,
    concurrency: 8,
    cascading: false,
    behavior: 'cpu-burn',
  },
  {
    id: 'degradacao-gradual',
    name: 'Degradacao Gradual',
    description: 'Latencia cresce a cada requisicao ao longo do teste',
    count: 200,
    errorRate: 0.02,
    minDelay: 100,
    maxDelay: 300,
    concurrency: 5,
    cascading: false,
    behavior: 'degrade',
  },
  {
    id: 'timeout-cascata',
    name: 'Timeout em Cascata',
    description: 'Worker lento + timeout curto na API => falhas em cascata',
    count: 100,
    errorRate: 0.0,
    minDelay: 2000,
    maxDelay: 5000,
    concurrency: 20,
    cascading: false,
    behavior: 'timeout',
  },
  {
    id: 'cold-start',
    name: 'Cold Start',
    description: 'Primeiras requisicoes lentas (warmup), depois normaliza',
    count: 50,
    errorRate: 0.0,
    minDelay: 100,
    maxDelay: 300,
    concurrency: 5,
    cascading: false,
    behavior: 'cold-start',
  },
```

- [ ] **Step 3: Repassar `behavior` ao montar params do preset**

Em `api/src/index.ts`, dentro do handler `POST /api/test/run`, no objeto `params` do ramo
`if (body.scenario)`, após a linha `cascading: preset.cascading,` adicionar:
```ts
        behavior: preset.behavior,
```

- [ ] **Step 4: Estender o teste de cenários**

Em `api/src/scenarios.test.ts`, dentro do `describe('getScenario', ...)`, adicionar:
```ts
  it('inclui os 5 cenários novos com behavior', () => {
    expect(getScenario('memory-leak')?.behavior).toBe('mem-leak');
    expect(getScenario('cpu-spike')?.behavior).toBe('cpu-burn');
    expect(getScenario('degradacao-gradual')?.behavior).toBe('degrade');
    expect(getScenario('timeout-cascata')?.behavior).toBe('timeout');
    expect(getScenario('cold-start')?.behavior).toBe('cold-start');
  });
```

- [ ] **Step 5: Rodar testes e build**

Run (em `api/`):
```bash
npm test
npm run build
```
Expected: PASS (todos) e build sem erros.

- [ ] **Step 6: Commit**

```bash
git add api/src/scenarios.ts api/src/index.ts api/src/scenarios.test.ts
git commit -m "feat(api): add 5 new performance scenarios with behavior field"
```

---

### Task 5: Aplicar comportamento no `testRunner`

**Files:**
- Modify: `api/src/testRunner.ts`

- [ ] **Step 1: Importar `behaviorHeaders`**

Em `api/src/testRunner.ts`, após `import { inserirVenda } from './db';` (adicionado na Etapa 1),
adicionar:
```ts
import { behaviorHeaders } from './behavior';
```

- [ ] **Step 2: Resetar o estado do worker no início do batch**

Em `api/src/testRunner.ts`, dentro de `runBatch`, logo após a linha
`const workerUrl = process.env.WORKER_URL ?? 'http://worker:8080';`, adicionar:
```ts
  // Reseta o estado do worker (leak/degradacao/cold) para repetibilidade.
  const coldArg = state.params.behavior === 'cold-start' ? '?cold=15' : '';
  await axios.post(`${workerUrl}/reset${coldArg}`).catch(() => {});
```

- [ ] **Step 3: Mesclar headers de comportamento e timeout na requisição**

Em `api/src/testRunner.ts`, localizar a chamada axios dentro do `try`:
```ts
        const response = await axios.post(
          `${workerUrl}/processar`,
          { teste: true, index },
          {
            headers: {
              'X-Error-Rate': effectiveRate.toFixed(4),
              'X-Min-Delay': state.params.minDelay.toString(),
              'X-Max-Delay': state.params.maxDelay.toString(),
            },
            signal,
            validateStatus: () => true,
          }
        );
```
Substituir por:
```ts
        const response = await axios.post(
          `${workerUrl}/processar`,
          { teste: true, index },
          {
            headers: {
              'X-Error-Rate': effectiveRate.toFixed(4),
              'X-Min-Delay': state.params.minDelay.toString(),
              'X-Max-Delay': state.params.maxDelay.toString(),
              ...behaviorHeaders(state.params.behavior),
            },
            signal,
            validateStatus: () => true,
            ...(state.params.behavior === 'timeout' ? { timeout: 2500 } : {}),
          }
        );
```

- [ ] **Step 4: Build**

Run (em `api/`):
```bash
npm run build
```
Expected: build sem erros.

- [ ] **Step 5: Commit**

```bash
git add api/src/testRunner.ts
git commit -m "feat(api): apply behavior headers, timeout and worker reset per batch"
```

---

### Task 6: Limite de memória do worker (OOM controlado)

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Adicionar `mem_limit` e `restart` ao serviço `worker`**

No `docker-compose.yml`, no bloco do serviço `worker`, adicionar (no mesmo nível de `build:`):
```yaml
    mem_limit: 256m
    restart: unless-stopped
```
> `restart: unless-stopped` faz o worker voltar automaticamente após o OOM do cenário
> `memory-leak`, permitindo continuar a demo sem `docker compose up` manual.

- [ ] **Step 2: Subir e validar cenários ponta a ponta**

Run (na raiz):
```bash
docker compose up --build -d
curl -X POST http://localhost:3003/api/test/run -H "Content-Type: application/json" -d '{"scenario":"cpu-spike"}'
```
Expected: HTTP 200 com `testId`; worker processa sem cair.

- [ ] **Step 3: Validar o `/reset` do worker**

Run:
```bash
curl -X POST "http://localhost:3003/api/test/run" -H "Content-Type: application/json" -d '{"scenario":"cold-start"}'
```
Expected: primeiras requisições visivelmente mais lentas no live log da UI; depois normaliza.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: cap worker memory to make memory-leak OOM visible and bounded"
```

---

## Definition of Done (Etapa 2)

- [ ] `go test ./...` em `worker/` passa (4 testes).
- [ ] `npm test` em `api/` passa (incluindo `behavior.test.ts` e cenários novos).
- [ ] Os 5 cenários novos aparecem em `GET /api/scenarios` e são disparáveis.
- [ ] `POST /reset` no worker zera o estado entre execuções.

### Verificação no Datadog (manual)

- [ ] **APM → Profiling:** após rodar `cpu-spike`, o flame graph mostra `burnCPU` dominando a CPU.
- [ ] **Infrastructure / Containers:** durante `memory-leak`, a RSS do container `worker` sobe;
  ao atingir 256m, ocorre OOM visível (restart do container).
- [ ] **APM → Latency:** em `degradacao-gradual`, a latência do `worker.processar` cresce ao
  longo do teste; o Watchdog pode sinalizar anomalia.
- [ ] **APM → Errors:** em `timeout-cascata`, surgem erros de timeout e o `inFlight` empilha na UI.
