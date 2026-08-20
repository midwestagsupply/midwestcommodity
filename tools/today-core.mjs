/* THE DECISION, AND NOTHING ELSE. ONE COPY, TWO RUNTIMES.
 *
 * Added 2026-08-20. This code used to live inside update-today.mjs, which is
 * the right place for it as long as the only thing that ever asks "are we open
 * right now" is a build. That stopped being true today.
 *
 * WHY IT MOVED. The box is a sentence baked into a static file, so it can only
 * change when a job runs. That job is a GitHub cron, and GitHub crons are
 * best effort. On the morning of 2026-08-20 badgergrain's last build was
 * 12:01 UTC and midwestcommodity's was 14:10 UTC -- identical workflow files,
 * identical crons, one landed and one did not. So at 9:15 Central, with the
 * yard open and trucks on the road, one site said "Closed now, Thursday.
 * Opens 8:00a" and the other said "Open today, Thursday".
 *
 * Nothing was broken. `node --test` passed 118, and running this very code
 * against the live page produced exactly the right answer. The build simply
 * had not happened, and no amount of correctness in a build can survive a
 * build that does not run.
 *
 * So the page now works it out in the browser as well, from the same clock the
 * customer is standing in. THIS FILE IS THE ONLY COPY OF THE RULE: the build
 * imports it, and the build also INLINES ITS SOURCE TEXT into the page inside
 * a <script>. There is no second implementation to drift, because there is no
 * second implementation -- one file, read twice.
 *
 * CONSTRAINTS THIS FILE HAS TO KEEP, because its text is executed in a browser:
 *   - no imports, no require, nothing from node:*
 *   - no reference to `process`, `fs`, or `import.meta`
 *   - no syntax past ES2017; the build strips the word `export ` and that is
 *     the ONLY transformation it applies
 *   - it must not call `new Date()` or read a clock. Everything is an argument.
 *     That is what makes it testable, and it is why the fault it exists to fix
 *     was findable at all.
 * test/hours.test.mjs holds every one of those.
 */

export const DAY_NAMES =
  ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* "8:00a to 5:00p" -> [480, 1020], minutes since midnight. null on anything
   it does not recognise, and the caller then leaves the box as it was rather
   than guessing: an unparseable span is not a licence to invent an opening
   time. */
export function spanMinutes(text) {
  const m = /^(\d{1,2}):(\d{2})([ap])\s+to\s+(\d{1,2}):(\d{2})([ap])$/i
    .exec(String(text ?? "").trim());
  if (!m) return null;
  const mins = (hh, mm, ap) => {
    let hr = +hh % 12;
    if (ap.toLowerCase() === "p") hr += 12;
    return hr * 60 + +mm;
  };
  const open = mins(m[1], m[2], m[3]), close = mins(m[4], m[5], m[6]);
  /* A span that ends before it starts is not a day, it is a typo. Refuse it
     rather than declare the elevator shut since breakfast. */
  return close > open ? [open, close] : null;
}

export const opensAt = (text) =>
  spanMinutes(text) ? String(text).split(/\s+to\s+/i)[0] : null;

/* Is the yard open right this minute? Returned alongside the words so the
   page can carry a visual cue as well as a sentence -- see the note on
   `is-shut` in the renderer below. */
