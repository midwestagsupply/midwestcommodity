#!/usr/bin/env node
/* Update the "Open today" box and the notice banner in index.html.

   These are static files. The sentence "Open today, Friday, 8:00a to
   5:00p" is true on the Friday it is written and wrong every Saturday
   after, and on Sunday it says open when the elevator is closed. It is
   the biggest thing on the page and a farmer loads a truck on it.

   So a scheduled job runs this every morning. If it stops running, the
   box REMOVES ITSELF rather than going stale: a page that has not been
   rebuilt cannot know what day it is and should not pretend to. The
   weekly table underneath is always correct.

   Central time, not the runner's UTC, which would roll the day over six
   hours early and show Saturday hours all Friday evening.

   ---------------------------------------------------------------------
   CHANGED 2026-08-18, two additions. Both are about the same failure:
   something true for one day being left switched on for ever.

   1. TODAY-ONLY ANSWERS NOW EXPIRE. `closed_today` and `today_override`
      were set by hand and never cleared by anything. One Thursday
      closure told every customer the elevator was shut for the rest of
      the year, and the only cure was somebody remembering. They now
      carry the date they were set for, in `today_date`, and are ignored
      the moment that date is not today.

   2. THE NOTICE BANNER IS RENDERED HERE. It used to be written by the
      Cloudflare Worker. Two things writing one file is how a page gets
      half of each, so it moved to the job that already owns index.html.
*/
import { readFileSync, writeFileSync } from "node:fs";

/* Imported by the tests for the pure parts, and run as a script by the
   workflow. Nothing below the guard happens on import, so `todayBox` can be
   handed any clock without this file going looking for hours.json. */
const IS_SCRIPT = import.meta.url === `file://${process.argv[1]}`;

const h = IS_SCRIPT ? JSON.parse(readFileSync("hours.json", "utf8")) : {};

/* The pattern that finds the "Open today" box in index.html.

   FIXED 2026-08-19. This was `<div class="today">`, matching the tag with no
   class list after it.
     The four closed states add `is-shut` to that div. So the first time the
   box went closed, this tool wrote a div that the pattern could no longer
   find -- and String.prototype.replace against a pattern that does not match
   returns the string unchanged and throws nothing.
     From that moment the job kept running on schedule, kept computing the
   right answer, kept printing it to the log and kept exiting 0, while
   changing nothing. Both sites sat on "Closed for the day / Tomorrow 8:00a"
   from the 6:49pm run on 18 August until 8:34am the next morning -- open,
   with trucks on the road, and a green tick on every run in between. The box
   could only ever go closed once.
     The class list is optional here now, so the pattern still finds the box
   in whichever state it was last left in. Exported because the failure was
   in this regex and nothing tested it; test/hours.test.mjs holds it against
   both renderings. */
export const BOX_BLOCK = /<div class="today(?:\s[^"]*)?">[\s\S]*?<\/div>\s*<div class="hrow">/;

/* Module level because weeklyRows() below is exported and needs it, and
   because a second copy of an HTML escaper is a second one to get wrong. */
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ---- THE WEEK'S HOURS, WHICH NOTHING WAS RENDERING ----------------------
 *
 * REPORTED 2026-08-19 by Jesse Cebulla: "When I update the hours (we are not
 * open Saturdays) it is not reflected in the hours window on the site."
 *
 * He was right, and the git history of hours.json shows what it cost him:
 *
 *     e0d1f15  site: saturday closed
 *     d6ff7bc  site: saturday 8:00a to 12:00p     <- put back; nothing had happened
 *     ea641d5  site: saturday closed              <- tried again
 *
 * Somebody setting a switch, watching the page not change, setting it back to
 * be sure, and setting it again. The staff screen was saving correctly and
 * committing correctly the entire time.
 *
 * `weekday`, `saturday` and `sunday` fed exactly one thing: today's box. The
 * three rows underneath it were hand-typed HTML that nothing read hours.json
 * to produce. So closing Saturday changed nothing a customer could see on any
 * day that was not a Saturday -- and on Saturday itself the box would say
 * CLOSED TODAY directly above a table still offering 8:00a to 12:00p, which
 * is worse than either one alone.
 *
 * This is the same fault the `hoursnote` block further down already names in
 * its own comment: "a box that accepted what you typed, committed it, and
 * changed nothing on the site -- which is worse than not offering the box at
 * all." It was true of three more fields than anybody had noticed.
 *
 * HARVEST MODE DELIBERATELY DOES NOT TOUCH THIS TABLE, and neither do
 * `today_override` or `closed_today`. The note underneath reads "During
 * harvest we run X, seven days a week. Outside harvest the hours above hold",
 * so the table is the standing week and those three are exceptions to it. A
 * closure today says nothing about next Tuesday, and a table that forgot that
 * would be a new way to be wrong.
 */
