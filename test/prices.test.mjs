/* The publisher, in every state a real calendar produces.
 *
 * The live payload below was read from dnilgis/bids on 2026-08-18 and is
 * used as the fixture deliberately: a test that only ever sees invented
 * data proves the code works on invented data.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  board, payFrom, basisText, money, asOf, renderPriced, renderWithdrawn,
  writeRegion, bidsJson, bidsCsv, CSV_HEADER, Withdraw, CONFIG,
} from "../tools/update-prices.mjs";

const LIVE = {
  schema: "bigriver-boyceville/2",
  source: { location: "Boyceville" },
  checkedAt: "2026-08-18T15:32:47.900Z",
  pricedAt: "2026-08-18T15:32:47.900Z",
  status: "ok",
  count: 7,
  bids: [
    { seq: 0, commodity: "Corn", delivery: "August",    futuresMonth: "Sep 26", cash: 4.115,  basisDollars: -0.52, basisCents: -52, futuresPriceCents: 463.5 },
    { seq: 1, commodity: "Corn", delivery: "September", futuresMonth: "Sep 26", cash: 4.175,  basisDollars: -0.46, basisCents: -46, futuresPriceCents: 463.5 },
    { seq: 2, commodity: "Corn", delivery: "October",   futuresMonth: "Dec 26", cash: 4.33,   basisDollars: -0.55, basisCents: -55, futuresPriceCents: 488 },
    { seq: 3, commodity: "Corn", delivery: "November",  futuresMonth: "Dec 26", cash: 4.33,   basisDollars: -0.55, basisCents: -55, futuresPriceCents: 488 },
    { seq: 4, commodity: "Corn", delivery: "December",  futuresMonth: "Dec 26", cash: 4.38,   basisDollars: -0.5,  basisCents: -50, futuresPriceCents: 488 },
    { seq: 5, commodity: "Corn", delivery: "January",   futuresMonth: "Mar 27", cash: 4.4375, basisDollars: -0.6,  basisCents: -60, futuresPriceCents: 503.75 },
    { seq: 6, commodity: "Corn", delivery: "February",  futuresMonth: "Mar 27", cash: 4.4575, basisDollars: -0.58, basisCents: -58, futuresPriceCents: 503.75 },
  ],
};
const NOW = new Date("2026-08-18T15:56:49.578Z");   // 24 min after that read
const clone = (o) => JSON.parse(JSON.stringify(o));
const at = (h) => new Date(Date.parse(LIVE.checkedAt) + h * 36e5);

/* ---- the arithmetic --------------------------------------------------- */

test("the spread comes off the cash price, rounded to the nearest cent", () => {
  assert.equal(payFrom(4.115, 0.10), 4.02);      // 4.015 -> half away from zero
  assert.equal(payFrom(4.33, 0.10), 4.23);
  assert.equal(payFrom(4.4375, 0.10), 4.34);     // 4.3375
  assert.equal(payFrom(4.2825, 0.10), 4.18);     // the emmertadmin sample
  assert.equal(payFrom(4.3325, 0.10), 4.23);     // the emmertadmin sample
  assert.equal(payFrom(4.39, 0.10), 4.29);
});

test("ROUNDING NEVER FAVOURS THE ELEVATOR", () => {
  /* Truncation would be worth half a cent every time and always in the same
     direction. Over a harvest that is a thumb on the scale. */
  let ourTotal = 0, truncTotal = 0;
  for (let c = 300; c <= 600; c++) {
    for (const q of [0, 0.0025, 0.005, 0.0075]) {
      const cash = c / 100 + q;
      ourTotal += payFrom(cash, 0.10);
      truncTotal += Math.floor((cash - 0.10) * 100) / 100;
    }
  }
  assert.ok(ourTotal > truncTotal,
    "rounding to nearest must pay more in aggregate than truncating");
});

test("a zero spread is allowed and changes nothing", () => {
  assert.equal(payFrom(4.115, 0), 4.12);
});

test("basis is written the way it is said", () => {
  assert.equal(basisText(-0.52), "−0.52");
  assert.equal(basisText(0.06), "+0.06");
  assert.equal(basisText(0), "0.00");
  assert.equal(money(4.2), "$4.20");
});

/* ---- the identity check ----------------------------------------------- */

test("the live board passes every guard", () => {
  const b = board(LIVE, { now: NOW, spread: 0.10 });
  assert.equal(b.bids.length, 7);
  assert.equal(b.bids[0].delivery, "August");
  assert.equal(b.bids[0].pay, 4.02);
  assert.equal(b.bids[6].pay, 4.36);            // 4.4575 - 0.10 = 4.3575
  assert.ok(b.ageH > 0.3 && b.ageH < 0.5);
});

