# RIZM Take-Home Challenge: Flex Operator Console

Thanks for taking the time. This folder is your workspace: work inside it and hand it
back with `./submit.sh` when you are done. Everything you need is in this file.

## What this is

**The setting.** Our customers run industrial sites with assembly halls. Each hall is
served by one air-handling unit: a fan moves air into the hall, a damper decides how much
of it is fresh outdoor air and how much is recirculated, an electric boiler can heat the
supply air and a chiller can cool it. All of that runs on electricity bought at the
day-ahead spot price, which changes throughout the day. People and machines in the hall
produce heat and CO2 during shifts, and while the hall is occupied the temperature and the
CO2 level have to stay inside a comfort band; outside the shifts the band is wider. Because
the building stores heat for hours, there is room to decide *when* to heat, cool and
ventilate, and that is where the money is.

**The optimizer.** A separate service (not part of this task) takes the prices, the
weather, the shift calendar and the hall's physics and produces a schedule: for every
15-minute interval the fan mass flow, the recirculation share, the heating power and the
cooling power. We call the price-blind rule-based schedule the *baseline* and the
optimizer's result the *optimized* schedule. A checker simulates any schedule against the
hall model and returns its cost and every violation of a comfort or equipment limit; the
same checker is in this repo at `server/checker/` and is the single source of truth for
cost and feasibility.

**The console.** The Flex Operator Console is the web app the people on site use to work
with those schedules. Operators on shift look at today's plan and intervene when reality
changes (a boiler goes into maintenance, a visitor group needs a warmer hall, a test run
needs the fan at a fixed level). The energy manager checks where comfort limits were
broken and why. The site lead reviews the week and reports savings on Monday. An admin
looks after users and the equipment parameters that every cost number depends on.

**What the app does today.** It has a login with four seeded users (see `SEED_USERS.md`:
an admin, two operators on different sites, one viewer), a site list showing each hall's
energy cost for a chosen day, a day view per hall that charts the spot price, the four
controls and the simulated indoor temperature and CO2 of either schedule next to the
day's cost, and a form to record maintenance windows per asset. Users only see the sites
they are assigned to.

**The data.** Two fictional sites in Germany, three halls, 30 days of 15-minute data from
5 October to 3 November 2026: spot prices, outdoor temperature, internal heat and CO2
generation, occupancy, the comfort bounds per interval, the baseline and the optimized
schedule, and the *measured* indoor temperature and CO2 that the sensors actually recorded
during that period. The clocks went back on 25 October, so that day has 25 hours. The
shift pattern is two weekday shifts, 06:00–14:00 and 14:00–22:00 local time.

**How it is built.** Vue 3 with TypeScript, Vite, Pinia and Vue Router on the client; a
Node API in TypeScript with SQLite on the server; everything local. The app was built
quickly, in increments, to get something in front of users. It runs with `npm install`,
`npm run seed`, `npm run dev`, needs nothing but Node 22.12 or newer, and makes no network
calls.

Below are our notes from the last round of site visits. They are observations, not a
specification. Your job is to decide what the console should do about them, build the
parts you consider most valuable, and tell us what you left out and why. You will not
finish everything. We want to see what you pick.

## What we heard on site

**Looking at a day is hard.** Operators open the day view, see the lines, and then ask
"what is the value at half past two?" They move the mouse and guess. When something looks
off they want to know all values at that moment: price, fan, damper, boiler, chiller,
temperature, CO2. One operator uses the keyboard for everything and said the chart "does
not exist" for him.

**Looking at a week is impossible.** The site lead reviews schedules on Monday for the
whole week. Switching the range to seven days makes the chart unreadable and slow, and on
one machine the browser tab froze. He went back to screenshots per day.

