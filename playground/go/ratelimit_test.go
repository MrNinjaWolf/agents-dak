package ratelimit

import (
	"testing"
	"time"
)

func TestBannedKeyRejected(t *testing.T) {
	l := New(5, time.Minute)
	l.banned["evil"] = true
	if l.Allow("evil") {
		t.Fatal("banned key should be rejected")
	}
}

func TestRetryAfterZeroWhenUnderLimit(t *testing.T) {
	l := New(3, time.Minute)
	l.Allow("a")
	if d := l.RetryAfter("a"); d != 0 {
		t.Fatalf("want 0, got %v", d)
	}
}

func TestKeysAreIndependent(t *testing.T) {
	l := New(1, time.Minute)
	if !l.Allow("a") || !l.Allow("b") {
		t.Fatal("different keys should not share a budget")
	}
}
