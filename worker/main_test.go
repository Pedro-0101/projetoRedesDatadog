package main

import (
	"sync/atomic"
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
	atomic.StoreInt64(&coldRemaining, 2)
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