test("A ROW THAT FAILS cash - basis = futures TAKES THE WHOLE PAGE DOWN", () => {
  /* Their cash column and their basis column swap, or one shifts by a row.
     Every number still looks like a corn price. The identity is the only
     thing that knows. */
  const bad = clone(LIVE);
  bad.bids[3].cash = 4.53;                       // plausible, and wrong
  assert.throws(() => board(bad, { now: NOW, spread: 0.10 }),
    (e) => e instanceof Withdraw && /fails cash - basis = futures/.test(e.message));
});

test("a row that cannot be checked is not published on trust", () => {
  const partial = clone(LIVE);
  delete partial.bids[2].futuresPriceCents;
  assert.throws(() => board(partial, { now: NOW, spread: 0.10 }),
    (e) => e instanceof Withdraw && /cannot be checked/.test(e.message));
});

test("a decimal point in the wrong place is refused", () => {
  for (const cash of [0.44, 44.2]) {
    const bad = clone(LIVE);
    bad.bids[0].cash = cash;
    bad.bids[0].futuresPriceCents = Math.round((cash + 0.52) * 100);  // identity still holds
    assert.throws(() => board(bad, { now: NOW, spread: 0.10 }),
      (e) => e instanceof Withdraw && /decimal point/.test(e.message), `${cash} must be refused`);
  }
});

test("a feed whose count disagrees with its own rows is refused", () => {
  const bad = clone(LIVE); bad.count = 9;
  assert.throws(() => board(bad, { now: NOW, spread: 0.10 }),
    (e) => e instanceof Withdraw && /not internally consistent/.test(e.message));
});

/* ---- the two clocks ---------------------------------------------------- */

test("A QUIET WEEKEND IS NOT A DEAD READER", () => {
  /* Friday afternoon their board stops moving. Monday at 6am pricedAt is 63
     hours old -- true, and fine. checkedAt is minutes old because the reader
     heartbeats. The price must still be on the page. */
  const quiet = clone(LIVE);
  quiet.pricedAt = "2026-08-14T18:00:00.000Z";
  quiet.checkedAt = "2026-08-17T09:00:00.000Z";
  const b = board(quiet, { now: new Date("2026-08-17T09:20:00.000Z"), spread: 0.10 });
  assert.equal(b.bids.length, 7);
  assert.equal(b.pricedAt, quiet.pricedAt, "as-of must be the price's own date");
  assert.match(renderPriced(b), /as of Friday, August 14/,
    "and the page must say so rather than implying it is today's");
});

test("A DEAD READER TAKES THE PRICE OFF, on checkedAt not pricedAt", () => {
  const cold = clone(LIVE);
  cold.checkedAt = at(-(CONFIG.FEED_MAX_AGE_H + 1)).toISOString();
  assert.throws(() => board(cold, { now: NOW, spread: 0.10 }),
    (e) => e instanceof Withdraw && /no longer watching a live board/.test(e.message));
});

test("...and one hour inside the limit still publishes", () => {
  const nearly = clone(LIVE);
  const now = at(CONFIG.FEED_MAX_AGE_H - 1);
  assert.equal(board(nearly, { now, spread: 0.10 }).bids.length, 7);
});

test("a checkedAt in the future is a broken clock, not a fresh read", () => {
  const ahead = clone(LIVE);
  ahead.checkedAt = at(48).toISOString();
  assert.throws(() => board(ahead, { now: NOW, spread: 0.10 }),
    (e) => e instanceof Withdraw && /FUTURE/.test(e.message));
});

test("an unreadable or missing checkedAt withdraws rather than assuming", () => {
  for (const v of [undefined, null, "", "not a date", 0]) {
    const bad = clone(LIVE); bad.checkedAt = v;
    assert.throws(() => board(bad, { now: NOW, spread: 0.10 }),
      (e) => e instanceof Withdraw && /readable checkedAt/.test(e.message), `checkedAt=${v}`);
  }
});

test("an empty board withdraws", () => {
  const empty = clone(LIVE); empty.bids = []; empty.count = 0;
  assert.throws(() => board(empty, { now: NOW, spread: 0.10 }),
    (e) => e instanceof Withdraw && /no rows/.test(e.message));
});

