/* The "Open today" box, against a clock.
 *
 * It said "Open today, Tuesday 8:00a to 5:00p" at ten past five, when they
 * had been shut for ten minutes. The cost of that is lopsided: a grower who
 * stays home because the page said closed has lost some convenience; one who
 * hitches up and drives out with a load because it said open has lost the
 * evening.
 *
 * The decision is a pure function precisely so it can be tested against a
 * clock rather than around one. Nothing here mocks a Date.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { todayBox, spanMinutes, opensAt, BOX_BLOCK, HROWS, weeklyRows }
  from "../tools/update-today.mjs";

const H = {
  weekday: "8:00a to 5:00p", saturday: "8:00a to 12:00p", sunday: null,
  harvest: "8:00a to 7:00p", harvest_mode: false, closed_today: false,
  today_override: null,
};
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const at = (hhmm, dow = 2, h = H) => {
  const [hh, mm] = hhmm.split(":").map(Number);
  return todayBox(h, { dow, dayName: DAYS[dow], nowMins: hh * 60 + mm });
};

/* ---- the edges of the day ------------------------------------------------ */

test("AT TEN PAST FIVE IT SAYS CLOSED, NOT OPEN", () => {
  const r = at("17:11");
  assert.equal(r.label, "Closed for the day");
  assert.equal(r.hours, "Tomorrow 8:00a");
});

test("the flip is exactly at closing time, not a minute either side", () => {
  assert.equal(at("16:59").label, "Open today, Tuesday");
  assert.equal(at("17:00").label, "Closed for the day", "5:00p is closed, not open");
});

test("before opening it says when it opens, not that it is shut for good", () => {
  const r = at("06:30");
  assert.equal(r.label, "Closed now, Tuesday");
  assert.equal(r.hours, "Opens 8:00a");
  assert.equal(at("08:00").label, "Open today, Tuesday", "and opening time is open");
});

test("during the day nothing changed", () => {
  const r = at("11:00");
  assert.equal(r.label, "Open today, Tuesday");
  assert.equal(r.hours, "8:00a to 5:00p");
});

/* ---- which day comes next ------------------------------------------------ */

test("SATURDAY AFTERNOON POINTS AT MONDAY, NOT AT SUNDAY", () => {
  /* They shut at noon on Saturday and do not open on Sunday. "Open tomorrow"
     would send somebody out to a locked gate on the one day of the week the
     yard is definitely empty. */
  const r = at("13:00", 6);
  assert.equal(r.label, "Closed for the day");
  assert.equal(r.hours, "Monday 8:00a");
});

test("Sunday is closed all day and says so without a clock", () => {
  for (const t of ["06:00", "10:00", "23:00"]) {
    const r = at(t, 0);
    assert.equal(r.label, "Closed today, Sunday");
    assert.equal(r.hours, "Closed");
  }
});

test("Friday evening points at Saturday, because they are open Saturday", () => {
  assert.equal(at("18:00", 5).hours, "Tomorrow 8:00a");
});

/* ---- harvest ------------------------------------------------------------- */

test("harvest runs seven days, so Saturday evening points at tomorrow", () => {
  const harvest = { ...H, harvest_mode: true };
  assert.equal(at("11:00", 6, harvest).label, "Harvest hours, Saturday");
  assert.equal(at("20:00", 6, harvest).hours, "Tomorrow 8:00a",
    "not Monday: during harvest they are open on Sunday");
});

test("harvest is open until seven, not until five", () => {
  const harvest = { ...H, harvest_mode: true };
  assert.equal(at("17:30", 2, harvest).label, "Harvest hours, Tuesday");
  assert.equal(at("19:00", 2, harvest).label, "Closed for the day");
});

/* ---- a day the office set by hand ---------------------------------------- */

