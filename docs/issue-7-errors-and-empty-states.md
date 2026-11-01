# Issue 7: errors and empty states

Status: fixed, and the manual tests below were approved. Open points continue in #18, including C2. `P` numbers are from the Sonnet agent's walk through the app. `C` numbers are from my own API probes and code reading.

How it was tested: the app ran on databases built up one layer at a time (no database, schema, users, sites, halls, time series, schedules, then a single day with missing data), and then with the API down and with simulated failed saves.

## Broken parts and suggested fixes

### 1. Saves can create duplicates (the core of the issue)

| ID | What happens | Suggested fix |
|---|---|---|
| P15 | The save reaches the server but the response is lost. The user sees "Failed to fetch" and retrying adds an identical row. | On an unclear failure, reload the list and say whether the window was saved. |
| P16 | The save succeeds but the list refresh fails. The user sees an error, so they retry. The refresh sits inside the save's `try` in `MaintenancePanel.vue`. | Treat save and refresh as separate steps: "Saved, but the list could not be refreshed." |
| P17 | A hanging save leaves the button on "Saving…" with no timeout. | Add a request timeout, then say the outcome is unknown and check the list. |
| P23, P15 | The server accepts identical windows, and a successful save shows no clear confirmation. | Answer an identical window (same hall, asset, start, end) with 409 and who added it, and show a "Saved" message. |
| C1 | No duplicate protection exists at any level, so client messages alone cannot prevent duplicates. | The 409 above is the safeguard. Add a server test. |

Existing duplicates in real data would stay as they are. The check applies to new saves only.

### 2. Loading that never ends

| ID | What happens | Suggested fix |
|---|---|---|
| P7 | Hall page with no days: "Loading cost…" forever. With no schedules: an empty cost table. | Separate "loading" from "nothing to load", and say what is missing. |
| P8 | Day view: "This hall has no schedules." with "Loading day…" under it forever. The load exits early when there are no schedules. | Show only the explanation. |

### 3. Missing data explained badly or wrongly

| ID | What happens | Suggested fix |
|---|---|---|
| P9 | Missing price day (the case heard on site): "no data for hall 'halle-a' between 2026-10-06 and 2026-10-06". | "No price data for Halle A on 6 Oct, so cost and plan can't be calculated", with links to the nearest days that have data. |
| P10 | No sensor readings, yet the page says "measured climate stayed within limits". | Most serious wrong message: say limits could not be checked. Count missing readings instead of reporting all clear. |
| C2 | A day's rows deleted (l8): the next day still gets a cost, now reported infeasible, because the simulation runs across the gap. Null prices (l7) also still produce a next-day cost. | Show whether a cost was simulated across missing data, or refuse it. Needs a closer look: the checker is the source of truth for cost. |
| P3, P5, P6 | No sites, no halls or no schedule: bare "No sites.", empty tables, "no 'optimized' schedule". | Plain empty states per case. Hide empty tables and the "Day" label. |
| P11, P12 | Bad or out-of-range date in the URL shows API text such as "'from' must be a date". | "That date isn't valid" or "Data covers 5 Oct to 3 Nov", with a link. |
| P4, P13 | "hall 'halle-a' not found" shows an internal ID and has no way back. | "We couldn't find that hall" with a link to Sites. Keep the same message for other sites' halls, so a hall's existence isn't revealed. |

### 4. Connection and server failures

| ID | What happens | Suggested fix |
|---|---|---|
| P14, P19, P20, P22 | Raw "Failed to fetch" and "502 Bad Gateway". | Map failures to plain messages in one place, `request()` in `api.ts`. |
| P21 | API down on reload: silently sent to login, as if logged out. `ensureChecked` treats every failure as "no session". | Only a 401 means logged out. Otherwise show "Service unavailable" with a retry. |
| P20 | Old maintenance list stays on screen during an outage and looks current. | Mark it as possibly out of date when a refresh fails. |
| P1 | Missing database: the login form shows a file path and `npm run seed`. | Log the detail on the server and send the client a generic message. This also closes a small information leak. |
| C3 | Corrupt database: bare "internal error" while `/api/health` says OK, and the startup log says "until it exists". | Have health check the database and correct the log message. |
| P18 | Session expires during a save: no explanation and the entered times are lost. | "Your session expired; your window was not saved." Keep the draft across login. |
| C4 | No retry button anywhere, and the sites error shows only in the sidebar. | Add a retry on load errors and show the error in the main area too. |

