# The cost of a tap on the waiter's phone

## Objective and problem

The waiter reports that the products on the menu take a moment to register the
tap, and that it is worse on a phone than on a laptop. Later he found the test
that splits the problem in two: **on his phone it is slow in portrait and normal
in landscape.**

That combination rules out the server, the network and the database: the same URL
is fine on a laptop, and the two orientations use the same connection.

## What was measured

### The server is not it

Measured against production (`179.236.76.74`, now in Boston), median of 5:

| Endpoint | Time | Database's share |
|---|---|---|
| `/api/health` (touches nothing) | 244 ms | — |
| `/api/products` | 253 ms | **9 ms** |

The trip costs 244 ms and the query 9. Moving from MongoDB to PostgreSQL would
change the 9. (The host did move closer during this work: the round trip went from
208-244 ms to ~110-156 ms, and the old IP went dead — the deploy was pointed at a
machine that no longer answered, which is why a whole day of fixes never reached
the phone.)

### The blur was real, but not the cause

Nine fixed or sticky bars carried `backdrop-filter: blur()` while being 90-95 %
opaque, and the Salón one already turned the blur off at ≥820px — so the desktop
was exempt and the phone paid. Removed in #98 (verified: 0 elements with a backdrop
filter now). **It did not fix the symptom.**

### The emulated measurements, and the artifacts caught in them

Playwright, real touch taps, CDP CPU throttling, against production:

- **1x CPU, both orientations: 70 ms vs 69 ms.** Identical. So the mobile layout
  is not slower per se.
- The first run showed 1.9x (131 vs 70 ms). **That was my own bug**: I always
  measured portrait first, and the first pass pays the cold start (lazy chunks,
  JIT). Interleaving the rounds and reversing the order made the difference move
  to the other orientation. Recorded here so nobody trusts that number.
- At 6x CPU the portrait penalty reappeared (1.4x) but did not survive repetition.
- **Blocking the polling requests changed nothing** (long tasks stayed at 18-20), so
  the periodic refetches are not what delays the finger.

### The browser trace: it is JavaScript, not CSS

8 taps in portrait at 6x CPU (Chrome tracing, `devtools.timeline`):

| Work | Time | Share |
|---|---|---|
| FunctionCall (JavaScript) | 1151 ms | 27.7 % |
| RunMicrotasks | 1028 ms | 24.7 % |
| EventDispatch | 865 ms | 20.8 % |
| Paint | 312 ms | 7.5 % |
| Layout | 257 ms | 6.2 % |
| PrePaint + Layerize + UpdateLayoutTree | 312 ms | 7.5 % |

**73 % is JavaScript and event dispatch; CSS and painting are under 15 %.** And the
app's own handler is only 2-4 ms of it (Event Timing: 56 ms total, 27 ms of "the
thread was busy", 3 ms of code). React's diff is targeted too: a tap mutates 10-14
nodes across 3-4 zones.

So the cost is the JavaScript work of deciding what to change — the whole Salón
screen re-renders on every tap, including the floor (12 tables, header, filters,
alerts) that is hidden behind the sheet and does not change — and a slow phone CPU
multiplies it. At 1x that is ~20 ms of work; on a throttled CPU it becomes the
100-300 ms long tasks that make the *next* tap wait.

## What was tried and reverted

Unmounting the hidden floor while the sheet is open (instead of leaving it mounted
with `hidden`). It broke three tests that deliberately exercise the floor while the
sheet is open — typing into the floor search, reading a table's attention context —
so the mounted-but-hidden floor is a project contract, not an oversight. Reverted
rather than weaken those guards for an unmeasured gain.

## What shipped

`?diag=1` shows an on-screen meter with the numbers only the device can give:
interaction duration split into "busy thread" and "code", long tasks (count and
worst), FPS, and the context (version, viewport, orientation, DPR, nodes). Plain
DOM outside React, off unless asked for, no motion of any kind.

## Open

The device's numbers. Everything above is either server-side, or measured on an
emulated phone whose GPU cannot be throttled — and the portrait/landscape
difference is not reproducible on a fast GPU. The next step is to read the meter
on the actual phone in both orientations and then attack the JavaScript work per
tap (memoising the floor and the sheet model) with a measurement that proves the
gain instead of guessing it.
