# Issue 4: Interventions have consequences

Step 1: show what maintenance does to the stored plan, with no optimizer. No re-planning.

## Progress
- [x] Scenario function and consequences route
- [x] Day view: in-force card, preview, chart overlay
- [x] Tests and browser check
- [ ] Manual tests approved
- [ ] Decide on step 2 (limited repair)

## Manual test steps (http://localhost:5204, lena.hartmann@example.com / operator-2026)
1. Open Halle 7 on 2026-10-12. Expect no "Maintenance in force" card if no window is saved for this hall.
2. In Maintenance windows pick Boiler, 06:00–14:00, click Preview consequences. Expect "Preview, not saved", a red "no longer keeps all limits", a table of new violations, and a cost line saying it is not a saving. The chart gains a dashed black Preview line.
3. Change the End time. Expect the preview and the Preview line to disappear.
4. Reload. Expect no new window in the list: a preview saves nothing.
5. Open Halle 3 on 2026-10-08, pick Chiller, 06:00–14:00, preview. Expect green "No effect on the plan".
6. Pick Boiler, enter a reason, click Add window. Expect a "Maintenance in force" card and an "After maintenance" chart line.
7. Log in as petra.koch@example.com / viewer-2026 on the same day. Expect the card and no form.