### Minor

- P2: with no users, login says "wrong email or password". Leave as is, since a different message would reveal whether accounts exist.

### Out of scope

- P24: raw "+02:00" offsets belong to the clock change task.

## Suggested order

1. Saves: section 1, with the server 409 and tests.
2. Shared error mapping and the login/outage fix: section 4.
3. False reassurance and endless loading: P10, P7, P8.
4. Empty-state wording: the rest of section 3.

C2 needs its own decision, because it touches cost figures rather than messages.

## Tests (written first)

Files: `server/test/errors.test.ts`, `client/test/api-errors.test.ts`, `client/test/MaintenancePanel.test.ts`, `client/test/empty-states.test.ts`, with helpers in `client/test/helpers.ts`. Test names start with the finding ID.

Decisions the tests fix, which the implementation has to meet:

- An identical window answers 409, and the error names who recorded it. Instants are compared in UTC.
- A database that can't be used answers 503 with a generic message, and `/api/health` answers 503 with `ok: false`.
- `useAuthStore()` gains `unavailable` (the session check failed for a reason other than 401, and is asked again next time) and `sessionExpired` (read by `LoginView`).
- Success and "saved after all" messages use `role="status"`.
- The request timeout uses `setTimeout` with `AbortController`, and is at most 60 seconds. `AbortSignal.timeout` won't work with the fake timers.
- The maintenance draft is kept in `sessionStorage` when a save answers 401, and is restored once.
- After an unclear save failure, the panel reloads the list and compares asset and local times to decide what to say.

Not covered by a test:

- P2 and P24: no change planned.
- C2: a `todo` test, which doesn't fail the run, until refuse or flag is decided.
- C3 startup log wording.
- The `main.ts` wiring that sets `sessionExpired`, because importing `main.ts` mounts the app. Check it by hand.

## Manual tests

Open http://localhost:5207. To load a set of data, run this command with the layer named in the step. It restarts the app with a fresh copy of that data, so leave it running in its own terminal, and stop it or rerun it for the next layer. Logins don't carry over, so sign in again after each switch, then type the step's address into the browser.

```bash
tools/test-layers/serve-layer.sh full
```

Logins: admin `jonas.weber@example.com` / `admin-2026`, operator `lena.hartmann@example.com` / `operator-2026` (Nordwerk only), viewer `petra.koch@example.com` / `viewer-2026` (Nordwerk only). Sign in as the admin unless a step says otherwise.

In every step, the page must not show file paths, HTTP codes, internal IDs such as `halle-a`, "Failed to fetch", or a "Loading…" that never ends (wait 10 seconds).

### Missing data

| # | Layer | Do | Expected |
|---|---|---|---|
| 1 | `no-db` | Open the app. | "The service is not available right now, so we can't check your login…" with Try again, and no login form. |
| 2 | `l1-schema-only` | Sign in. | "wrong email or password". |
| 3 | `l2-users-only` | Sign in and look at the Sites page. | "No sites are assigned to your account. Ask an administrator for access." No Day control. |
| 4 | `l2-users-only` | Open `/halls/halle-a`. | "We couldn't find that hall." with a Back to Sites link. |
| 5 | `l3-sites-no-halls` | Look at the Sites page. | Each site says "This site has no halls yet." No empty tables. |
| 6 | `l4-hall-no-steps` | Look at the Sites page. | "No data has been recorded for these halls yet, so there are no costs to show." |
| 7 | `l4-hall-no-steps` | Open `/halls/halle-a`. | "No data has been recorded for this hall yet, so there is no cost to show." No "null" in the subtitle. |
| 8 | `l4-hall-no-steps` | Open `/halls/halle-a/days/2026-10-06`. | A message that there is no data or no schedules. The maintenance form still shows. |
| 9 | `l5-steps-no-schedules` | Open `/halls/halle-a`. | "This hall has no schedules yet, so there is no cost to show." No empty cost table. |
| 10 | `l6-one-hall-no-schedule` | Open `/halls/halle-a/days/2026-10-06`. | "This hall has no schedules, so there is no plan or cost to show." |
| 11 | `l6-one-hall-no-schedule` | Open `/?date=2026-10-06`. | Halle A's row says "No optimized schedule for this hall". Halle 3 and Halle 7 show costs. |
| 12 | `l7-price-null-day` | Open `/halls/halle-a/days/2026-10-06`. | "No price data for Halle A Vormontage on 6 Oct, so cost and plan can't be calculated." Links to 5 Oct and 7 Oct work. The maintenance form still shows. |
| 13 | `l7-price-null-day` | Open `/?date=2026-10-06`. | Halle A's row says "No data for this day". The other halls show costs. |
| 14 | `l8-day-removed` | Open `/halls/halle-a/days/2026-10-06`. | Same message as step 12. |
| 15 | `l9-measured-null-day` | Open `/halls/halle-a/days/2026-10-06`. | The page says sensor readings are missing and doesn't say "measured climate stayed within limits". (The "95 of 96" wording is a known open point.) |

