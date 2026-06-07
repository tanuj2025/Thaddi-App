---
name: jsdom + React poll-loop starvation
description: Why DOM polling helpers in node:test jsdom suites must yield before reading, when the component self-observes via MutationObserver
---

# jsdom + React 18 poll loops can wedge the event loop

When a component renders **inside** the same container its own `MutationObserver`
watches (THADDI's `PasswordRequirements` is rendered inside `signUpRef`, which it
also observes — this is the real production wiring, not a test artifact), a test
poll helper that reads the DOM **synchronously on its first iteration, right after
`dispatchEvent`/a state change**, can hang the whole jsdom event loop. React 18's
`createRoot` scheduler microtasks plus the self-observing MutationObserver starve
the pending `setTimeout`, so neither the poll interval nor the test's own
`{ timeout }` ever fires — the run hangs until an external kill (no ✖, no
timeout failure).

**Why:** the symptom looks like a "slow test" but is actually macrotask
starvation triggered specifically by polling synchronously before yielding. A
plain `await sleep(...)` right after the same action settles fine, which is the
tell.

**How to apply:** in `waitFor`-style poll helpers, **`await` the interval BEFORE
the first assertion**, never call `fn()` synchronously first. i.e. loop body =
`await sleep(interval)` then `try fn()`. This keeps polling robustness while
letting React render + observer microtasks drain on a clean macrotask turn.
Also: in these submit-time tests, clear highlights by editing the password value
back to `""` (fires the input event, returns rows to idle) instead of typing a
new 8+ char value — that avoids needlessly kicking the 200ms strength / 500ms
breach debounce timers and zxcvbn load on every iteration.

**Tooling note for verifying these suites:** node:test block-buffers stdout to a
pipe (only the first ✔ flushes); run under a PTY (`script -qec "..." /dev/null`)
with **no** downstream `| grep`/`| sed` (those re-buffer). The full
`test:password` suite runs ~7s and exits via `--test-force-exit`.
