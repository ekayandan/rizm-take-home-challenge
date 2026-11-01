# Chart tab freeze inspection

Issue #5. The complaint: "Switching the range to seven days makes the chart unreadable and slow, and on one machine the browser tab froze."

## Summary: best-effort fix

The freeze could not be reproduced, so no fix here is confirmed to resolve it.

Most likely reasons, none proven:

1. **Weak or busy machine.** Every hover re-rendered the whole chart, about 13 fps with the CPU slowed 20 times. Old hardware or heavy software alongside could make that much worse. Not tested on such a machine.
2. **Bad production data.** Flat, huge values make `niceTicks` loop forever. This is the only real freeze found, but only with injected values.
3. **A different build or setup.** The code had no seven-day range before this work, so the reporter used something we do not have.

Applied fixes:

- Hover renders only the legends and highlight. Chart update drops from 3.4 ms to 0.4 ms per hover.
- `niceTicks` can no longer loop forever, whatever the values.
- Very long series no longer overflow the stack in chart layout.
- The week axis has one label per day, without overlap, and the hover readout names the day.
- A week date without data says "No data for this date." instead of loading forever.

These fixes are covered by `client/test/week-chart.test.ts`. The tests were written first and the fixes made without seeing them. Before the fixes, 11 of 13 failed; all pass now.

Known limits:

- Values like 1e300 no longer hang, but their y-axis labels overflow the margin.
- Weekday names are English, matching the day picker.
- The 800 px width problem seen earlier no longer appears in a browser at 700-1920 px. No automated test covers it.
- The results in the sections below were measured before these last fixes.

## Conclusion

- The reported freeze is not reproduced with real data. Its cause is unknown.
- The code had no seven-day range before this work, so the reporter did not use the week view measured here.
- "Unreadable" is reproduced: 56 overlapping x-axis labels and no dates.
- "Slow" is partly reproduced: every hover re-renders the whole chart, which lags on a slow CPU.
- The only real freeze found needs injected data: the endless loop in `niceTicks`.
- Sampling is not supported by these results. A week is 672 steps and about 800 SVG nodes.

## Setup

Dev build on a fast Apple Silicon Mac, Chrome driven over CDP. Seed data: 3 halls, 30 days, 2884 steps per hall. The week view uses the existing day chart and endpoints, without optimization.

## Results

### Speed (Halle 7)

| Measure | Day | Week |
|---|---|---|
| Data load | not totalled | 45-54 ms, 9 requests |
| Chart first render | 24 ms | 40-81 ms |
| SVG nodes | 169 | 640-792 |

Hover with real mouse input, on the week view:

| Setup | Per move | Frames | Longest stall |
|---|---|---|---|
| Normal CPU, 1440 px | about 18 ms | about 60 fps | 21 ms |
| 20x slower CPU, 1440 px | about 82 ms | about 13 fps | 245 ms |
| 20x slower CPU, 3840 px at 2-3x scaling | not recorded | 13-14 fps | 234 ms |

A manual test at 20x CPU throttling also loaded quickly.

### Memory

All 72 seven-day windows, forced garbage collection, back/forward cache off.

| Measure | Day | Week |
|---|---|---|
| JS heap | 4.85 MB | 5.89-6.12 MB |
| DOM nodes | 708 | 905-1479 |
| Tab process memory | not recorded | 189-206 MB |

- 200 hover moves raise the heap to at most 49 MB before collection, then it returns to 5.86-6.10 MB.
- Three rounds through all weeks in one tab: 5.92 to 6.96 MB, with 0.12 MB of that over the last two rounds. Nodes and listeners stay flat. No leak.
- An out-of-memory crash from this view is ruled out on this data.

### GPU

The measure is `Device Utilization %` from `ioreg`. It covers the whole machine, including other apps. Four alternating rounds of 8 seconds per case, mouse moved at about 60 moves per second, no frame probe:

| Case | Average | Median | Max |
|---|---|---|---|
| Blank page, no mouse | 30.6 % | 46 % | 66 % |
| Blank page, mouse moving | 34.4 % | 39 % | 72 % |
| Week, no mouse | 32.0 % | 29 % | 62 % |
| Week, hover (today) | 39.6 % | 39 % | 65 % |
| Day, hover (today) | 28.5 % | 32 % | 55 % |
| Week, rendered once with a moved highlight | 26.0 % | 30 % | 69 % |

