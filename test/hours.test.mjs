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
import { todayBox, spanMinutes, opensAt } from "../tools/update-today.mjs";

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
  assert.equal(r.hours, "Open tomorrow 8:00a");
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
  assert.equal(r.hours, "Open Monday 8:00a");
});

test("Sunday is closed all day and says so without a clock", () => {
  for (const t of ["06:00", "10:00", "23:00"]) {
    const r = at(t, 0);
    assert.equal(r.label, "Closed today, Sunday");
    assert.equal(r.hours, "Closed");
  }
});

test("Friday evening points at Saturday, because they are open Saturday", () => {
  assert.equal(at("18:00", 5).hours, "Open tomorrow 8:00a");
});

/* ---- harvest ------------------------------------------------------------- */

test("harvest runs seven days, so Saturday evening points at tomorrow", () => {
  const harvest = { ...H, harvest_mode: true };
  assert.equal(at("11:00", 6, harvest).label, "Harvest hours, Saturday");
  assert.equal(at("20:00", 6, harvest).hours, "Open tomorrow 8:00a",
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
  assert.equal(r.hours, "Open tomorrow 8:00a");
  const shutForever = at("17:11", 2, { ...never, today_override: "8:00a to 5:00p" });
  assert.equal(shutForever.hours, "Call for hours");
});