**"Where did we break the limits?"** Everyone knows bounds get violated sometimes. Nobody
can see where. The energy manager wants a list: which hall, when, how far over, and
whether somebody has already looked at it. Once a violation is explained ("visitor group,
we opened the doors") it should stop showing up as new, but stay findable. In the chart
itself she wants to see the spots, not hunt for them.

**Interventions have no consequences.** Operators can already block an asset for
maintenance. What they cannot see is what that does to the plan. "I took the boiler out
for Thursday morning and nothing changed on screen. Is the plan still feasible? What does
it cost now?" The checker can answer this; the console does not ask it.

**Shifts are not all the same.** Last month a hall had a visitor day and the plant manager
wanted 21 °C instead of 19 °C for that one shift. The only way was to edit the asset
parameters, which changed every day. Next time he wants to adjust a single shift
occurrence. During a test run the maintenance team also wanted to pin the fan at 60 % for
two hours and have the rest of the plan work around it.

**"Who did that?"** After a bad week the energy manager found three overrides and no idea
who set them, when, or why. She wants every intervention to carry a reason and a name. She
also wants to undo the last one quickly, and sometimes go back to how things were before
Tuesday.

**Who may do what.** The customer's IT reviewed the console before rollout and asked for
a written answer to two questions: can a viewer or a user of another site change anything
or read anything they should not, through the screens or by calling the server directly,
and who may change the equipment parameters that every cost number depends on. They want
the answer backed by tests, not by a demo. The plant manager added that the admin should
be the only one touching parameters, and that changing them must not silently rewrite
history.

**The clock change.** On the last Sunday in October an operator entered a maintenance
window from 02:30 to 03:30 and later could not tell which 02:30 the system had taken; the
night has two of them. The window list showed "+02:00" next to "+01:00" and nobody on site
knew what that meant. The energy manager asked whether the day's cost really covers all
25 hours. Our sites are in Germany; people read local time and expect the app to handle
the odd night for them, or at least to say what it did.

**Empty screens and spinners.** When the price import for a day is missing, the day view
shows nothing and no explanation. When saving fails, the button just stops. People retry
and create duplicates. They told us they can live with errors as long as the app says what
happened.

**New people get lost.** Every site rotates operators in, and the first week with the
console is the same every time: they land on a list of sites, click through to a hall,
click a date, and then stare at six stacked charts with no idea which one to look at first.
Nobody knows where they are in the app or how to get back. A new operator was told to
block the boiler for Thursday and could not find where maintenance windows are entered;
he looked on the hall page, gave up, and wrote it on the whiteboard instead. The site lead
now sits next to each new hire for two days and would rather not.

**The words mean nothing to them.** "Mass flow", "recirculation", "optimized", "allowed
band": a seasoned operator knows what these are, a new one does not, and the screen does
not help. They asked for the app to explain itself on the spot: what a number means, why
the plan looks the way it does, and what they are allowed to touch. The plant manager put
it as "I want someone to be able to use this on day one without a training session".

**Monday reporting.** The site lead compiles a weekly summary by hand: what the baseline
would have cost, what the optimized plan cost, what the plan cost after the operators'
interventions, how many hours were outside comfort bounds, and the three most expensive
intervals. He pastes it into an email. He would take a CSV; a page he can print would be
better.

**Two people, one hall.** Two operators on overlapping shifts both edit Thursday. One of
them loses his change without noticing. They asked whether they could at least see each
other's edits. Nobody told us what should happen when both touch the same interval; we
would like your answer and your reasoning, even if you do not build it.

**Smaller things we noted.** Operators at two sites read German, the energy managers read
English. The tablet in the control room is 1024 pixels wide. One site pulls prices from a
market feed that is slow and sometimes down, and the admin wants to switch a site between
the imported file and that feed. The admin also wants to try a different chiller COP and
see today's cost change before saving it.

## What we expect from you

The starter app is not finished and not everything in it is good. You will find things you
disagree with. Decide what to fix, what to build on and what to leave, and tell us.

Hand in:

- The code, with the existing tests still passing and your own tests where they earn their place.
- A one-page architecture decision record for the one decision you consider most consequential: the options you saw, the one you took, what it costs, and what you would change at ten times the data or the users.
- A decision note: what you built, what you left out and why, the assumptions you made where the notes above were silent, and what a reviewer should still look at even though everything runs.
- Three screenshots with a sentence each on why the screen looks the way it does for the person using it.
- A two to three minute screen recording with your voice, walking through the result.
- Your AI session logs via `./submit.sh` (see below).

Use whatever tools you like, including AI coding agents. We read the transcripts with the
same interest as the code, and in the follow-up interview we will ask you to extend your
own solution live. Be able to explain every line you hand in.

Keep the stack as shipped: Vue 3, TypeScript, Pinia, Vue Router, the bundled chart library,
Node and SQLite. Small additional dependencies are fine; replacing the framework, the store,
the chart library or the database is not. The app must still run locally with the three
commands above and must not require network access.

## AI tools

Use whatever you want: Claude Code, Codex, Cursor, Copilot, Gemini, ChatGPT, nothing at
all. There is no right amount. We are as interested in how you direct these tools as in
the result, which is why this folder records your sessions. If your sessions are not 
automatically recorded make sure that you hand them in via a manual way. We will consider 
not handed in logs as a not completed task.

If agentic coding is new to you and you want to use it, take the time to learn it and set
it up the way you like before you start. You should stay in control of the work, not hand
it over.

We know what these tools can do on their own; that is not what we are grading. We look for
where you bring your own judgment and ideas into the process, especially where the tools
are weak, and how you steer them to get there.

## We record your AI coding sessions

**Please read this before you start.**

This folder contains hook configurations for **Claude Code, Codex CLI, Cursor, GitHub
Copilot CLI and Gemini CLI**. While you work inside this folder, each tool's full session
transcript is copied into the hidden `.logs/` folder: your prompts, the model's replies,
tool calls and file edits, with timestamps. The folder is gitignored and only leaves your
machine inside the zip that `./submit.sh` builds for you to upload.

**Why we do this.** We read the logs alongside your code to understand how you work: how
you break down the problem, what you ask, what you accept and what you push back on.

**What happens with the data.** The logs are used only for this hiring process and are
read only by the people involved in it. We delete them, together with your submission,
six months after the process ends, in line with German employment law. They are never
used for anything else, in particular not for training models.

**What we ask of you.**

- Work inside this folder. Sessions started elsewhere are not collected.
- If you use a web chat (ChatGPT, claude.ai, Gemini or similar), export or paste the
  conversation into `.logs/manual/`. Any format works; one file per conversation is ideal.
- If a transcript contains something private, such as a secret or a message about an
  unrelated project, remove that line and leave the rest. Please do not delete whole
  sessions. `./submit.sh` also masks values that look like API keys automatically.
- Run `./submit.sh` at the end. It shows you exactly what will be included before it
  builds the zip.

**How it works.** The whole mechanism is in [`tools/ai-logs/`](tools/ai-logs/README.md),
a few hundred lines of Python with no dependencies. It only reads the tools' own local
session stores and never uploads anything. Read it if you like.

**If a tool asks you to trust this folder's hooks** (Claude Code, Codex and Cursor do
this on first use), say yes so the live logging works. If you decline, nothing breaks:
`./submit.sh` still finds the sessions from the tools' local stores afterwards.

## Handing in

Requirements: Python 3.13 or newer on your `PATH` as `python3` or `python`.

```sh
./submit.sh
```

The script collects your AI sessions, lists them, asks whether you used a web chat,
writes `.logs/manifest.json` with a checksum per file, and creates
`submission-<folder>-<date>.zip` in this folder. Upload that zip on your challenge page
in the RIZM Operation Center. Do not push `.logs/` to a public repository.

To see what has been collected so far at any time:

```sh
python3 tools/ai-logs/collect.py status
```

## Questions

Reply to the e-mail that brought you here. We answer quickly.