- The earlier 57-67 % readings do not hold up. Those runs had a `requestAnimationFrame` probe running, and it probably inflated them, because it forces a frame every refresh. They were also short.
- A blank page varies as much as the differences between cases, so the machine's background load is large.
- Rendering once reads about 14 points below today's week hover. This points the right way but is not conclusive at this noise level.
- Not measured: GPU load on weak hardware, or with other heavy software running.

Repeat with the laptop left idle, three alternating rounds of 8 seconds per case. "Render once" is a browser prototype: a static copy of the chart with a moved highlight.

| Case | Average | Median | Max |
|---|---|---|---|
| Day, current | 30.4 % | 31 % | 64 % |
| Week, current | 33.8 % | 38 % | 42 % |
| Day, render once | 26.4 % | 29 % | 34 % |
| Week, render once | 26.2 % | 29 % | 35 % |

Rendering once reads 4 points lower on the day and 7.6 lower on the week, and makes the two views equal. No idle baseline was taken in this run, so the share caused by the chart alone is unknown.

### Previous and new hover under GPU load

The new render is implemented in `DayChart.vue`: hover skips everything except legends and the highlight. Chrome has no GPU throttle, so load was simulated. Week view, Halle 7, three alternating rounds of 8 seconds per case, frame probe running.

| Scenario | Version | GPU use, avg | Chart update, avg | Longest stall | Frame time, median |
|---|---|---|---|---|---|
| Normal | Previous | 50.9 % | 3.4 ms | 16 ms | 8.3 ms |
| Normal | New | 50.3 % | 0.4 ms | 13 ms | 8.3 ms |
| GPU saturated by a second Chrome with heavy WebGL | Previous | 100 % | 3.4 ms | 16 ms | 8.3 ms |
| GPU saturated by a second Chrome with heavy WebGL | New | 100 % | 0.4 ms | 13 ms | 8.3 ms |
| Software rendering (`--disable-gpu`) | Previous | 42.7 % | 3.4 ms | 18 ms | 8.3 ms |
| Software rendering (`--disable-gpu`) | New | 41.9 % | 0.4 ms | 12 ms | 8.3 ms |

- Chart update time drops about 8 times in every scenario. This is the solid result.
- GPU use does not separate the versions in this run. The frame probe forces a frame every refresh in both, so it may hide a difference; the earlier runs without a probe showed one.
- Chrome rendering in software still reads about 42 %, so much of this figure is not Chrome's GPU work.
- Frame time is the page's `requestAnimationFrame` rate, not what reaches the screen, and it did not react to the saturated GPU. Visible lag under load is not measured.
- This is competition for a fast GPU, not a slow GPU. It does not reproduce old hardware.
- A single 158 ms frame appeared once in the new version under normal load, with no repeat in other scenarios.

### Other cases

| Case | Result |
|---|---|
| 200 rapid resizes, 320-3840 px | No freeze, longest stall 18 ms |
| Clock-change day and weeks | Chart renders, no errors |
| Windows with fewer than 7 days | Chart renders, no errors |
| 20 tabs at once | All loaded in 1.5 s, all responsive |
| Bad date on the week route | No freeze, stays on "Loading week…" forever |
| Unknown hall or schedule on the week route | No freeze, error shown |

Longer ranges, using the real chart with repeated data. The UI cannot reach these.

| Range | Hover per move | Longest stall | JS heap |
|---|---|---|---|
| 30 days | 11 ms | 27 ms | 13 MB |
| 90 days | 22 ms | 93 ms | 19 MB |
| 365 days | 92 ms | 354 ms | 93 MB |
| 730 days or more | stack overflow error | none | not measured |

The stack overflow most likely comes from `Math.min(...vals)` in the chart's layout. It is an error, not a hang.

### The one real freeze

`niceTicks` in `client/src/components/DayChart.vue` never ends when a panel's values are flat and huge, because adding the tick step no longer changes the number. It also keeps pushing to an array, so the tab would eventually run out of memory. It froze a tab with injected values of 1e17. The largest seed value is 1800, so seed data cannot reach it. Garbage from a sensor or import could.

## Open explanations

None of these can be tested from here:

- The reporter's machine: old GPU, low memory or heavy software alongside.
- A different build from the one we have.
- Bad production data reaching the `niceTicks` loop.

Asking the site lead which machine and browser they used, and what they clicked, is the way to narrow this down.

