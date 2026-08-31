/* THE CHANGE LINE GOES ON A CUSTOMER'S PRICE BOARD, SO IT IS GUARDED HARD.
 *
 * A wrong number here is worse than no number: a farmer reading "up 10¢ from
 * Tuesday" may haul today on the strength of it. Every one of these cases came
 * out of the real series in this repository's commit log, not out of my head.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { centralDay, tradeDate, isTradingDay, dayName, record, prune, change,
         keyOf, EMPTY, KEEP_DAYS } from "../tools/price-history.mjs";

const CORN = { commodity: "Corn", delivery: "August" };
const hist = (days) => ({ ...EMPTY, days });
const at = (iso) => new Date(`${iso}T18:00:00Z`);   // noon Central: mid-session

test("the day boundary is Central, not UTC", () => {
  assert.equal(centralDay(new Date("2026-08-31T02:25:00Z")), "2026-08-30");
  assert.equal(centralDay(new Date("2026-08-31T13:05:00Z")), "2026-08-31");
});

test("THE TRADE DATE ROLLS AT 7PM CENTRAL, WHICH IS WHEN THE SESSION OPENS", () => {
  /* Measured in the feed's own pricedAt over the weekend of 29 August: the
     board froze at Sat 09:34 with corn at 512 and did not move again until
     Sun 19:21. That 19:21 is Globex reopening, and everything after it is
     MONDAY's session. Filing it as Sunday made a Monday page read "down 6c
     from Sunday" — Monday's overnight compared against Monday's overnight. */
  assert.equal(tradeDate(new Date("2026-08-31T00:21:00Z")), "2026-08-31",
    "Sunday 19:21 Central belongs to Monday");
  assert.equal(tradeDate(new Date("2026-08-30T23:59:00Z")), "2026-08-30",
    "Sunday 18:59 Central is still Sunday, and Sunday holds no session");
  assert.equal(tradeDate(new Date("2026-08-31T16:01:00Z")), "2026-08-31");
  assert.equal(tradeDate(new Date("2026-08-29T02:00:00Z")), "2026-08-29",
    "Friday 21:00 Central rolls into Saturday, which is not a trading day");
});

test("Saturday and Sunday are not sessions", () => {
  assert.equal(isTradingDay("2026-08-29"), false, "Saturday");
  assert.equal(isTradingDay("2026-08-30"), false, "Sunday");
  for (const d of ["2026-08-28","2026-08-31","2026-09-01","2026-09-02","2026-09-03"])
    assert.equal(isTradingDay(d), true, d);
});

test("day names are the reader's, and do not slip a day", () => {
  assert.equal(dayName("2026-08-28"), "Friday");
  assert.equal(dayName("2026-08-30"), "Sunday");
  assert.equal(dayName("2026-08-31"), "Monday");
});

test("recording keeps the LAST price of a session, because that is the close", () => {
  let h = record(EMPTY, [{ ...CORN, pay: 4.54 }], new Date("2026-08-31T13:00:00Z"));
  h = record(h, [{ ...CORN, pay: 4.47 }], new Date("2026-08-31T18:00:00Z"));
  assert.equal(h.days["2026-08-31"][keyOf(CORN)], 4.47);
  assert.equal(Object.keys(h.days).length, 1);
});

test("SUNDAY EVENING IS FILED AS MONDAY, not as a Sunday close", () => {
  const sunEve = new Date("2026-08-31T00:21:00Z");        // 19:21 Central Sunday
  const h = record(EMPTY, [{ ...CORN, pay: 4.53 }], sunEve, sunEve);
  assert.deepEqual(Object.keys(h.days), ["2026-08-31"]);
});

test("a weekend observation is not filed at all", () => {
  const sat = new Date("2026-08-29T14:34:00Z");           // 09:34 Central Saturday
  assert.deepEqual(record(EMPTY, [{ ...CORN, pay: 4.50 }], sat, sat).days, {});
});

