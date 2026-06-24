package main

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
	"gopkg.in/DataDog/dd-trace-go.v1/profiler"
)

type logEntry struct {
	Timestamp string `json:"timestamp"`
	Level     string `json:"level"`
	Message   string `json:"message"`
	TraceID   string `json:"dd.trace_id,omitempty"`
	SpanID    string `json:"dd.span_id,omitempty"`
}

func logJSON(level, message string, span tracer.Span) {
	entry := logEntry{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Level:     level,
		Message:   message,
	}
	if span != nil {
		entry.TraceID = fmt.Sprintf("%d", span.Context().TraceID())
		entry.SpanID = fmt.Sprintf("%d", span.Context().SpanID())
	}
	b, _ := json.Marshal(entry)
	fmt.Fprintln(os.Stdout, string(b))
}

// --- estado global de simulação (resetável via /reset) ---
var (
	leaked        [][]byte
	leakMu        sync.Mutex
	degradeCount  int64
	coldRemaining int64
)

// faultErrorRate e uma taxa de erro INTRINSECA desta instancia de worker,
// independente do X-Error-Rate enviado por request. Serve para "envenenar" um
// worker especifico (ex.: so o worker-a) enquanto os demais permanecem
// saudaveis — o cenario que faz o Datadog perceber a anomalia e migrar a rota.
//
// PROPOSITAL: NAO e limpa por resetState()/`/reset`. O runBatch da API reseta
// todos os workers ao iniciar cada teste; se a falha fosse limpa aqui, ela seria
// apagada justo quando o trafego comeca. So sai via POST /fault?errorRate=0.
var (
	faultMu        sync.Mutex
	faultErrorRate float64
)

func setFaultErrorRate(r float64) {
	if r < 0 {
		r = 0
	} else if r > 1 {
		r = 1
	}
	faultMu.Lock()
	faultErrorRate = r
	faultMu.Unlock()
}

func getFaultErrorRate() float64 {
	faultMu.Lock()
	defer faultMu.Unlock()
	return faultErrorRate
}

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

func parseFloatHeader(r *http.Request, header string, fallback float64) float64 {
	val := r.Header.Get(header)
	if val == "" {
		return fallback
	}
	f, err := strconv.ParseFloat(val, 64)
	if err != nil || f < 0 || f > 1 {
		return fallback
	}
	return f
}

func parseIntHeader(r *http.Request, header string, fallback int) int {
	val := r.Header.Get(header)
	if val == "" {
		return fallback
	}
	i, err := strconv.Atoi(val)
	if err != nil || i < 0 {
		return fallback
	}
	return i
}

func processarHandler(w http.ResponseWriter, r *http.Request) {
	parentSpan, _ := tracer.SpanFromContext(r.Context())

	processingSpan := tracer.StartSpan("worker.processar", tracer.ChildOf(parentSpan.Context()))
	defer processingSpan.Finish()

	logJSON("info", "Iniciando processamento", processingSpan)

	errorRate := parseFloatHeader(r, "X-Error-Rate", 0.20)
	// A falha intrinseca da instancia (set via /fault) prevalece quando maior:
	// permite degradar UM worker independentemente do trafego balanceado.
	if fault := getFaultErrorRate(); fault > errorRate {
		errorRate = fault
	}
	minDelay := parseIntHeader(r, "X-Min-Delay", 100)
	maxDelay := parseIntHeader(r, "X-Max-Delay", 1900)

	delayRange := maxDelay - minDelay
	if delayRange <= 0 {
		delayRange = 1
	}
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

	if rand.Float64() < errorRate {
		processingSpan.SetTag(ext.Error, true)
		processingSpan.SetTag(ext.ErrorMsg, "falha simulada no processamento")
		logJSON("error", "Erro simulado no processamento", processingSpan)
		http.Error(w, "erro interno", http.StatusInternalServerError)
		return
	}

	logJSON("info", "Processamento concluido com sucesso", processingSpan)
	w.WriteHeader(http.StatusOK)
}

// healthHandler responde a probes de heartbeat do SDN controller. Mantem o
// worker marcado como vivo mesmo quando nao recebe trafego de /processar.
func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintln(w, `{"status":"ok"}`)
}

// faultHandler ajusta a taxa de erro intrinseca da instancia.
// POST /fault?errorRate=0.8  -> 80% das requisicoes falham nesta instancia.
// POST /fault?errorRate=0    -> remove a falha.
func faultHandler(w http.ResponseWriter, r *http.Request) {
	rate := parseFloatHeader(r, "X-Error-Rate", -1)
	if q := r.URL.Query().Get("errorRate"); q != "" {
		if f, err := strconv.ParseFloat(q, 64); err == nil {
			rate = f
		}
	}
	if rate < 0 {
		http.Error(w, "errorRate ausente (use ?errorRate=0..1)", http.StatusBadRequest)
		return
	}
	setFaultErrorRate(rate)
	logJSON("warn", fmt.Sprintf("Fault injection ajustada: errorRate=%.2f", getFaultErrorRate()), nil)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"faultErrorRate":%.4f}`+"\n", getFaultErrorRate())
}

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
	mux.HandleFunc("/fault", faultHandler)
	mux.HandleFunc("/health", healthHandler)

	logJSON("info", "Worker iniciado na porta 8080", nil)
	if err := http.ListenAndServe(":8080", mux); err != nil {
		logJSON("error", "Falha ao iniciar servidor: "+err.Error(), nil)
		os.Exit(1)
	}
}
