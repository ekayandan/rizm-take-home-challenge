# Refactor status

## Issue 8: "The words mean nothing to them"

**Decision:** localization stays a separate task. Explanations live in one file, `client/src/glossary.ts`, so it can translate them later.

### Done
- A "?" next to a term explains it on hover, keyboard focus or tap (`TermHelp.vue`), on the sites, hall and day pages.

### Open
- Explanations are English only, which falls short for the two sites whose operators read German.
- Tooltips explain what a number means. "Why does the plan look like this" and "what may I touch" are still unanswered.
- Whether this is enough for day-one use needs a new operator to try it.

## Issue 6: "Who did that?"

**Decision:** interventions are immutable, so the table is the history and no separate audit log is needed. A parent `interventions` table holds who, when and why, with one details table per type, starting with `maintenance_windows`. Triggers block deletes and every change except a single revoke; a hall or user being removed cannot affect the record.

### Done
- A reason is required on the API and in the maintenance form.
- `GET /api/interventions` and an "Intervention history" page covering all halls on the user's sites.
- Reads of what is in force go through the `active_interventions` view.

### Open
- Undo and "back to before Tuesday": the revoke columns exist, but there is no route or UI yet.
- Maintenance windows still do not affect the plan or cost (see "Interventions have no consequences").
- Shift changes and fan pins would each add a details table and a `type` value.
- The schema changed, so existing dev databases need `npm run seed`.

## Issue 3: "Where did we break the limits?"

**Finding:** every seeded baseline and optimized schedule passes the checker, so simulated violations are zero. All real breaches are in the measured sensor data, which the day view did not plot.

### Stage 1: detect and highlight on the day view (done, not committed)
- `GET /api/halls/:id/violations?from=&to=` compares measured state with the bounds, using the checker's tolerance.
- Temperature and CO₂ panels plot measured (solid) and simulated (dashed), with red dots and shaded intervals on breaches.
- The cost card reports plan feasibility and sensor breaches separately.

- Breach list below the charts: one row per step, with the price and plan values leading to that reading.

### Note: micro-breaches
All breaches count, using the checker's tolerance. The data currently has many micro-breaches (often under 0.01 °C). A margin could be added later to keep them from polluting the data.

### Open
- Clock change issue: the chart's hover readout and axis show repeated times on 25 Oct with no label saying which is which. The breach list labels them (1st/2nd), but no seeded hall has a breach that day.
- Equipment violations are counted in the card but not marked on a chart; none occur in the seeded schedules.
- Stage 2: persisted violations, central view, explanations, seen/unseen.

## Week view (issue #5)

Split into performance (#22, this draft PR, awaiting manual tests) and readability (#23, planned). Details in `chart-tab-freeze-inspection.md`.

- Week route on the existing chart and endpoints, with day labels and dates in the hover readout. Hover no longer re-renders the whole chart.
- The reported freeze could not be reproduced, so the fix is best effort. It was not tested on old hardware.