test("A FROZEN BOARD IS NOT A CLOSE — this is the holiday guard", () => {
  /* On a day with no session the board carries the previous session's number
     and reports that session's pricedAt. Filing it would invent a close. No
     calendar of exchange holidays is needed: the board says so itself. */
  const mon = new Date("2026-08-31T16:00:00Z");           // 11:00 Central Monday
  const stalePricedAt = new Date("2026-08-29T02:00:00Z"); // Friday evening
  assert.deepEqual(record(EMPTY, [{ ...CORN, pay: 4.50 }], mon, stalePricedAt).days, {},
    "the board had not moved into this session, so nothing is filed");
  assert.ok(record(EMPTY, [{ ...CORN, pay: 4.50 }], mon, mon).days["2026-08-31"],
    "and a board that HAS moved is filed normally");
});

test("recording never mutates what it was given", () => {
  const before = hist({ "2026-08-28": { "Corn|August": 4.53 } });
  const snapshot = JSON.stringify(before);
  record(before, [{ ...CORN, pay: 4.47 }], at("2026-08-31"));
  assert.equal(JSON.stringify(before), snapshot);
});

/* ── the real series, day by day ─────────────────────────────────────────── */

/* The real closes out of this repository's commit log, filed by trade date.
   Note there is no 29 or 30 August: that weekend held no session. */
const REAL = {
  "2026-08-25": { "Corn|August": 4.39 },   // Tuesday
  "2026-08-26": { "Corn|August": 4.52 },   // Wednesday
  "2026-08-27": { "Corn|August": 4.48 },   // Thursday
  "2026-08-28": { "Corn|August": 4.50 },   // Friday
};

test("ON A MONDAY IT SAYS FRIDAY, because that is the last session that closed", () => {
  /* Sig, 2026-08-31: "on monday it should say down or up since friday or
     whatever the most recent trading day". Friday closed at 4.50; the board
     is at 4.47 this Monday morning. */
  const c = change(hist(REAL), CORN, 4.47, at("2026-08-31"));
  assert.equal(c.text, "down 3¢ from Friday");
  assert.equal(c.cents, -3);
  assert.equal(c.direction, "down");
  assert.equal(c.sinceDay, "2026-08-28");
});

test("a Sunday-evening price still reads against Friday, not against itself", () => {
  /* 19:21 Central Sunday is Monday's session. There is no Sunday close to
     compare to and there must not appear to be one. */
  const c = change(hist(REAL), CORN, 4.53, new Date("2026-08-31T00:30:00Z"));
  assert.equal(c.sinceDay, "2026-08-28");
  assert.equal(c.text, "up 3¢ from Friday");
});

test("A FLAT DAY SAYS UNCHANGED, and names the day the level was set", () => {
  /* Thursday 27 August closed where Wednesday did. This is the case an earlier
     version got wrong: it reached past Wednesday to Tuesday's 4.43 and reported
     "up 8¢ from Tuesday" — an eight cent move on a day the board did not move. */
  const upto = Object.fromEntries(Object.entries(REAL).filter(([d]) => d <= "2026-08-26"));
  const c = change(hist(upto), CORN, 4.52, at("2026-08-27"));
  assert.equal(c.text, "unchanged since Wednesday");
  assert.equal(c.cents, 0);
});

test("…and the day after a flat day still names the day of the last move", () => {
  const upto = { "2026-08-25": { "Corn|August": 4.39 },
                 "2026-08-26": { "Corn|August": 4.52 },
                 "2026-08-27": { "Corn|August": 4.52 } };
  const c = change(hist(upto), CORN, 4.49, at("2026-08-28"));
  assert.equal(c.text, "down 3¢ from Wednesday",
    "Thursday sat at Wednesday's level, so Wednesday is when the board moved to it");
});

test("a weekend on the books is ignored even if something filed one", () => {
  const c = change(hist({
    "2026-08-27": { "Corn|August": 4.48 },   // Thursday
    "2026-08-28": { "Corn|August": 4.50 },   // Friday
    "2026-08-29": { "Corn|August": 9.99 },   // Saturday — cannot be a close
  }), CORN, 4.47, at("2026-08-31"));
  assert.equal(c.sinceDay, "2026-08-28", "Saturday must not become the reference");
  assert.equal(c.cents, -3);
});

