# Issue 4: Interventions have consequences

Step 1: show what maintenance does to the stored plan, with no optimizer. No re-planning.

## Limitations
- The simulation is open loop: the stored plan keeps running as written, with the equipment off. Nothing reacts, so this answers "what breaks if nobody re-plans?", not "what will happen".
- "Worst case" means worst case for the plan, not a limit on reality. A scheduler that reacted could prevent some violations, especially after the window. Model error or disturbances could still make real readings worse than the simulation.
- Violations long after the window are the least reliable, because the state error carries forward for days.
- The stored plan runs right at its limits, so almost any disruption registers as a violation and the count looks high.
- A preview starts from the simulated state at the start of the data period, not current sensor readings.
- Cost is deliberately not shown. The drop comes only from equipment being off with nothing made up afterwards, so it would read as an improvement. A real re-plan could cost more. A realistic cost or violation estimate needs a re-planner, and the repo has no optimizer.

## Progress
- [x] Scenario function and consequences route
- [x] Maintenance tab: form, preview, saved windows, comparison chart
- [x] Day view: plan only, with a notice linking to the tab
- [x] Cost removed from consequences; violations stated as worst case
- [x] Tests and browser check
- [ ] Manual tests approved
- [ ] Decide on step 2 (limited repair)

## Manual test steps (http://localhost:5204, lena.hartmann@example.com / operator-2026)
1. Open Halle 7 on 2026-10-12. Expect Day, Week and Maintenance tabs, a chart with no maintenance lines, and no maintenance form or notice if no window is saved for this hall.
2. Click the Maintenance tab. Pick Boiler, 2026-10-12 06:00–14:00, click Preview consequences. Expect "Preview, not saved", red "Worst case if nothing is re-planned", a table of expected new violations, and no euro amount anywhere in the result.
3. Check the chart under the result. Expect Stored plan and With maintenance lines, for temperature, CO₂ and only the controls that changed. Expect no spot price panel.
4. Change the End time. Expect the preview and its chart to disappear.
5. Reload. Expect no new window in the list: a preview saves nothing.
6. Open Halle 7 Maintenance on 2026-10-12 again, set Start and End to 2026-10-13, and preview. Expect the chart's day to change to 2026-10-13 and your times to stay.
7. Open Halle 3 Maintenance on 2026-10-08. Expect "Saved maintenance" with the saved Burner inspection window and a comparison chart.
8. Open Halle 3 on 2026-10-08 in the Day tab. Expect a yellow notice above the chart with the worst-case count and a "See the comparison" link that opens the Maintenance tab on the same day.
9. Log in as petra.koch@example.com / viewer-2026 and open Halle 3 Maintenance on 2026-10-08. Expect the saved result and chart, and no form.