test("AN OVERRIDE GETS THE CLOCK TOO", () => {
  /* This first excluded overrides, on the reasoning that they are a
     deliberate statement by the office. That confused two things: the office
     decides today's SPAN, it does not thereby claim to be open at five past
     five. An override of 9 to 1 read "Open today" all afternoon -- the very
     fault this exists to fix, on the one day somebody had gone to the trouble
     of saying the hours were different. */
  const odd = { ...H, today_override: "9:00a to 1:00p" };
  assert.equal(at("10:00", 2, odd).hours, "9:00a to 1:00p");
  assert.equal(at("10:00", 2, odd).label, "Open today, Tuesday");
  assert.equal(at("17:11", 2, odd).label, "Closed for the day");
  assert.equal(at("08:00", 2, odd).hours, "Opens 9:00a");
});

test("closed today beats the clock entirely", () => {
  const shut = { ...H, closed_today: true };
  for (const t of ["06:00", "12:00", "22:00"]) {
    assert.equal(at(t, 2, shut).label, "Closed today, Tuesday");
    assert.equal(at(t, 2, shut).hours, "Closed");
  }
});

/* ---- refusing to guess --------------------------------------------------- */

test("A SPAN IT CANNOT READ LEAVES THE BOX ALONE RATHER THAN INVENTING ONE", () => {
  for (const bad of ["dawn to dusk", "8-5", "", null, undefined, "8:00a"]) {
    assert.equal(spanMinutes(bad), null, JSON.stringify(bad));
    const r = at("17:11", 2, { ...H, weekday: bad });
    assert.doesNotMatch(String(r.hours), /Opens|tomorrow/,
      "an unreadable span is not a licence to invent an opening time");
  }
});

test("a span that ends before it starts is a typo, not a day", () => {
  /* "5:00p to 8:00a" would otherwise read as closed since breakfast. */
  assert.equal(spanMinutes("5:00p to 8:00a"), null);
  assert.deepEqual(spanMinutes("8:00a to 5:00p"), [480, 1020]);
  assert.deepEqual(spanMinutes("12:00a to 12:00p"), [0, 720]);
});

test("midnight and noon are read the way people say them", () => {
  assert.equal(opensAt("12:00a to 12:00p"), "12:00a");
  assert.equal(opensAt("8:00a to 5:00p"), "8:00a");
  assert.equal(opensAt("nonsense"), null);
});

test("a week with no open day at all says call, and does not loop", () => {
  const never = { ...H, weekday: null, saturday: null, sunday: null };
  const r = at("17:11", 2, { ...never, weekday: "8:00a to 5:00p" });
  assert.equal(r.hours, "Tomorrow 8:00a");
  const shutForever = at("17:11", 2, { ...never, today_override: "8:00a to 5:00p" });
  assert.equal(shutForever.hours, "Call for hours");
});

test("NOTHING IT PRINTS IS LONGER THAN WHAT THE BOX ALREADY RENDERS", () => {
  /* `.today-hrs` is the biggest type on the page, sized for "8:00a to 5:00p".
     "Open tomorrow 8:00a" burst the panel and put a scrollbar under it. The
     ceiling is the Saturday hours, which that box has rendered since the day
     it was built, so anything at or under that length is safe by
     construction rather than by looking at it. */
  const CEILING = "8:00a to 12:00p".length;          // 15
  const H2 = { ...H, weekday: "8:00a to 5:00p" };
  const seen = new Set();
  for (let dow = 0; dow < 7; dow++)
    for (const harvest of [false, true])
      for (const t of ["06:00", "09:00", "12:30", "17:30", "19:30", "23:00"])
        seen.add(at(t, dow, { ...H2, harvest_mode: harvest }).hours);

  for (const v of seen)
    assert.ok(String(v).length <= CEILING,
      `"${v}" is ${String(v).length} characters; the box fits ${CEILING}`);
  assert.ok(seen.has("Tomorrow 8:00a") && seen.has("Monday 8:00a"),
    "and the cases that matter are actually in the set");
});

test("the label above it carries the word the hours line dropped", () => {
  /* "Tomorrow 8:00a" only reads correctly because "Closed for the day" is
     directly above it. If that ever changes, this fails. */
  const r = at("17:11");
  assert.equal(r.label, "Closed for the day");
  assert.doesNotMatch(r.hours, /Open/);
});

