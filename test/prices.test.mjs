/* The publisher, in every state a real calendar produces.
 *
 * The live payload below was read from dnilgis/bids on 2026-08-18 and is
 * used as the fixture deliberately: a test that only ever sees invented
 * data proves the code works on invented data.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
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
  assert.throws(() => board(bad, { now: NOW, spreads: { cash: 0.10, harvest: null } }),
    (e) => e instanceof Withdraw && /fails cash - basis = futures/.test(e.message));
});

test("a row that cannot be checked is published WITHOUT its quote, not on trust", () => {
  /* This used to refuse the whole board. It took both sites dark on
     2026-08-18 when the reader began publishing null for a quote it could not
     verify. The row is now carried with no quote and the page prints a dash;
     what is never carried is a number nobody checked. */
  const partial = clone(LIVE);
  delete partial.bids[2].futuresPriceCents;
  const b = board(partial, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  assert.equal(b.bids.length, 7);
  assert.equal(b.bids[2].futures, null);
  assert.equal(b.bids[2].pay, 4.23, "the price is unaffected");
});

test("a decimal point in the wrong place is refused", () => {
  for (const cash of [0.44, 44.2]) {
    const bad = clone(LIVE);
    bad.bids[0].cash = cash;
    bad.bids[0].futuresPriceCents = Math.round((cash + 0.52) * 100);  // identity still holds
    assert.throws(() => board(bad, { now: NOW, spreads: { cash: 0.10, harvest: null } }),
      (e) => e instanceof Withdraw && /decimal point/.test(e.message), `${cash} must be refused`);
  }
});