test("a source that has stopped moving is flagged but still published", () => {
  /* Their board frozen is their business. The price is still theirs and
     still real; the 'as of' date tells the truth about its age. */
  const frozen = clone(LIVE); frozen.status = "stale";
  const b = board(frozen, { now: NOW, spread: 0.10 });
  assert.equal(b.sourceStale, true);
  assert.equal(b.bids.length, 7);
});

/* ---- delivery order ---------------------------------------------------- */

test("page order is kept; month names are not sorted", () => {
  const shuffled = clone(LIVE);
  shuffled.bids = [shuffled.bids[4], shuffled.bids[0], shuffled.bids[6], shuffled.bids[1],
                   shuffled.bids[5], shuffled.bids[2], shuffled.bids[3]];
  const b = board(shuffled, { now: NOW, spread: 0.10 });
  assert.deepEqual(b.bids.map((r) => r.delivery),
    ["August", "September", "October", "November", "December", "January", "February"]);
  assert.notDeepEqual(b.bids.map((r) => r.delivery),
    [...b.bids.map((r) => r.delivery)].sort(),
    "alphabetical would put August, December, February first, which is not a delivery order");
});

/* ---- rendering --------------------------------------------------------- */

const PAGE = `<div class="wrap">
    <div class="pricecol" id="prices">
      <div class="panel">
      <div class="hd">Prices paid today</div>
      <div class="nobid">
        <p class="nobid-h">Call for today's price</p>
        <p class="nobid-p">We are posting prices here shortly. Ring the office and we will give you today's number.</p>
      </div>

      <div class="tnote">Prices change with the market and are not final until you call. Grain is bought subject to the drying and discount schedule below.</div>
      </div>
      <a class="call num" href="tel:+17157040548">Call (715) 704-0548 to lock a price</a>
    </div>
</div>`;

test("only the panel is rewritten; the call button and the terms line survive", () => {
  const b = board(LIVE, { now: NOW, spread: 0.10 });
  const out = writeRegion(PAGE, renderPriced(b));
  assert.match(out, /tel:\+17157040548/);
  assert.match(out, /Prices change with the market/);
  assert.match(out, /<table class="bids">/);
  assert.doesNotMatch(out, /nobid/, "the withdrawal panel must be gone");
  assert.equal((out.match(/<div class="tnote">/g) || []).length, 1);
  assert.equal((out.match(/class="call num"/g) || []).length, 1);
});

test("withdrawing puts the call panel back and nothing else", () => {
  const b = board(LIVE, { now: NOW, spread: 0.10 });
  const priced = writeRegion(PAGE, renderPriced(b));
  const back = writeRegion(priced, renderWithdrawn());
  assert.doesNotMatch(back, /<table class="bids">/);
  assert.match(back, /Call for today&rsquo;s price/);
  assert.match(back, /tel:\+17157040548/);
});

test("RENDERING IS IDEMPOTENT: the same feed twice writes the same bytes", () => {
  const b = board(LIVE, { now: NOW, spread: 0.10 });
  const once = writeRegion(PAGE, renderPriced(b));
  const twice = writeRegion(once, renderPriced(board(LIVE, { now: at(2), spread: 0.10 })));
  assert.equal(once, twice,
    "a run two hours later with an unmoved board must not produce a commit");
});

test("a layout change stops the script rather than guessing where the price goes", () => {
  assert.throws(() => writeRegion("<html><body>nothing familiar</body></html>", "x"),
    /could not find the price panel/);
});

test("the rendered panel uses only classes site.css actually defines", () => {
  const b = board(LIVE, { now: NOW, spread: 0.10 });
  const html = renderPriced(b);
  const known = new Set(["hd", "as", "bids", "mo", "con", "bas", "pay", "r", "m-hide",
                         "nobid", "nobid-h", "nobid-p"]);
  for (const m of html.matchAll(/class="([^"]+)"/g))
    for (const c of m[1].split(/\s+/))
      assert.ok(known.has(c), `class "${c}" is not in site.css`);
});

test("no JavaScript, no outside requests, no emoji, and no unit word", () => {
  const b = board(LIVE, { now: NOW, spread: 0.10 });
  for (const html of [renderPriced(b), renderWithdrawn()]) {
    assert.doesNotMatch(html, /<script|onclick|javascript:/i);
    assert.doesNotMatch(html, /https?:\/\//);
    assert.doesNotMatch(html, /bushel/i);
    assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}]/u);
  }
});

