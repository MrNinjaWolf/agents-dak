# Bug hunt: playground

Slices: 1 · Claimed: 3 · Confirmed: 3 · Disputed: 0 · Refuted: 0 · Unverified: 0

## Confirmed

| Location | Title | Severity |
|---|---|---|
| playground/go/ratelimit.go:45 | Sliding-window filter is inverted: it keeps expired events and drops in-window ones, so the limiter never limits | critical |
| playground/js/queue.js:51 | drain() uses forEach(async) and returns before any job finishes, so it always returns 0 | high |
| playground/python/inventory.py:27 | Mutable default `tags=[]` is shared and mutated, so tags leak between items | medium |