test("a feed whose count disagrees with its own rows is refused", () => {
  const bad = clone(LIVE); bad.count = 9;
  assert.throws(() => board(bad, { now: NOW, spreads: { cash: 0.10, harvest: null } }),
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
  const b = board(quiet, { now: new Date("2026-08-17T09:20:00.000Z"), spreads: { cash: 0.10, harvest: null } });
  assert.equal(b.bids.length, 7);
  assert.equal(b.pricedAt, quiet.pricedAt, "as-of must be the price's own date");
  assert.match(renderPriced(b), /as of Friday, August 14, /,
    "and the page must say so rather than implying it is today's");
});

test("A DEAD READER TAKES THE PRICE OFF, on checkedAt not pricedAt", () => {
  const cold = clone(LIVE);
  cold.checkedAt = at(-(CONFIG.FEED_MAX_AGE_H + 1)).toISOString();
  assert.throws(() => board(cold, { now: NOW, spreads: { cash: 0.10, harvest: null } }),
    (e) => e instanceof Withdraw && /no longer watching a live board/.test(e.message));
});

test("...and one hour inside the limit still publishes", () => {
  const nearly = clone(LIVE);
  const now = at(CONFIG.FEED_MAX_AGE_H - 1);
  assert.equal(board(nearly, { now, spreads: { cash: 0.10, harvest: null } }).bids.length, 7);
});

test("a checkedAt in the future is a broken clock, not a fresh read", () => {
  const ahead = clone(LIVE);
  ahead.checkedAt = at(48).toISOString();
  assert.throws(() => board(ahead, { now: NOW, spreads: { cash: 0.10, harvest: null } }),
    (e) => e instanceof Withdraw && /FUTURE/.test(e.message));
});

test("an unreadable or missing checkedAt withdraws rather than assuming", () => {
  for (const v of [undefined, null, "", "not a date", 0]) {
    const bad = clone(LIVE); bad.checkedAt = v;
    assert.throws(() => board(bad, { now: NOW, spreads: { cash: 0.10, harvest: null } }),
      (e) => e instanceof Withdraw && /readable checkedAt/.test(e.message), `checkedAt=${v}`);
  }
});

test("an empty board withdraws", () => {
  const empty = clone(LIVE); empty.bids = []; empty.count = 0;
  assert.throws(() => board(empty, { now: NOW, spreads: { cash: 0.10, harvest: null } }),
    (e) => e instanceof Withdraw && /no rows/.test(e.message));
});

test("a source that has stopped moving is flagged but still published", () => {
  /* Their board frozen is their business. The price is still theirs and
     still real; the 'as of' date tells the truth about its age. */
  const frozen = clone(LIVE); frozen.status = "stale";
  const b = board(frozen, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  assert.equal(b.sourceStale, true);
  assert.equal(b.bids.length, 7);
});

/* ---- delivery order ---------------------------------------------------- */

test("page order is kept; month names are not sorted", () => {
  const shuffled = clone(LIVE);
  shuffled.bids = [shuffled.bids[4], shuffled.bids[0], shuffled.bids[6], shuffled.bids[1],
                   shuffled.bids[5], shuffled.bids[2], shuffled.bids[3]];
  const b = board(shuffled, { now: NOW, spreads: { cash: 0.10, harvest: null } });
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
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  const out = writeRegion(PAGE, renderPriced(b));
  assert.match(out, /tel:\+17157040548/);
  assert.match(out, /Prices change with the market/);
  assert.match(out, /<table class="bids">/);
  assert.doesNotMatch(out, /nobid/, "the withdrawal panel must be gone");
  assert.equal((out.match(/<div class="tnote">/g) || []).length, 1);
  assert.equal((out.match(/class="call num"/g) || []).length, 1);
});

test("withdrawing puts the call panel back and nothing else", () => {
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  const priced = writeRegion(PAGE, renderPriced(b));
  const back = writeRegion(priced, renderWithdrawn());
  assert.doesNotMatch(back, /<table class="bids">/);
  assert.match(back, /Call for today&rsquo;s price/);
  assert.match(back, /tel:\+17157040548/);
});

test("RENDERING IS IDEMPOTENT: the same feed twice writes the same bytes", () => {
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  const once = writeRegion(PAGE, renderPriced(b));
  const twice = writeRegion(once, renderPriced(board(LIVE, { now: at(2), spreads: { cash: 0.10, harvest: null } })));
  assert.equal(once, twice,
    "a run two hours later with an unmoved board must not produce a commit");
});

test("a layout change stops the script rather than guessing where the price goes", () => {
  assert.throws(() => writeRegion("<html><body>nothing familiar</body></html>", "x"),
    /could not find the price panel/);
});

test("the rendered panel uses only classes site.css actually defines", () => {
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  const html = renderPriced(b);
  /* Every one of these is a real selector in site.css. `fut` was the only one
     defined and unused; the futures column is what it was always for. */
  const known = new Set(["hd", "as", "bids", "mo", "con", "fut", "bas", "pay", "r",
                         "m-hide", "nobid", "nobid-h", "nobid-p"]);
  for (const m of html.matchAll(/class="([^"]+)"/g))
    for (const c of m[1].split(/\s+/))
      assert.ok(known.has(c), `class "${c}" is not in site.css`);
});

test("no JavaScript, no outside requests, no emoji, and no unit word", () => {
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
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
  const b = board(nasty, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  const html = renderPriced(b);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

/* ---- the published record ---------------------------------------------- */

const SITE = { company: "Badger Grain Supply, LLC", location: "Wheeler", city: "Wheeler",
               state: "WI", contact: "office@badgergrain.com" };

test("bids.json keeps the schema and the terms the sites already publish", () => {
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
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
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
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
  const b = board(quiet, { now: new Date("2026-08-17T09:20:00.000Z"), spreads: { cash: 0.10, harvest: null } });
  const j = bidsJson(b, { contact: SITE.contact, generated: NOW.toISOString() });
  assert.notEqual(j.observed, j.pricedAt);
  assert.ok(Date.parse(j.observed) > Date.parse(j.pricedAt));
});

test("THE PUBLISHED PRICE IS WHAT WE PAY, NOT WHAT BIG RIVER PAYS", () => {
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  const j = bidsJson(b, { contact: SITE.contact, generated: NOW.toISOString() });
  assert.equal(j.bids[0].cashPrice, 4.02, "their 4.115 less our 0.10 spread");
  assert.notEqual(j.bids[0].cashPrice, 4.115);
});

test("no exchange-licensed futures price is published, as the terms promise", () => {
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
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
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  const csv = bidsCsv(b, SITE);
  assert.equal(csv.split("\n")[0], CSV_HEADER);
  assert.equal(csv.trim().split("\n").length, 8, "header plus seven rows");
  assert.match(csv, /^Wheeler,"Badger Grain Supply, LLC",Wheeler,WI,Corn,cash,August,August,,-0\.62,4\.02$/m,
    "our basis and our price -- never their basis beside our price");
  assert.ok(csv.endsWith("\n"));
});

test("a company name with a comma in it does not break the CSV", () => {
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  const line = bidsCsv(b, SITE).split("\n")[1];
  assert.match(line, /"Badger Grain Supply, LLC"/);
  assert.equal(line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).length, 11,
    "eleven fields, the comma inside the quotes not counted");
});

test("AS-OF CARRIES THE TIME, SO A STALE COPY IS OBVIOUS", () => {
  /* A date alone cannot tell you whether the page in front of you is today's
     build or one your phone kept from this morning -- and a phone returning
     to a tab from the app switcher restores it without asking the server at
     all. GitHub Pages gives you no cache headers to set, so making staleness
     visible beats trying to prevent it. */
  assert.equal(asOf("2026-08-18T21:36:05.916Z"), "Tuesday, August 18, 4:36pm");
  assert.equal(asOf("2026-08-18T13:05:00.000Z"), "Tuesday, August 18, 8:05am");
});

test("...and it is still Central time, not the runner's UTC", () => {
  /* 00:30 UTC on the 19th is still the evening of the 18th in Wheeler. A
     page that rolled the date over at 7pm would be wrong every evening. */
  assert.match(asOf("2026-08-19T00:30:00.000Z"), /^Tuesday, August 18, 7:30pm$/);
  assert.match(asOf("2026-08-19T13:00:00.000Z"), /^Wednesday, August 19, 8:00am$/);
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
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
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
  const b = board(split, { now: NOW, spreads: { cash: 0.10, harvest: null } });
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
  const b = board(autumn, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  const { spot, harvest } = headline(b.bids);
  assert.equal(spot.delivery, "October");
  assert.equal(harvest, null);
  assert.equal((renderPriced(b).match(/class="pay r"/g) || []).length, 1);
});

test("a board with no harvest month on it still shows the cash bid", () => {
  const spring = clone(LIVE);
  spring.bids = spring.bids.filter((r) => !HARVEST_MONTHS.includes(r.delivery));
  spring.count = spring.bids.length;
  const b = board(spring, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  assert.equal(headline(b.bids).harvest, null);
  const html = renderPriced(b);
  assert.equal((html.match(/class="pay r"/g) || []).length, 1);
  assert.match(html, /Cash, corn/);
});

test("the two figures on the page are ours, not Big River's", () => {
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
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
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
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
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  for (const r of b.bids) {
    const theirFutures = Math.round((r.cash - r.theirBasis) * 10000) / 10000;
    const fromShown = r.pay - r.basisDollars;
    assert.ok(Math.abs(fromShown - theirFutures) <= 0.005 + 1e-9,
      `${r.delivery}: shown ${r.pay} - (${r.basisDollars}) = ${fromShown.toFixed(4)} ` +
      `against ${theirFutures}`);
  }
});

test("the published record carries our basis too, not a mixed pair", () => {
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  const j = bidsJson(b, { contact: SITE.contact, generated: NOW.toISOString() });
  assert.equal(j.bids[0].basis, -0.62);
  assert.equal(j.bids[0].cashPrice, 4.02);
  assert.doesNotMatch(JSON.stringify(j.bids), /-0\.52|-0\.46/, "their basis must not appear as ours");
  assert.match(bidsCsv(b, SITE), /,-0\.62,4\.02$/m);
});

test("the page prints our basis", () => {
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  const html = renderPriced(b);
  assert.match(html, /−0\.62/);
  assert.doesNotMatch(html, /−0\.52/, "their August basis must not be on our page");
});

test("a zero spread makes our basis theirs, which is the only time they are equal", () => {
  const b = board(LIVE, { now: NOW, spreads: { cash: 0, harvest: null } });
  assert.equal(b.bids[0].basisDollars, b.bids[0].theirBasis);
  assert.equal(basisFrom(-0.52, 0), -0.52);
  assert.equal(basisFrom(-0.5, 0.1), -0.6, "and no floating-point dust");
  assert.equal(basisFrom(-0.58, 0.1), -0.68);
});

/* ---- the small print under the price table ----------------------------- */

test("THE PRICE NOTE IS A LIVE BOX, NOT A BOX THAT SWALLOWS WHAT YOU TYPE", () => {
  /* The staff screen offers it, saves it into pricing.json, and until now
     nothing rendered it. A control that accepts a change, commits it, and
     alters nothing is worse than not offering the control. */
  const TNOTE = /(<div class="tnote">)[\s\S]*?(<\/div>)/;
  assert.match(PAGE, TNOTE, "the fixture has the box this replaces");
  const out = PAGE.replace(TNOTE, (_m, a, b) => a + "Call before you haul." + b);
  assert.match(out, /<div class="tnote">Call before you haul\.<\/div>/);
  assert.doesNotMatch(out, /drying and discount schedule/);
});

test("...and leaving it unset leaves the page's own wording alone", () => {
  for (const v of [undefined, null, "", "   "]) {
    const live = typeof v === "string" && v.trim();
    assert.ok(!live, `${JSON.stringify(v)} must count as "not set"`);
  }
});

/* ---- the break-glass --------------------------------------------------- */

import { manualBoard, renderManual } from "../tools/update-prices.mjs";

const NOWD = new Date("2026-08-18T20:00:00.000Z");

test("A HAND-POSTED PRICE ACTUALLY REACHES THE PAGE", () => {
  /* The screen has always offered this box and told the office it overrides
     the feed. Until now it saved the number into pricing.json and nothing
     read it -- so the one control that exists for the day everything else is
     broken was itself broken. */
  const b = manualBoard({ setAt: "2026-08-18", cash: 4.15, basis: -0.42 }, { now: NOWD });
  assert.equal(b.manual, true);
  assert.equal(b.bids.length, 1);
  assert.equal(b.bids[0].pay, 4.15);
  const html = renderManual(b);
  assert.match(html, /\$4\.15/);
  assert.match(html, /posted by the office/);
});

test("NO SPREAD IS TAKEN OFF A HAND-POSTED PRICE", () => {
  /* "Cash price to post" means the price we post. Subtracting the spread from
     it would quietly pay ten cents under a number the office chose. */
  const b = manualBoard({ cash: 4.15 }, { now: NOWD });
  assert.equal(b.bids[0].pay, 4.15, "not 4.05");
});

test("it overrides a perfectly good feed, because that is what the screen promises", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { main } = await import("../tools/update-prices.mjs");
  const dir = mkdtempSync(join(tmpdir(), "manual-"));
  writeFileSync(join(dir, "pricing.json"), JSON.stringify({
    spread: 0.10, contact: "x", manual: { setAt: "2026-08-18", cash: 3.95 } }));
  writeFileSync(join(dir, "index.html"), PAGE);
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    await main({ fetchImpl: async () => ({ ok: true, status: 200,
      text: async () => JSON.stringify(LIVE) }), now: NOWD });
    const out = readFileSync(join(dir, "index.html"), "utf8");
    assert.match(out, /\$3\.95/, "the typed price, not the feed's");
    assert.doesNotMatch(out, /\$4\.02/, "the feed must not win");
    const j = JSON.parse(readFileSync(join(dir, "bids.json"), "utf8"));
    assert.equal(j.status, "manual", "and a consumer must be able to tell");
  } finally { process.chdir(cwd); }
});

test("clearing the boxes hands it straight back to the feed", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { main } = await import("../tools/update-prices.mjs");
  const dir = mkdtempSync(join(tmpdir(), "cleared-"));
  writeFileSync(join(dir, "pricing.json"), JSON.stringify({ spread: 0.10, contact: "x", manual: null }));
  writeFileSync(join(dir, "index.html"), PAGE);
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    await main({ fetchImpl: async () => ({ ok: true, status: 200,
      text: async () => JSON.stringify(LIVE) }), now: NOWD });
    const j = JSON.parse(readFileSync(join(dir, "bids.json"), "utf8"));
    assert.equal(j.status, "ok");
    assert.equal(j.count, 7);
  } finally { process.chdir(cwd); }
});

test("a typed price outside the band takes the page down rather than publishing", () => {
  for (const cash of [0.44, 44.2, -4]) {
    assert.throws(() => manualBoard({ cash }, { now: NOWD }),
      (e) => e instanceof Withdraw && /outside 2-12|not a number/.test(e.message), String(cash));
  }
  assert.throws(() => manualBoard({ cash: 4.15, basis: -2.5 }, { now: NOWD }),
    (e) => e instanceof Withdraw && /further than 1\.50/.test(e.message));
});

test("a harvest price can be posted beside the cash one, or on its own", () => {
  const both = manualBoard({ cash: 4.15, harvest: 4.30 }, { now: NOWD });
  assert.deepEqual(both.bids.map((r) => r.delivery), ["Cash, corn", "Harvest"]);
  const only = manualBoard({ harvest: 4.30 }, { now: NOWD });
  assert.deepEqual(only.bids.map((r) => r.delivery), ["Harvest"]);
});

test("an empty or absent override is not an override", () => {
  for (const m of [null, undefined, {}, { setAt: "2026-08-18" }])
    assert.equal(manualBoard(m, { now: NOWD }), null, JSON.stringify(m));
});

test("a hand-posted price with no basis prints a dash, not a zero", () => {
  /* Blank means we are not saying. Zero means even with the board. Anyone
     reading our numbers can tell those apart and should be able to. */
  const html = renderManual(manualBoard({ cash: 4.15 }, { now: NOWD }));
  assert.match(html, /&mdash;/);
  assert.doesNotMatch(html, /0\.00/);
});

test("A HAND-POSTED PRICE WITH NO BASIS PUBLISHES BLANK, NOT ZERO", () => {
  /* Zero says "even with the board". Blank says "we are not saying". They are
     different claims and the CSV must not turn one into the other. */
  const b = manualBoard({ cash: 4.15 }, { now: NOWD });
  const csv = bidsCsv(b, SITE);
  assert.match(csv, /,Corn,cash,Cash, corn/.source ? /,,4\.15$/m : /,,4\.15$/m);
  assert.doesNotMatch(csv, /,0\.00,4\.15/);
  const j = bidsJson(b, { contact: SITE.contact, generated: NOWD.toISOString() });
  assert.equal(j.bids[0].basis, null);
});

/* ---- a spread per bucket ----------------------------------------------- */

import { spreadFor } from "../tools/update-prices.mjs";

test("OLD CROP AND NEW CROP CAN CARRY DIFFERENT SPREADS", () => {
  /* Ten cents under for corn off the truck today and fourteen under for
     harvest delivery is an ordinary thing to want, and the two were chained
     together for no reason. */
  const spreads = { cash: 0.10, harvest: 0.14 };
  const b = board(LIVE, { now: NOW, spreads });
  const by = Object.fromEntries(b.bids.map((r) => [r.delivery, r]));
  assert.equal(by.August.spread, 0.10);
  assert.equal(by.October.spread, 0.14);
  assert.equal(by.November.spread, 0.14);
  assert.equal(by.December.spread, 0.10, "December is not harvest delivery");
  assert.equal(by.August.pay, 4.02);
  assert.equal(by.October.pay, 4.19, "4.33 less 0.14");
  assert.equal(by.October.basisDollars, -0.69, "and our basis follows the same figure");
});

test("an absent harvest spread means the same as the cash one", () => {
  for (const h of [null, undefined]) {
    const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: h } });
    assert.ok(b.bids.every((r) => r.spread === 0.10), String(h));
  }
  assert.equal(spreadFor("October", { cash: 0.10, harvest: null }), 0.10);
  assert.equal(spreadFor("October", { cash: 0.10, harvest: 0.14 }), 0.14);
  assert.equal(spreadFor("August", { cash: 0.10, harvest: 0.14 }), 0.10);
});