test("markup is escaped, so a delivery month cannot inject tags", () => {
  const nasty = clone(LIVE);
  nasty.bids[0].delivery = '<script>alert(1)</script>';
  const b = board(nasty, { now: NOW, spread: 0.10 });
  const html = renderPriced(b);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

/* ---- the published record ---------------------------------------------- */

const SITE = { company: "Badger Grain Supply, LLC", location: "Wheeler", city: "Wheeler",
               state: "WI", contact: "office@badgergrain.com" };

test("bids.json keeps the schema and the terms the sites already publish", () => {
  const b = board(LIVE, { now: NOW, spread: 0.10 });
  const j = bidsJson(b, { contact: SITE.contact, generated: NOW.toISOString() });
  assert.equal(j.schema, "emmert-cash-bids/2",
    "bumped because pricedAt was added; a published schema is a contract");
  assert.equal(j.status, "ok");
  assert.equal(j.count, 7);
  assert.equal(j.observed, LIVE.checkedAt);
  assert.equal(j.terms.licence, "CC0-1.0");
  assert.equal(j.terms.contact, "office@badgergrain.com");
});

test("the schema bump keeps every field a /1 consumer already read", () => {
  const b = board(LIVE, { now: NOW, spread: 0.10 });
  const j = bidsJson(b, { contact: SITE.contact, generated: NOW.toISOString() });
  for (const k of ["schema", "generated", "observed", "status", "terms", "count", "bids"])
    assert.ok(k in j, `/1 published ${k} and /2 must still carry it`);
  assert.equal(j.observed, LIVE.checkedAt, "observed still means the last successful read");
  assert.equal(j.pricedAt, LIVE.pricedAt, "and pricedAt is the new, separate fact");
});

test("BOTH CLOCKS SURVIVE INTO THE PUBLISHED RECORD", () => {
  /* The whole reason for /2. A quiet weekend must be legible to a consumer
     as "read recently, priced on Friday" rather than as one ambiguous date. */
  const quiet = clone(LIVE);
  quiet.pricedAt = "2026-08-14T18:00:00.000Z";
  quiet.checkedAt = "2026-08-17T09:00:00.000Z";
  const b = board(quiet, { now: new Date("2026-08-17T09:20:00.000Z"), spread: 0.10 });
  const j = bidsJson(b, { contact: SITE.contact, generated: NOW.toISOString() });
  assert.notEqual(j.observed, j.pricedAt);
  assert.ok(Date.parse(j.observed) > Date.parse(j.pricedAt));
});

test("THE PUBLISHED PRICE IS WHAT WE PAY, NOT WHAT BIG RIVER PAYS", () => {
  const b = board(LIVE, { now: NOW, spread: 0.10 });
  const j = bidsJson(b, { contact: SITE.contact, generated: NOW.toISOString() });
  assert.equal(j.bids[0].cashPrice, 4.02, "their 4.115 less our 0.10 spread");
  assert.notEqual(j.bids[0].cashPrice, 4.115);
});

test("no exchange-licensed futures price is published, as the terms promise", () => {
  const b = board(LIVE, { now: NOW, spread: 0.10 });
  const j = bidsJson(b, { contact: SITE.contact, generated: NOW.toISOString() });
  assert.match(j.terms.note, /No exchange-licensed futures prices are included/);
  const text = JSON.stringify(j.bids);
  assert.doesNotMatch(text, /futures/i);
  for (const r of LIVE.bids)
    assert.doesNotMatch(text, new RegExp(String(r.futuresPriceCents / 100).replace(".", "\\.")),
      `the ${r.delivery} futures quote must not appear`);
  assert.doesNotMatch(bidsCsv(b, SITE), /463\.5|4\.635|4\.88|5\.0375/);
});

test("a withdrawal publishes an empty record, not a stale one", () => {
  const j = bidsJson(null, { contact: SITE.contact, generated: NOW.toISOString() });
  assert.equal(j.status, "stale");
  assert.equal(j.count, 0);
  assert.deepEqual(j.bids, []);
  assert.equal(j.observed, null);
  assert.equal(bidsCsv(null, SITE), CSV_HEADER + "\n");
});

test("the CSV keeps the header the sites already publish, byte for byte", () => {
  const b = board(LIVE, { now: NOW, spread: 0.10 });
  const csv = bidsCsv(b, SITE);
  assert.equal(csv.split("\n")[0], CSV_HEADER);
  assert.equal(csv.trim().split("\n").length, 8, "header plus seven rows");
  assert.match(csv, /^Wheeler,"Badger Grain Supply, LLC",Wheeler,WI,Corn,cash,August,August,,-0\.62,4\.02$/m,
    "our basis and our price -- never their basis beside our price");
  assert.ok(csv.endsWith("\n"));
});

test("a company name with a comma in it does not break the CSV", () => {
  const b = board(LIVE, { now: NOW, spread: 0.10 });
  const line = bidsCsv(b, SITE).split("\n")[1];
  assert.match(line, /"Badger Grain Supply, LLC"/);
  assert.equal(line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).length, 11,
    "eleven fields, the comma inside the quotes not counted");
});

test("as-of is Central time, not the runner's UTC", () => {
  /* 00:30 UTC on the 19th is still the evening of the 18th in Wheeler. A
     page that rolled the date over at 7pm would be wrong every evening. */
  assert.equal(asOf("2026-08-19T00:30:00.000Z"), "Tuesday, August 18");
  assert.equal(asOf("2026-08-19T13:00:00.000Z"), "Wednesday, August 19");
});

/* ---- the spread is not guessable --------------------------------------- */

test("A MISSING SPREAD STOPS THE RUN RATHER THAN DEFAULTING", async () => {
  /* The 0.10 that appears all over the staff screen is sample data -- it
     carries data-sample in the markup. Shipping it as the real spread would
     be inventing the one number that decides what a grower is paid. */
  const { mkdtempSync, writeFileSync, cpSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { main } = await import("../tools/update-prices.mjs");

  const dir = mkdtempSync(join(tmpdir(), "spread-"));
  writeFileSync(join(dir, "pricing.json"), JSON.stringify({ spread: null, contact: "x" }));
  writeFileSync(join(dir, "index.html"), PAGE);
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    await assert.rejects(() => main({ fetchImpl: async () => ({ ok: true, status: 200,
      text: async () => JSON.stringify(LIVE) }), now: NOW }),
      /no spread yet/);
  } finally { process.chdir(cwd); }
});

test("...and a nonsense spread is refused too", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { main } = await import("../tools/update-prices.mjs");
  const cwd = process.cwd();
  /* NaN is not representable in JSON -- JSON.stringify turns it into null --
     so it arrives as the null case and is refused by the message above. The
     values below are the ones that can actually reach the file. */
  for (const bad of ["0.10", -0.05, true, [], {}]) {
    const dir = mkdtempSync(join(tmpdir(), "spread-"));
    writeFileSync(join(dir, "pricing.json"), JSON.stringify({ spread: bad, contact: "x" }));
    writeFileSync(join(dir, "index.html"), PAGE);
    try {
      process.chdir(dir);
      await assert.rejects(() => main({ fetchImpl: async () => ({ ok: true, status: 200,
        text: async () => JSON.stringify(LIVE) }), now: NOW }),
        /spread must be a number/, `spread=${JSON.stringify(bad)}`);
    } finally { process.chdir(cwd); }
  }
});