/* ---- the visual cue ------------------------------------------------------ */

test("OPEN AND SHUT ARE DISTINGUISHABLE BEFORE YOU READ A WORD", () => {
  /* The hours box is the brightest thing on the page and it stayed bright
     whether the yard was open or shut. The words changed; the colour did not,
     and the colour is what a grower takes in first from a phone on a
     dashboard. */
  assert.equal(at("11:00", 2).open, true);
  assert.equal(at("06:30", 2).open, false, "before opening");
  assert.equal(at("17:11", 2).open, false, "after closing");
  assert.equal(at("10:00", 0).open, false, "closed all day");
  assert.equal(at("11:00", 6).open, true, "Saturday morning");
  assert.equal(at("11:00", 2, { ...H, closed_today: true }).open, false);
  assert.equal(at("18:00", 2, { ...H, harvest_mode: true }).open, true,
    "harvest runs to seven");
});

test("...and the words still say it, so the colour is never carrying it alone", () => {
  /* A colour that is the only thing telling you the yard is shut fails for
     anyone who cannot see the difference, on a bright dashboard, or in
     print. The sentence is the meaning; the colour is the cue. */
  for (const [t, d] of [["06:30", 2], ["17:11", 2], ["13:00", 6], ["10:00", 0]]) {
    const r = at(t, d);
    assert.equal(r.open, false);
    assert.match(r.label, /^Closed/, `${t} must say so in words as well`);
  }
});

/* The box has to be findable in the state it was last left in.
 *
 * The pattern that finds it used to be `<div class="today">` exactly. Every
 * closed state renders `<div class="today is-shut">`, so once the box had
 * gone closed once, the pattern missed, replace() returned the page
 * unchanged, and the job went on exiting 0 with the wrong day on the page
 * for as long as nobody looked. These are the two renderings it must find.
 */
test("the box pattern finds the box in both renderings", () => {
  const page = (cls) =>
    `<div class="${cls}">\n        <div class="today-lbl">x</div>\n` +
    `        <div class="today-hrs num">y</div>\n      </div>\n      <div class="hrow">`;
  assert.ok(BOX_BLOCK.test(page("today")), "open rendering");
  assert.ok(BOX_BLOCK.test(page("today is-shut")), "closed rendering");
});

test("a closed box can be rewritten a second time", () => {
  /* The regression itself: render closed, then find it again. */
  const closed =
    '<div class="today is-shut">\n        <div class="today-lbl">Closed for the day</div>\n' +
    '        <div class="today-hrs num">Tomorrow 8:00a</div>\n      </div>\n      <div class="hrow">';
  const reopened = closed.replace(BOX_BLOCK,
    '<div class="today">\n        <div class="today-lbl">Open today, Wednesday</div>\n' +
    '        <div class="today-hrs num">8:00a to 5:00p</div>\n      </div>\n      <div class="hrow">');
  assert.notEqual(reopened, closed, "replace must not be a silent no-op");
  assert.match(reopened, /Open today, Wednesday/);
  assert.doesNotMatch(reopened, /is-shut/);
});

/* ---- THE WEEK'S HOURS ----------------------------------------------------
 *
 * Reported 2026-08-19 by Jesse Cebulla: setting Saturday closed changed
 * nothing on the page. It changed nothing because nothing rendered these
 * three rows -- `weekday`, `saturday` and `sunday` fed today's box and
 * stopped there. These are the tests that would have caught it, which is the
 * reason to write them now rather than only the fix.
 */
const PAGE = (sat = '<span class="num">8:00a to 12:00p</span>') =>
  '      <div class="today">\n        <div class="today-lbl">Open today, Wednesday</div>\n' +
  '        <div class="today-hrs num">8:00a to 5:00p</div>\n      </div>\n' +
  '      <div class="hrow"><span>Mon to Fri</span><span class="num">8:00a to 5:00p</span></div>\n' +
  `      <div class="hrow"><span>Saturday</span>${sat}</div>\n` +
  '      <div class="hrow"><span>Sunday</span><span>Closed</span></div>\n' +
  '      <div class="hnote">During harvest we run 8:00a to 7:00p.</div>\n';