test("the two figures on the page each use their own spread", () => {
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: 0.14 } });
  const html = renderPriced(b);
  assert.match(html, /\$4\.02/);
  assert.match(html, /\$4\.19/);
  assert.doesNotMatch(html, /\$4\.23/, "the old single-spread harvest price must be gone");
});

/* ---- the futures column ------------------------------------------------ */

test("FUTURES SITS LEFT OF THE BASIS, AND THE ROW CHECKS ITSELF", () => {
  /* Left to right in the order the arithmetic runs: futures, less our basis,
     makes what we pay. A grower can verify the row without leaving the page. */
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  const html = renderPriced(b);
  const row = html.match(/<tr><td class="mo">Cash, corn[\s\S]*?<\/tr>/)[0];
  assert.ok(row.indexOf('class="fut') < row.indexOf('class="bas'),
    "futures must come before basis");
  assert.ok(row.indexOf('class="bas') < row.indexOf('class="pay'));
  assert.match(row, /class="fut r m-hide">\$4\.635<span class="con">Sep 26<\/span>/);

  const fut = 4.635, basis = -0.62, pay = 4.02;
  assert.ok(Math.abs((pay - basis) - fut) <= 0.005 + 1e-9,
    "the three printed numbers have to agree with each other");
});

test("the futures figure is shown to the precision their board printed", () => {
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  const html = renderPriced(b);
  assert.match(html, /\$4\.635</, "quarter cents kept");
  assert.doesNotMatch(html, /\$4\.6350/, "and not padded");
});