/* ---- what the page shows, versus what is captured ---------------------- */

import { headline, HARVEST_MONTHS } from "../tools/update-prices.mjs";

test("THE PAGE SHOWS TWO NUMBERS; THE RECORD KEEPS ALL SEVEN", () => {
  const b = board(LIVE, { now: NOW, spread: 0.10 });
  const html = renderPriced(b);
  assert.equal((html.match(/class="pay r"/g) || []).length, 2,
    "spot and harvest, and nothing else");
  assert.match(html, /Cash, corn<span class="con">August delivery/);
  assert.match(html, /Harvest<span class="con">October and November delivery/);
  assert.doesNotMatch(html, /September|December|January|February/,
    "the other five months are captured, not displayed");

  const j = bidsJson(b, { contact: SITE.contact, generated: NOW.toISOString() });
  assert.equal(j.count, 7, "but the published record keeps the whole board");
  assert.equal(bidsCsv(b, SITE).trim().split("\n").length, 8);
});

test("harvest is the lower of October and November, never the flattering one", () => {
  const split = clone(LIVE);
  split.bids[3].cash = 4.29;                       // November cheaper than October
  split.bids[3].futuresPriceCents = Math.round((4.29 - -0.55) * 10000) / 100;
  const b = board(split, { now: NOW, spread: 0.10 });
  const { harvest } = headline(b.bids);
  assert.equal(harvest.delivery, "November");
  assert.equal(harvest.pay, 4.19);
  assert.match(renderPriced(b), /October and November delivery/,
    "and both months are still named, so the figure is not mistaken for one of them");
});