export function todayBox(h, { dow, dayName, nowMins }) {
  const hoursOn = (d) =>
    h.harvest_mode ? h.harvest : d === 0 ? h.sunday : d === 6 ? h.saturday : h.weekday;

  let label, hours;
  if (h.closed_today)        { label = `Closed today, ${dayName}`;  hours = "Closed"; }
  else if (h.today_override) { label = `Open today, ${dayName}`;    hours = h.today_override; }
  else if (h.harvest_mode)   { label = `Harvest hours, ${dayName}`; hours = h.harvest; }
  else                       { label = `Open today, ${dayName}`;    hours = hoursOn(dow); }
  if (!h.closed_today && !h.today_override && !h.harvest_mode && !hoursOn(dow)) {
    label = `Closed today, ${dayName}`; hours = "Closed";
  }

  /* Now put the clock to it, INCLUDING a today-override.
     This first excluded overrides on the reasoning that they are a deliberate
     statement by the office. That confused two things. The office decides
     today's SPAN; it does not thereby claim to be open at five past five. An
     override of "9:00a to 1:00p" read "Open today" all afternoon, which is
     the very fault this was written to fix, on the one day somebody had gone
     to the trouble of saying the hours were different. */
  const span = h.closed_today ? null : spanMinutes(hours);
  if (span) {
    const [open, close] = span;
    if (nowMins < open) {
      label = `Closed now, ${dayName}`;
      hours = `Opens ${opensAt(hours)}`;
    } else if (nowMins >= close) {
      let next = null;
      for (let i = 1; i <= 7 && !next; i++) {
        const d = (dow + i) % 7;
        const hrs = hoursOn(d);
        if (hrs) next = { hours: hrs, tomorrow: i === 1, name: DAY_NAMES[d] };
      }
      /* SHORT ENOUGH FOR THE BOX IT GOES IN.
         `.today-hrs` is the biggest type on the page and it is sized for
         "8:00a to 5:00p" -- fourteen characters. "Open tomorrow 8:00a" is
         nineteen, and it burst the panel and put a scrollbar under it.
         Dropping the word "Open" costs nothing: the line directly above
         already says "Closed for the day", so "Tomorrow 8:00a" reads exactly
         as intended and is no longer than the Saturday hours the box has
         always rendered. There is a test that keeps it that way. */
      label = "Closed for the day";
      hours = next
        ? `${next.tomorrow ? "Tomorrow" : next.name} ${opensAt(next.hours) ?? ""}`.trim()
        : "Call for hours";
    }
  }
  /* Open is the ordinary state and keeps the yellow. Shut is not an alarm --
     five o'clock on a Tuesday is not an emergency -- so it goes MUTED rather
     than red. Red is for something being wrong, and spending it on "we are
     closed, as we are every night" is how a warning colour stops meaning
     anything. */
  const open = !/^Closed/.test(label);
  return { label, hours, open };
}

/* A TODAY-ONLY ANSWER THAT WAS ABOUT A DIFFERENT DAY IS NOT AN ANSWER.
 *
 * `closed_today` and `today_override` are set by hand and nothing clears them.
 * One Thursday closure once told every customer the elevator was shut for the
 * rest of the year. They carry the date they were set for, in `today_date`,
 * and are ignored the moment that date is not today.
 *
 * THE BROWSER NEEDS THIS TOO, and that is not a nicety. A page cached on
 * Thursday and reopened on Friday carries Thursday's `closed_today: true`. The
 * build expired it correctly on Thursday; only the reader knows it is Friday.
 * Mutates in place and returns whether it did, because both callers want to
 * say so. */
export function expireToday(h, todayISO) {
  if ((h.closed_today || h.today_override) && h.today_date !== todayISO) {
    h.closed_today = false;
    h.today_override = null;
    h.today_date = null;
    return true;
  }
  return false;
}

/* HOW LONG UNTIL THE BOX COULD NEED TO CHANGE?
 *
 * The box is accurate to the minute, so it repaints on the minute. Sleeping
 * thirty seconds would be simpler and would land the eight o'clock flip up to
 * thirty seconds late; at the other end of the day that is thirty seconds of a
 * page telling a driver the gate is open after it has shut.
 *
 * THE EXTRA SECOND IS NOT PADDING. Firing exactly on the boundary means a
 * clock a hair fast repaints while it still reads 07:59, schedules the next
 * tick from there, and can land the following one at 08:00:59 -- so the flip
 * that was supposed to be instant is nearly a minute late. A second past the
 * minute costs nothing and cannot do that.
 *
 * Lives here rather than inline in the generated script so it can be tested
 * without a browser, like every other rule the box depends on.
 */
export function msToNextMinute(nowMs) {
  if (!Number.isFinite(nowMs)) return 60000;
  return 60000 - (((nowMs % 60000) + 60000) % 60000) + 1000;
}