export const HROWS = /<div class="hrow">[\s\S]*?<div class="hnote">/;

export function weeklyRows(h) {
  /* A day with no hours renders the word, not an empty span, and drops the
     `num` class -- "Closed" is not a figure and must not be set as one. That
     is how the Sunday row was already hand-written; this keeps it. */
  const row = (label, value) =>
    `<div class="hrow"><span>${esc(label)}</span>` +
    (value ? `<span class="num">${esc(value)}</span>` : "<span>Closed</span>") +
    "</div>";
  /* No indent on the first row: HROWS starts AT the opening tag, so the six
     spaces in front of it are already in the document and are not ours to
     write again. Getting that wrong indents one row twelve spaces and looks
     like a rendering bug on a page nobody would otherwise inspect. */
  return [row("Mon to Fri", h.weekday),
          row("Saturday", h.saturday),
          row("Sunday", h.sunday)].join("\n      ");
}

const centralNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
const dayName = new Date().toLocaleDateString("en-US", { weekday: "long", timeZone: "America/Chicago" });
const dow = centralNow.getDay();
const todayISO = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); // YYYY-MM-DD


/* ---- OPEN NOW, OR CLOSED FOR THE DAY -----------------------------------
 *
 * The box said "Open today, Tuesday 8:00a to 5:00p" at ten past five, when
 * they had been shut for ten minutes. Read at a glance that is an invitation,
 * and the cost of being wrong is lopsided: a grower who stays home because
 * the page said closed has lost an evening's convenience; one who hitches up
 * and drives out with a load because it said open has lost the evening.
 *
 *   before opening   Closed now, Tuesday / Opens 8:00a
 *   open             Open today, Tuesday / 8:00a to 5:00p     (unchanged)
 *   after closing    Closed for the day  / Open tomorrow 8:00a
 *   closed all day   Closed today, Sunday / Closed            (unchanged)
 *
 * PURE, AND EXPORTED, because this is clock arithmetic and the only way to
 * test clock arithmetic is to hand it a clock. Everything it needs is an
 * argument; it reads no file and calls no Date. The script below supplies the
 * real values once.
 *
 * It is only ever as current as the last build. The workflow rebuilds every
 * ten minutes through the trading day and every half hour outside it, so the
 * flip at closing lands within about half an hour of five. Half an hour of
 * saying "open" just after closing beats the whole evening and all night,
 * which is what it did before.
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

/* ---- everything below runs only when this file is the script ------------ */

/* Everything from here needs hours.json and index.html on disk, so it runs
   only when this file IS the script. The pure parts above import cleanly. */