test("come October, spot IS harvest and the number is not printed twice", () => {
  const autumn = clone(LIVE);
  autumn.bids = autumn.bids.slice(2);              // board rolls on: October first
  autumn.count = autumn.bids.length;
  const b = board(autumn, { now: NOW, spread: 0.10 });
  const { spot, harvest } = headline(b.bids);
  assert.equal(spot.delivery, "October");
  assert.equal(harvest, null);
  assert.equal((renderPriced(b).match(/class="pay r"/g) || []).length, 1);
});

test("a board with no harvest month on it still shows the cash bid", () => {
  const spring = clone(LIVE);
  spring.bids = spring.bids.filter((r) => !HARVEST_MONTHS.includes(r.delivery));
  spring.count = spring.bids.length;
  const b = board(spring, { now: NOW, spread: 0.10 });
  assert.equal(headline(b.bids).harvest, null);
  const html = renderPriced(b);
  assert.equal((html.match(/class="pay r"/g) || []).length, 1);
  assert.match(html, /Cash, corn/);
});

test("the two figures on the page are ours, not Big River's", () => {
  const b = board(LIVE, { now: NOW, spread: 0.10 });
  const html = renderPriced(b);
  assert.match(html, /\$4\.02/, "August 4.115 less 0.10");
  assert.match(html, /\$4\.23/, "October/November 4.33 less 0.10");
  assert.doesNotMatch(html, /\$4\.115|\$4\.33/, "their number must not appear as ours");
});

/* ---- our basis, not theirs --------------------------------------------- */

import { basisFrom } from "../tools/update-prices.mjs";

test("THE BASIS BESIDE OUR PRICE IS OURS, AND THE PAIR SURVIVES THE IDENTITY CHECK", () => {
  /* We pay ten cents under Big River. cash = futures + basis, so ten cents
     off their cash is ten cents off their basis, and the two numbers we
     print have to belong to each other. Printing their basis next to our
     price manufactures a discrepancy against their own board. */
  const b = board(LIVE, { now: NOW, spread: 0.10 });
  const aug = b.bids[0];
  assert.equal(aug.theirBasis, -0.52, "theirs, untouched, for the log");
  assert.equal(aug.basisDollars, -0.62, "ours: ten cents further under");
  assert.equal(aug.pay, 4.02);

  for (const r of b.bids) {
    const theirFutures = Math.round((r.cash - r.theirBasis) * 10000) / 10000;
    const exact = Math.round((r.cash - 0.10 - r.basisDollars) * 10000) / 10000;
    assert.equal(exact, theirFutures,
      `${r.delivery}: our cash less our basis must come back to their futures quote`);
  }
});

test("...and the displayed pair recomputes to within the rounding of a cent", () => {
  const b = board(LIVE, { now: NOW, spread: 0.10 });
  for (const r of b.bids) {
    const theirFutures = Math.round((r.cash - r.theirBasis) * 10000) / 10000;
    const fromShown = r.pay - r.basisDollars;
    assert.ok(Math.abs(fromShown - theirFutures) <= 0.005 + 1e-9,
      `${r.delivery}: shown ${r.pay} - (${r.basisDollars}) = ${fromShown.toFixed(4)} ` +
      `against ${theirFutures}`);
  }
});

test("the published record carries our basis too, not a mixed pair", () => {
  const b = board(LIVE, { now: NOW, spread: 0.10 });
  const j = bidsJson(b, { contact: SITE.contact, generated: NOW.toISOString() });
  assert.equal(j.bids[0].basis, -0.62);
  assert.equal(j.bids[0].cashPrice, 4.02);
  assert.doesNotMatch(JSON.stringify(j.bids), /-0\.52|-0\.46/, "their basis must not appear as ours");
  assert.match(bidsCsv(b, SITE), /,-0\.62,4\.02$/m);
});

test("the page prints our basis", () => {
  const b = board(LIVE, { now: NOW, spread: 0.10 });
  const html = renderPriced(b);
  assert.match(html, /−0\.62/);
  assert.doesNotMatch(html, /−0\.52/, "their August basis must not be on our page");
});

test("a zero spread makes our basis theirs, which is the only time they are equal", () => {
  const b = board(LIVE, { now: NOW, spread: 0 });
  assert.equal(b.bids[0].basisDollars, b.bids[0].theirBasis);
  assert.equal(basisFrom(-0.52, 0), -0.52);
  assert.equal(basisFrom(-0.5, 0.1), -0.6, "and no floating-point dust");
  assert.equal(basisFrom(-0.58, 0.1), -0.68);
});