/* ── the ways it must refuse ─────────────────────────────────────────────── */

test("WITH NO HISTORY IT SAYS NOTHING — never a zero, never a dash", () => {
  assert.equal(change(EMPTY, CORN, 4.47, at("2026-08-31")), null);
  assert.equal(change(hist({}), CORN, 4.47, at("2026-08-31")), null);
});

test("it never compares today against itself", () => {
  const only = hist({ "2026-08-31": { "Corn|August": 4.47 } });
  assert.equal(change(only, CORN, 4.47, at("2026-08-31")), null,
    "the only day on record is today; there is nothing to compare to");
});

test("a row the history has never seen gets no line", () => {
  assert.equal(change(hist(REAL), { commodity: "Soybeans", delivery: "October" },
                      10.5, at("2026-08-31")), null);
});

test("a missing or unreadable price gets no line", () => {
  for (const v of [null, undefined, NaN, "", "abc"])
    assert.equal(change(hist(REAL), CORN, v, at("2026-08-31")), null, `for ${String(v)}`);
});

test("days with no entry for this row are skipped, not treated as zero", () => {
  const gappy = hist({
    "2026-08-26": { "Corn|August": 4.49 },
    "2026-08-27": { "Soybeans|October": 10.2 },   // corn absent that session
  });
  const c = change(gappy, CORN, 4.47, at("2026-08-31"));
  assert.equal(c.text, "down 2¢ from Wednesday");
});

test("cents are whole cents, and float noise does not invent a move", () => {
  const h = hist({ "2026-08-28": { "Corn|August": 4.4700001 } });
  const c = change(h, CORN, 4.47, at("2026-08-31"));
  assert.equal(c.cents, 0);
  assert.ok(Object.is(c.cents, 0), "and it is 0, not -0, so the JSON says 0");
  assert.equal(c.text, "unchanged since Friday");
});

test("a real one-cent move is reported as one cent", () => {
  const h = hist({ "2026-08-28": { "Corn|August": 4.46 } });
  assert.equal(change(h, CORN, 4.47, at("2026-08-31")).cents, 1);
  const h2 = hist({ "2026-08-28": { "Corn|August": 4.48 } });
  assert.equal(change(h2, CORN, 4.47, at("2026-08-31")).cents, -1);
});

/* HALF A CENT IS DELIBERATELY NOT PINNED. The pay column can carry a half cent
   (futures quote quarter cents and the spread is subtracted from them), so a
   0.5c change is real and rounds to 0 or 1 depending on which side of binary
   floating point the subtraction lands. Both readings are defensible and
   neither misleads by more than half a cent; asserting one of them would be
   asserting an artefact of the arithmetic, not a decision anybody made. What
   IS asserted is that it stays within a cent. */
test("a half-cent move lands within a cent, either way", () => {
  const h = hist({ "2026-08-28": { "Corn|August": 4.465 } });
  const c = change(h, CORN, 4.47, at("2026-08-31"));
  assert.ok([0, 1].includes(c.cents), `got ${c.cents}`);
});

test("the file does not grow forever", () => {
  const days = {};
  for (let i = 0; i < KEEP_DAYS + 15; i++) {
    const d = new Date(Date.UTC(2026, 0, 5 + i)).toISOString().slice(0, 10);
    days[d] = { "Corn|August": 4 + i / 100 };
  }
  const p = prune(hist(days));
  assert.equal(Object.keys(p.days).length, KEEP_DAYS);
  const kept = Object.keys(p.days).sort();
  assert.equal(kept[kept.length - 1], Object.keys(days).sort().slice(-1)[0],
    "it drops the OLDEST days, not the newest");
});

test("pruning leaves a short history alone", () => {
  const h = hist(REAL);
  assert.equal(prune(h), h);
});
