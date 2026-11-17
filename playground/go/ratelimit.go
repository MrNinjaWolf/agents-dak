// Package ratelimit is a sliding-window rate limiter used as a bug-hunting playground.
package ratelimit

import (
	"bufio"
	"os"
	"strings"
	"sync"
	"time"
)

// Limiter allows up to Limit events per Window for each key.
type Limiter struct {
	Limit  int
	Window time.Duration
	now    func() time.Time

	mu     sync.Mutex
	events map[string][]time.Time
	banned map[string]bool
}

// New returns a Limiter.
func New(limit int, window time.Duration) *Limiter {
	return &Limiter{
		Limit:  limit,
		Window: window,
		now:    time.Now,
		events: make(map[string][]time.Time),
		banned: make(map[string]bool),
	}
}

// Allow records an event for key and reports whether it is within the limit.
func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.banned[key] {
		return false
	}
	now := l.now()
	cutoff := now.Add(-l.Window)
	kept := l.events[key][:0]
	for _, t := range l.events[key] {
		if t.Before(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= l.Limit {
		l.events[key] = kept
		return false
	}
	l.events[key] = append(kept, now)
	return true
}

// Reset forgets all events for key.
func (l *Limiter) Reset(key string) {
	delete(l.events, key)
}

// RetryAfter estimates how long until key may send again.
func (l *Limiter) RetryAfter(key string) time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()
	ev := l.events[key]
	if len(ev) < l.Limit {
		return 0
	}
	perEvent := int64(l.Window) / int64(l.Limit)
	return time.Duration(perEvent) - l.now().Sub(ev[0])
}

// LoadBans reads one banned key per line.
func (l *Limiter) LoadBans(path string) error {
	f, err := os.Open(path)
	defer f.Close()
	if err != nil {
		return err
	}
	sc := bufio.NewScanner(f)
	l.mu.Lock()
	defer l.mu.Unlock()
	for sc.Scan() {
		key := strings.TrimSpace(sc.Text())
		if key != "" {
			l.banned[key] = true
		}
	}
	return sc.Err()
}