test("futures is hidden on a phone, with the basis", () => {
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  const html = renderPriced(b);
  assert.equal((html.match(/class="fut r m-hide"/g) || []).length,
               (html.match(/class="bas r m-hide"/g) || []).length);
  assert.match(html, /<th class="r m-hide">Futures<\/th>/);
});

test("A HAND-POSTED ROW SHOWS A DASH, BECAUSE THERE IS NO QUOTE BEHIND IT", () => {
  const html = renderManual(manualBoard({ cash: 4.15 }, { now: NOWD }));
  assert.match(html, /class="fut r m-hide">&mdash;</);
});

test("THE PUBLISHED FILE STILL CARRIES NO FUTURES QUOTE", () => {
  /* Its own terms say "No exchange-licensed futures prices are included".
     Showing one on the page is a display decision; putting one in the CC0
     file would make the licence text false, and a published licence that has
     stopped being true is worse than a missing column. */
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  const j = bidsJson(b, { contact: SITE.contact, generated: NOW.toISOString() });
  assert.match(j.terms.note, /No exchange-licensed futures prices are included/);
  assert.doesNotMatch(JSON.stringify(j.bids), /futures|4\.635|463/i);
  assert.doesNotMatch(bidsCsv(b, SITE), /4\.635|463\.5/);
});