const render = (h, page = PAGE()) =>
  page.replace(HROWS, weeklyRows(h) + '\n      <div class="hnote">');

test("CLOSING SATURDAY CLOSES SATURDAY ON THE PAGE", () => {
  /* Jesse's report, end to end: the page offers Saturday morning, the file
     says there is no Saturday, and the file wins. */
  const before = PAGE();
  assert.match(before, /Saturday<\/span><span class="num">8:00a to 12:00p/);
  const after = render({ ...H, saturday: null });
  assert.notEqual(after, before, "the replace must not be a silent no-op");
  assert.match(after, /<span>Saturday<\/span><span>Closed<\/span>/);
  assert.doesNotMatch(after, /8:00a to 12:00p/, "the old row is gone, not merely hidden");
});

test("a day that IS open keeps its hours and is set as a figure", () => {
  const out = render({ ...H, saturday: "8:00a to 12:00p" });
  assert.match(out, /<span>Saturday<\/span><span class="num">8:00a to 12:00p<\/span>/);
});

test('"Closed" is not a figure, so it does not carry the num class', () => {
  /* .num is tabular-lining numerals. Setting a word in them is wrong, and it
     is how the Sunday row was already hand-written. */
  const out = weeklyRows({ ...H, sunday: null });
  assert.match(out, /<span>Sunday<\/span><span>Closed<\/span>/);
  assert.doesNotMatch(out, /class="num">Closed/);
});

test("all three rows come from the file, not from the page", () => {
  const out = weeklyRows({ weekday: "7:00a to 6:00p", saturday: "9:00a to 1:00p", sunday: "1:00p to 4:00p" });
  assert.match(out, /Mon to Fri<\/span><span class="num">7:00a to 6:00p/);
  assert.match(out, /Saturday<\/span><span class="num">9:00a to 1:00p/);
  assert.match(out, /Sunday<\/span><span class="num">1:00p to 4:00p/);
});

test("rendering twice gives the same page", () => {
  /* The box regression was a replace that stopped matching what it had just
     written. Hold this pattern to the same standard. */
  const once = render({ ...H, saturday: null });
  const twice = render({ ...H, saturday: null }, once);
  assert.equal(twice, once);
  assert.equal((once.match(/class="hrow"/g) || []).length, 3, "still three rows, not six");
});

test("HARVEST MODE DOES NOT REWRITE THE STANDING WEEK", () => {
  /* The note underneath says "During harvest we run X, seven days a week.
     Outside harvest the hours above hold." The table is the standing week
     and harvest is the exception to it; a table that forgot that would be a
     new way to be wrong. */
  const normal = weeklyRows({ ...H, saturday: null });
  assert.equal(weeklyRows({ ...H, saturday: null, harvest_mode: true, harvest: "7:00a to 7:00p" }), normal);
});

test("a closure today says nothing about next Tuesday", () => {
  const normal = weeklyRows(H);
  assert.equal(weeklyRows({ ...H, closed_today: true }), normal);
  assert.equal(weeklyRows({ ...H, today_override: "9:00a to 1:00p" }), normal);
});

test("the row pattern finds the rows whether or not the box is above them", () => {
  /* When the job cannot compute a day it REMOVES the box, leaving the first
     hrow's opening tag where the box used to be. The rows still have to be
     findable in that state. */
  const boxless = PAGE().replace(/ *<div class="today">[\s\S]*?<\/div>\n(?=      <div class="hrow">)/, "");
  assert.ok(HROWS.test(boxless), "findable with no box above");
  assert.match(render({ ...H, saturday: null }, boxless), /<span>Saturday<\/span><span>Closed<\/span>/);
});

test("a value from the file is escaped, not injected", () => {
  assert.match(weeklyRows({ ...H, saturday: '8a <script>x</script>' }),
    /8a &lt;script&gt;x&lt;\/script&gt;/);
});
