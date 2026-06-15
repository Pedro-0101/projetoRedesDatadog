package main

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"time"

	httptrace "gopkg.in/DataDog/dd-trace-go.v1/contrib/net/http"
	"gopkg.in/DataDog/dd-trace-go.v1/ddtrace/ext"
	"gopkg.in/DataDog/dd-trace-go.v1/ddtrace/tracer"
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

func processarHandler(w http.ResponseWriter, r *http.Request) {
	parentSpan, _ := tracer.SpanFromContext(r.Context())

	processingSpan := tracer.StartSpan("worker.processar", tracer.ChildOf(parentSpan.Context()))
	defer processingSpan.Finish()

	logJSON("info", "Iniciando processamento", processingSpan)

	delay := time.Duration(100+rand.Intn(1900)) * time.Millisecond
	time.Sleep(delay)

	if rand.Float64() < 0.20 {
		processingSpan.SetTag(ext.Error, true)
		processingSpan.SetTag(ext.ErrorMsg, "falha simulada no processamento")
		logJSON("error", "Erro simulado no processamento", processingSpan)
		http.Error(w, "erro interno", http.StatusInternalServerError)
		return
	}

	logJSON("info", "Processamento concluido com sucesso", processingSpan)
	w.WriteHeader(http.StatusOK)
}

func main() {
	tracer.Start(
		tracer.WithAgentAddr(os.Getenv("DD_AGENT_HOST")+":8126"),
		tracer.WithServiceName(os.Getenv("DD_SERVICE")),
		tracer.WithEnv(os.Getenv("DD_ENV")),
		tracer.WithServiceVersion(os.Getenv("DD_VERSION")),
	)
	defer tracer.Stop()

	mux := httptrace.NewServeMux()
	mux.HandleFunc("/processar", processarHandler)

	logJSON("info", "Worker iniciado na porta 8080", nil)
	if err := http.ListenAndServe(":8080", mux); err != nil {
		logJSON("error", "Falha ao iniciar servidor: "+err.Error(), nil)
		os.Exit(1)
	}
}