if (IS_SCRIPT) {

/* A today-only answer that was about a different day is not an answer. */
let expired = false;
if ((h.closed_today || h.today_override) && h.today_date !== todayISO) {
  expired = true;
  h.closed_today = false;
  h.today_override = null;
  h.today_date = null;
}

const { label, hours, open } = todayBox(h, {
  dow, dayName, nowMins: centralNow.getHours() * 60 + centralNow.getMinutes(),
});

let html = readFileSync("index.html", "utf8");
const block = BOX_BLOCK;

/* The box removes itself when the job stops running, which assumes the job is
   the only thing that can leave it stale. A write that silently does nothing
   defeats that, so a miss stops the run instead of exiting 0 having changed
   nothing -- which is exactly how the last one went unnoticed. */
if (!block.test(html)) {
  throw new Error(
    'update-today.mjs: could not find the "Open today" box in index.html. ' +
    "Refusing to exit 0 having changed nothing.");
}

if (!hours) {
  html = html.replace(block, '<div class="hrow">');
  console.log(`no hours for ${dayName}; box removed`);
} else {
  /* A cue you can read from across the yard, before you read any words.
     The label is still there and still says it -- the colour reinforces the
     sentence, it does not replace it, which is the only way a colour is
     allowed to carry a state. */
  html = html.replace(block,
    `<div class="today${open ? "" : " is-shut"}">\n        <div class="today-lbl">${label}</div>\n` +
    `        <div class="today-hrs num">${hours}</div>\n      </div>\n      <div class="hrow">`);
  console.log(`${label}, ${hours}`);
}

/* ---- the week's hours ---------------------------------------------------
 *
 * See the note on HROWS above for why this did not exist.
 *
 * THIS ONE WARNS AND CARRIES ON WHERE THE BOX GUARD REFUSES, and the reason
 * is the shape of this file rather than a softer opinion about the table.
 * index.html is written ONCE, at the very bottom. A throw here would skip
 * that write, so a malformed hours.json or a moved <div> would take down the
 * "Open today" box, the banner and the hours note along with the table -- the
 * whole page frozen by the least important thing on it. The backstop further
 * down already settles this trade in the same words: "Trading a wrong
 * sentence for a wrong day is a bad trade."
 *
 * A warning nobody reads is how the last one hid, so these are emitted as
 * GitHub workflow annotations. They surface on the run in the Actions UI even
 * though this step carries continue-on-error, rather than sitting in a log
 * that only gets opened after somebody has already noticed. */
const missing = ["weekday", "saturday", "sunday"].filter((k) => !(k in h));
if (missing.length) {
  console.log(`::warning title=hours.json is incomplete::update-today.mjs did not ` +
    `touch the week's hours: hours.json has no ${missing.join(", ")}. The rows on ` +
    `the page are whatever was there before and nothing is maintaining them.`);
} else if (!HROWS.test(html)) {
  console.log("::warning title=weekly hour rows not found::update-today.mjs could " +
    "not find the three hrow divs in index.html, so the week's hours were not " +
    "updated. The rest of the page was. This is the fault Jesse Cebulla reported " +
    "on 2026-08-19: the office sets the hours, nothing renders them.");
} else {
  html = html.replace(HROWS, weeklyRows(h) + '\n      <div class="hnote">');
  console.log(`week: Mon-Fri ${h.weekday || "closed"}, ` +
              `Sat ${h.saturday || "closed"}, Sun ${h.sunday || "closed"}`);
}

/* ---- the banner and the harvest hours, as a backstop ---------------------
 *
 * Found live on both sites at once, in the same file one line apart:
 *
 *   badgergrain    harvest "8:00a to 7:00p"   banner "...8:00a to 8:00p..."
 *   midwest        harvest "7:00a to 7:00p"   banner "...8:00a to 7:00p..."
 *
 * Two hand-typed strings restating one fact, which drifts. A bar at the top
 * announcing one closing time while the hours below print another is the
 * difference between a truck arriving and a locked gate, and the bar is the
 * one a grower will believe.
 *
 * The real check is on the staff screen, at the moment of saving, where the
 * person who typed it is sitting there and can fix it in ten seconds. This
 * one is only for values edited straight into the file, and it WARNS rather
 * than refusing: failing here would stop the "Open today" box updating, which
 * is the one thing this script exists to keep true. Trading a wrong sentence
 * for a wrong day is a bad trade. */
const RANGE = /(\d{1,2}:\d{2}[ap])\s+to\s+(\d{1,2}:\d{2}[ap])/;
if (typeof h.banner === "string" && /harvest/i.test(h.banner) && h.harvest) {
  const m = RANGE.exec(h.banner);
  if (m && `${m[1]} to ${m[2]}` !== h.harvest) {
    console.warn("WARNING: the notice banner and the harvest hours disagree.");
    console.warn(`  banner says   ${m[1]} to ${m[2]}`);
    console.warn(`  harvest says  ${h.harvest}`);
    console.warn("  Both are on the staff screen. Whichever is wrong, a customer is");
    console.warn("  reading the banner. The page has been published as it stands.");
  }
}

/* ---- the notice banner -------------------------------------------------
   `banner` absent means nobody has ever set it through the form; leave
   whatever is on the page alone. `null` means take it down. A string means
   put it up. Absent and null are different answers and are treated as
   different answers. */
const NOTICE = /(<\/header>\n)(\n?<div class="notice">[\s\S]*?\n<\/div>\n)?/;

if ("banner" in h) {
  if (!NOTICE.test(html))
    throw new Error("could not find where the notice banner goes, just after </header>");
  const bar = h.banner
    ? `\n<div class="notice">\n  <div class="wrap">\n` +
      `    <span class="notice-tag">Notice</span>\n` +
      `    <span class="notice-msg">${esc(h.banner)}</span>\n` +
      `  </div>\n</div>\n`
    : "";
  html = html.replace(NOTICE, (_m, close) => close + bar);
  console.log(h.banner ? `banner: ${h.banner}` : "banner: hidden");
}

/* ---- the small print under the hours -----------------------------------
   Saved by the staff screen into hours.json. Without this it was a box that
   accepted what you typed, committed it, and changed nothing on the site --
   which is worse than not offering the box at all. Absent means nobody has
   set it and whatever is on the page stands; a string replaces it. */
if (typeof h.hoursnote === "string" && h.hoursnote.trim()) {
  const HNOTE = /(<div class="hnote">)[\s\S]*?(<\/div>)/;
  if (!HNOTE.test(html))
    throw new Error("could not find the note under the hours in index.html");
  html = html.replace(HNOTE, (_m, a, b) => a + esc(h.hoursnote) + b);
  console.log("hours note updated");
}

writeFileSync("index.html", html);
if (expired) {
  writeFileSync("hours.json", JSON.stringify(h, null, 2) + "\n");
  console.log("a today-only answer had gone out of date and was cleared");
}

}