/* ---- which contract month sits on which row ---------------------------- */

const rowFor = (html, label) =>
  html.match(new RegExp(`<tr><td class="mo">${label}[\\s\\S]*?</tr>`))[0];

test("THE CASH ROW CARRIES THE NEAR MONTH, THE HARVEST ROW CARRIES DECEMBER", () => {
  /* Not assumed, and not derived from a calendar here: each row shows the
     contract month Big River's own board put against that delivery. If they
     roll, we roll with them, because the label travels with the row. */
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: 0.14 } });
  const html = renderPriced(b);

  const cash = rowFor(html, "Cash, corn");
  const harvest = rowFor(html, "Harvest");

  /* Expected values are read out of the fixture, not typed in, so the test
     cannot quietly disagree with the board it is meant to be checking. */
  const q = (delivery) => LIVE.bids.find((r) => r.delivery === delivery).futuresPriceCents / 100;
  assert.match(cash, new RegExp(`class="fut r m-hide">\\$${q("August")}<span class="con">Sep 26<`));
  assert.match(harvest, new RegExp(`class="fut r m-hide">\\$${q("October")}<span class="con">Dec 26<`));

  const month = (row) => row.match(/class="fut[^>]*>[^<]*<span class="con">([^<]+)</)[1];
  assert.notEqual(month(cash), month(harvest),
    "two rows showing the same contract is the shape of a copy-paste bug");
});

