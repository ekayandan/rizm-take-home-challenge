# Checker

`checker.ts` is the hall HVAC model: `simulate(instance, schedule)` runs a schedule through
the physics and returns the cost, the energy by component and every constraint violation.
It is a verified port of the Python checker the optimizer is scored with, it is pure and
synchronous and has no dependencies. Treat it as correct; `step()` and `zoh()` are
exported for anyone who wants to simulate partial horizons.

A hall file in `data/halls/` is a superset of the `Instance` type: it carries the same
`horizon`, `constants`, `room`, `hvac`, `initial_state`, `series` and `bounds` keys, plus
timestamps, shifts, schedules and measured values.

Tests compare the port against the Python checker's reports on eight instances:

```sh
node --experimental-strip-types --test server/checker/checker.test.ts
```