### Dates and access

| # | Layer | Do | Expected |
|---|---|---|---|
| 16 | `full` | Open `/halls/halle-a/days/2026-10-07`. | Charts and cost load, with no notice about missing data. |
| 17 | `full` | Open `/halls/halle-a/days/2026-02-30`. | "That isn't a valid date." with a link to a day. No maintenance form. |
| 18 | `full` | Open `/halls/halle-a/days/2026-12-25`. | "There is no data for…" followed by the dates the data covers. |
| 19 | `full` | Open `/?date=2030-01-01`. | A notice giving the dates the data covers. |
| 20 | `full` | Open `/?date=garbage`. | "That isn't a valid date, so the first day with data is shown." |
| 21 | `full` | Log out, then sign in with a wrong password. | "wrong email or password". |
| 22 | `full` | Sign in as the viewer and open `/halls/halle-a`. | "We couldn't find that hall." Same as step 4. |
| 23 | `full` | As the viewer, open `/halls/halle-3/days/2026-10-07`. | "Only operators and admins can add maintenance windows." No form. |

### Saving

Use `/halls/halle-3/days/2026-10-07` on layer `full`, and start steps 24 to 35 from there. Reload the layer before this group, so no window exists yet.

| # | Do | Expected |
|---|---|---|
| 24 | Sign in as the operator. Click Add window. | "Saved." One new row, added by Lena Hartmann. |
| 25 | Click Add window again without changing anything. | "This window was already recorded by Lena Hartmann, so it was not added again." Still one row. |
| 26 | Change the asset to Boiler, then click Add window. | "Saved." Two rows. |
| 27 | Set the end before the start. | "End must be after start." Add window is disabled. |
| 28 | Set the times to 09:15 and 10:45. In a second tab, open the app and click Log out. Back in the first tab, click Add window. | Goes to the login page, which says "Your session has expired…". |
| 29 | Sign in as the operator again. | Back on the same day. Start and end show 09:15 and 10:45, with "Your entered times were restored. They have not been saved yet." |
| 30 | Reload the page. | The times go back to 06:00 and 14:00. |
| 31 | Click Log out. | Plain "Sign in to continue.", with no notice about an expired session. |

### Outage

Sign in as the admin first and stay on the day page from the group above. These two commands stop and resume the API without closing the page.

```bash
kill -STOP $(lsof -nP -t -iTCP:3107 -sTCP:LISTEN)
```

```bash
kill -CONT $(lsof -nP -t -iTCP:3107 -sTCP:LISTEN)
```

| # | Do | Expected |
|---|---|---|
| 32 | Set the asset to Chiller. Run the first command (pause). Click Add window and wait up to a minute. | The button shows "Saving…", then returns to "Add window". The message says it can't tell whether the window was saved. Existing rows stay, marked as possibly out of date. |
| 33 | Run the second command (resume). Wait 5 seconds, click Try again in the maintenance panel, then click Add window. | The list shows a Chiller row, whether from this save or the earlier one. There is never more than one Chiller row with these times. |
| 34 | Stop the API with `kill $(lsof -nP -t -iTCP:3107 -sTCP:LISTEN)`. Click the next-day button. | A plain message that the service isn't available, with Try again. |
| 35 | Reload the page. | The "service is not available" page with Try again, not the login page. |
| 36 | Restart with the `full` command above. If Try again is still showing, click it. | The login page, because the restart loads fresh data. No error text. The page may get there without a click. |

Not covered by these steps, automated tests only: a response lost at the exact moment after a save, and a corrupt database.

## Not tested in the app

- Operator login, the calendar widget's clicks, phone and tablet widths, and a real network drop. Failed saves were simulated in the browser.
- The hall page when a request fails during an outage.