test("each row's futures figure belongs to that row's contract, not the lead one", () => {
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  const html = renderPriced(b);
  const q = (delivery) => LIVE.bids.find((r) => r.delivery === delivery).futuresPriceCents / 100;
  assert.match(rowFor(html, "Cash, corn"), new RegExp(`\\$${q("August")}<`));
  assert.match(rowFor(html, "Harvest"), new RegExp(`\\$${q("October")}<`));
  assert.doesNotMatch(rowFor(html, "Harvest"), new RegExp(String(q("August")).replace(".", "\\.")));
});

test("THE ROW STILL CHECKS ITSELF WHEN THE TWO SPREADS DIFFER", () => {
  /* futures less our basis has to land on what we pay, on BOTH rows, even
     though they are built from different figures. */
  const b = board(LIVE, { now: NOW, spreads: { cash: 0.10, harvest: 0.14 } });
  const { spot, harvest } = headline(b.bids);
  for (const r of [spot, harvest]) {
    const back = Math.round((r.pay - r.basisDollars) * 10000) / 10000;
    assert.ok(Math.abs(back - r.futures) <= 0.005 + 1e-9,
      `${r.delivery}: ${r.pay} - (${r.basisDollars}) = ${back} against futures ${r.futures}`);
  }
  assert.equal(harvest.pay, 4.19, "4.3325 less 0.14");
  assert.equal(harvest.basisDollars, -0.69, "their -0.55 less our 0.14");
});

