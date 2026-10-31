## What we heard on site

### Extra improvement points from initial inspection
+ Date dropdown list is ascending, earliest date shows up first in dropdown. Also, a date picker could be a better control here.
+ anchor links on mainpage list looks bad. maybe use buttons.
+ Shift information is stuck under the hall name, isn't intuitive/easy to read and clutters the view.

**Looking at a day is hard.** Operators open the day view, see the lines, and then ask
"what is the value at half past two?" They move the mouse and guess. When something looks
off they want to know all values at that moment: price, fan, damper, boiler, chiller,
temperature, CO2. One operator uses the keyboard for everything and said the chart "does
not exist" for him.

+ Using a good chart library: supporting merging charts together/isolating some charts, showing all values together somewhere around the chart. Should also support keyboard navigation natively.
+ It's a refactor. easy implementation, medium test.

**Looking at a week is impossible.** The site lead reviews schedules on Monday for the
whole week. Switching the range to seven days makes the chart unreadable and slow, and on
one machine the browser tab froze. He went back to screenshots per day.

+ Sounds easy. Haven't checked, but tab freezing sounds like a OOM issue. If that's the case, sampling can help us.
+ Easy implementation and test, high return.
+ Strong candidate for fix.

**"Where did we break the limits?"** Everyone knows bounds get violated sometimes. Nobody
can see where. The energy manager wants a list: which hall, when, how far over, and
whether somebody has already looked at it. Once a violation is explained ("visitor group,
we opened the doors") it should stop showing up as new, but stay findable. In the chart
itself she wants to see the spots, not hunt for them.

+ This is important. Better highlighting of violations on graph, and a small list of violations below the charts, showing each point, and other relevant values at the same point of time.
+ Second stage is persisting violations, giving them a central view, a notification system, an option to write notes, and mark seen/unseen.
+ First stage is a cheap win, second stage is a new feature. 1 is a candidate, 2 probably isn't.

**Interventions have no consequences.** Operators can already block an asset for
maintenance. What they cannot see is what that does to the plan. "I took the boiler out
for Thursday morning and nothing changed on screen. Is the plan still feasible? What does
it cost now?" The checker can answer this; the console does not ask it.

+ Sounds easy given checker can already provide that. Candidate.

**Shifts are not all the same.** Last month a hall had a visitor day and the plant manager
wanted 21 °C instead of 19 °C for that one shift. The only way was to edit the asset
parameters, which changed every day. Next time he wants to adjust a single shift
occurrence. During a test run the maintenance team also wanted to pin the fan at 60 % for
two hours and have the rest of the plan work around it.

+ It's a big feature. Definitely possible, but can't tell if a candidate yet.

**"Who did that?"** After a bad week the energy manager found three overrides and no idea
who set them, when, or why. She wants every intervention to carry a reason and a name. She
also wants to undo the last one quickly, and sometimes go back to how things were before
Tuesday.

+ Carrying a name is easy on db level using sth similar to hibernate envers. Showing the table on UI is straightforward.
+ Requiring a reason is a new small feature. Introduces UI guardrails.
+ Both are straightforward and candidate.

**Who may do what.** The customer's IT reviewed the console before rollout and asked for
a written answer to two questions: can a viewer or a user of another site change anything
or read anything they should not, through the screens or by calling the server directly,
and who may change the equipment parameters that every cost number depends on. They want
the answer backed by tests, not by a demo. The plant manager added that the admin should
be the only one touching parameters, and that changing them must not silently rewrite
history.

+ Must do. Security critical.

**The clock change.** On the last Sunday in October an operator entered a maintenance
window from 02:30 to 03:30 and later could not tell which 02:30 the system had taken; the
night has two of them. The window list showed "+02:00" next to "+01:00" and nobody on site
knew what that meant. The energy manager asked whether the day's cost really covers all
25 hours. Our sites are in Germany; people read local time and expect the app to handle
the odd night for them, or at least to say what it did.

+ Must do. Trivial fix.

**Empty screens and spinners.** When the price import for a day is missing, the day view
shows nothing and no explanation. When saving fails, the button just stops. People retry
and create duplicates. They told us they can live with errors as long as the app says what
happened.

+ Must do. App should handle any data and connection issues gracefully, via user friendly errors.

**New people get lost.** Every site rotates operators in, and the first week with the
console is the same every time: they land on a list of sites, click through to a hall,
click a date, and then stare at six stacked charts with no idea which one to look at first.
Nobody knows where they are in the app or how to get back. A new operator was told to
block the boiler for Thursday and could not find where maintenance windows are entered;
he looked on the hall page, gave up, and wrote it on the whiteboard instead. The site lead
now sits next to each new hire for two days and would rather not.

+ Strong candidate. Split UI into better views, each doing a simple boring job, and can be reached with a single click.

**The words mean nothing to them.** "Mass flow", "recirculation", "optimized", "allowed
band": a seasoned operator knows what these are, a new one does not, and the screen does
not help. They asked for the app to explain itself on the spot: what a number means, why
the plan looks the way it does, and what they are allowed to touch. The plant manager put
it as "I want someone to be able to use this on day one without a training session".

+ Will do. Introduce tooltips and see if that helps enough.

**Monday reporting.** The site lead compiles a weekly summary by hand: what the baseline
would have cost, what the optimized plan cost, what the plan cost after the operators'
interventions, how many hours were outside comfort bounds, and the three most expensive
intervals. He pastes it into an email. He would take a CSV; a page he can print would be
better.

+ Will do. Easy, automated task. First CSV, then to printable report.

**Two people, one hall.** Two operators on overlapping shifts both edit Thursday. One of
them loses his change without noticing. They asked whether they could at least see each
other's edits. Nobody told us what should happen when both touch the same interval; we
would like your answer and your reasoning, even if you do not build it.

+ Must do. Edits overwritten unnoticed is a real pain point. Since this is an edge case that shouldn't happen frequently, an optimistic approach should suffice. If two operators edit the same time slot, the second one to save gets a warning that someone else changed the schedule, sees what changed, and has to review it before saving, so nobody’s edit gets overwritten without noticing.

**Smaller things we noted.** Operators at two sites read German, the energy managers read
English. The tablet in the control room is 1024 pixels wide. One site pulls prices from a
market feed that is slow and sometimes down, and the admin wants to switch a site between
the imported file and that feed. The admin also wants to try a different chiller COP and
see today's cost change before saving it.

+ Localization
+ Mobile tests
+ Data source decoupling
+ Running checker with different setups (another point mentioned "seeing results before applying changes", seems like a common pain point)