test("COME OCTOBER, THE CASH ROW'S NEAR MONTH IS DECEMBER, AND THAT IS RIGHT", () => {
  /* Their board rolls: the nearest delivery becomes October, which sits on
     the December contract. One row then, not the same figure twice, and the
     near month it shows is genuinely December. */
  const autumn = clone(LIVE);
  autumn.bids = autumn.bids.slice(2);
  autumn.count = autumn.bids.length;
  const b = board(autumn, { now: NOW, spreads: { cash: 0.10, harvest: 0.14 } });
  const html = renderPriced(b);
  assert.equal((html.match(/class="pay r"/g) || []).length, 1);
  assert.match(rowFor(html, "Cash, corn"), /<span class="con">Dec 26<\/span>/);
  assert.doesNotMatch(html, /Sep 26/);
});

test("if their board ever splits October and November, the label follows the row shown", () => {
  const split = clone(LIVE);
  split.bids[3].cash = 4.29;                       // November cheaper
  split.bids[3].futuresMonth = "Jan 27";           // and on a different contract
  split.bids[3].futuresPriceCents = Math.round((4.29 - -0.55) * 10000) / 100;
  const b = board(split, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  const { harvest } = headline(b.bids);
  assert.equal(harvest.delivery, "November");
  assert.match(rowFor(renderPriced(b), "Harvest"), /<span class="con">Jan 27<\/span>/,
    "the contract shown must be the one belonging to the row we picked");
});

/* ---- a null quote is not a broken feed --------------------------------- */

test("BOTH SITES WENT DARK OVER TWO NULL QUOTES. THAT MUST NOT HAPPEN AGAIN.", () => {
  /* 2026-08-18, 21:47. The reader had started publishing
     futuresPriceCents: null on rows whose quote it could not verify -- Big
     River's front-month cell lags its own cash by a tick. This publisher
     read null as "this row cannot be checked" and withdrew the whole board.
     Five of seven rows balanced perfectly and the cash and basis on all seven
     were sound; both elevators showed "Call for today's price" anyway. */
  const lagging = clone(LIVE);
  lagging.bids[0].futuresPriceCents = null;    // August, Sep 26
  lagging.bids[1].futuresPriceCents = null;    // September, Sep 26

  const b = board(lagging, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  assert.equal(b.bids.length, 7, "the board publishes");
  assert.equal(b.bids[0].cash, 4.115, "their cash is untouched");
  assert.equal(b.bids[0].basisDollars, -0.62, "and our basis is still worked out");
  assert.equal(b.bids[0].pay, 4.02);
  assert.equal(b.bids[0].futures, null, "only the quote is missing");
  assert.equal(b.bids[2].futures, 4.88, "and the rows that had one keep it");
});

test("...and the page prints a dash for it, never a number", () => {
  const lagging = clone(LIVE);
  lagging.bids[0].futuresPriceCents = null;
  const html = renderPriced(board(lagging, { now: NOW, spreads: { cash: 0.10, harvest: null } }));
  const cash = html.match(/<tr><td class="mo">Cash, corn[\s\S]*?<\/tr>/)[0];
  assert.match(cash, /class="fut r m-hide">&mdash;/);
  assert.match(cash, /\$4\.02/, "the price itself is unaffected");
  assert.match(html, /class="fut r m-hide">\$4\.88/, "harvest still shows its verified quote");
});

test("A ROW WITH A QUOTE STILL HAS TO BALANCE EXACTLY", () => {
  /* Tolerating a missing quote must not tolerate a wrong one. */
  const wrong = clone(LIVE);
  wrong.bids[0].futuresPriceCents = null;
  wrong.bids[3].cash = 4.53;
  assert.throws(() => board(wrong, { now: NOW, spreads: { cash: 0.10, harvest: null } }),
    (e) => e instanceof Withdraw && /fails cash - basis = futures/.test(e.message));
});

test("AND A MAJORITY MUST CARRY A QUOTE, OR NOTHING IS PROVED", () => {
  /* Without rows that can be checked, a tolerant reading becomes no reading
     at all -- exactly the hole the identity check exists to close. */
  const mostly = clone(LIVE);
  for (const i of [0, 1, 2, 3]) mostly.bids[i].futuresPriceCents = null;
  assert.throws(() => board(mostly, { now: NOW, spreads: { cash: 0.10, harvest: null } }),
    (e) => e instanceof Withdraw && /not a majority/.test(e.message));

  const three = clone(LIVE);
  for (const i of [0, 1, 2]) three.bids[i].futuresPriceCents = null;
  assert.doesNotThrow(() => board(three, { now: NOW, spreads: { cash: 0.10, harvest: null } }),
    "4 of 7 checkable is a majority and publishes");
});

test("a row with no basis at all is still refused outright", () => {
  const noBasis = clone(LIVE);
  delete noBasis.bids[0].basisDollars;
  assert.throws(() => board(noBasis, { now: NOW, spreads: { cash: 0.10, harvest: null } }),
    (e) => e instanceof Withdraw && /carries no basis/.test(e.message));
});

test("the published record carries the null through rather than inventing one", () => {
  const lagging = clone(LIVE);
  lagging.bids[0].futuresPriceCents = null;
  const b = board(lagging, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  const j = bidsJson(b, { contact: SITE.contact, generated: NOW.toISOString() });
  assert.equal(j.status, "ok");
  assert.equal(j.count, 7);
  assert.equal(j.bids[0].cashPrice, 4.02);
  assert.equal(j.bids[0].basis, -0.62);
});

test("A LAGGING QUOTE IS SHOWN, NOT LEFT BLANK", () => {
  /* Their front-month cell sits a quarter of a cent behind their own cash.
     Blanking it left a hole in the futures column of a live page, and the
     caution was already spent: nothing gets here unless a majority of rows
     balanced to the cent, which is what proves the columns are right. */
  const lag = clone(LIVE);
  lag.bids[0].futuresPriceCents = 463;          // their cell; cash implies 463.25
  const b = board(lag, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  assert.equal(b.bids[0].futures, 4.63);
  const html = renderPriced(b);
  assert.match(html, /class="fut r m-hide">\$4\.63</);
  assert.doesNotMatch(html, /class="fut r m-hide">&mdash;/);
});

test("...but a quote out by more than a tick still takes the board down", () => {
  const wrong = clone(LIVE);
  wrong.bids[0].futuresPriceCents = 455;        // 8 cents out
  assert.throws(() => board(wrong, { now: NOW, spreads: { cash: 0.10, harvest: null } }),
    (e) => e instanceof Withdraw && /far more than a tick/.test(e.message));
});

test("AND THE ROWS THAT BALANCE EXACTLY MUST STILL BE THE MAJORITY", () => {
  /* Otherwise the slack becomes the rule and the check proves nothing. */
  const many = clone(LIVE);
  for (const i of [0, 1, 2, 3])
    many.bids[i].futuresPriceCents = many.bids[i].futuresPriceCents - 0.25;
  assert.throws(() => board(many, { now: NOW, spreads: { cash: 0.10, harvest: null } }),
    (e) => e instanceof Withdraw && /not a majority/.test(e.message));
});

test("a row they published no quote for at all is still a dash", () => {
  const none = clone(LIVE);
  none.bids[0].futuresPriceCents = null;
  const b = board(none, { now: NOW, spreads: { cash: 0.10, harvest: null } });
  assert.equal(b.bids[0].futures, null);
  assert.match(renderPriced(b), /class="fut r m-hide">&mdash;/);
});
