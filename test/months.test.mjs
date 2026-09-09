/* THE MONTHS THE OFFICE CHOOSES, AND THE ONE THING THAT MUST NOT MOVE.
 *
 * The page has always shown two rows: the nearest delivery, and the lower of
 * October and November under the heading "Harvest". Which two was not a
 * decision anybody made -- it was `headline()`, and it was right while there
 * was one spread for old crop and one for new. It stops being right the moment
 * the office wants to quote September and December and nothing else, which is
 * what Big River's own board does.
 *
 * THE THING THAT MUST NOT MOVE is everything else. With no `months` key in
 * pricing.json every function in update-prices.mjs has to behave exactly as it
 * did -- same rows, same labels, same arithmetic, same bytes. The first test
 * below asserts that on the rendered HTML rather than on a description of it,
 * because a compatibility claim checked against a paraphrase is not checked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  board, renderPriced, publishedRows, basisFor, monthTable, payFromBasis,
  bidsJson, Withdraw, BASIS_ABS_MAX, HARVEST_MONTHS,
} from "../tools/update-prices.mjs";

/* The same live payload the rest of the suite uses, read from dnilgis/bids on
   2026-08-18. Seven months, August through February, in their board order. */
const LIVE = {
  schema: "bigriver-boyceville/2",
  source: { location: "Boyceville" },
  checkedAt: "2026-08-18T15:32:47.900Z",
  pricedAt: "2026-08-18T15:32:47.900Z",
  status: "ok",
  count: 7,
  bids: [
    { seq: 0, commodity: "Corn", delivery: "August",    futuresMonth: "Sep 26", cash: 4.115,  basisDollars: -0.52, futuresPriceCents: 463.5 },
    { seq: 1, commodity: "Corn", delivery: "September", futuresMonth: "Sep 26", cash: 4.175,  basisDollars: -0.46, futuresPriceCents: 463.5 },
    { seq: 2, commodity: "Corn", delivery: "October",   futuresMonth: "Dec 26", cash: 4.33,   basisDollars: -0.55, futuresPriceCents: 488 },
    { seq: 3, commodity: "Corn", delivery: "November",  futuresMonth: "Dec 26", cash: 4.33,   basisDollars: -0.55, futuresPriceCents: 488 },
    { seq: 4, commodity: "Corn", delivery: "December",  futuresMonth: "Dec 26", cash: 4.38,   basisDollars: -0.5,  futuresPriceCents: 488 },
    { seq: 5, commodity: "Corn", delivery: "January",   futuresMonth: "Mar 27", cash: 4.4375, basisDollars: -0.6,  futuresPriceCents: 503.75 },
    { seq: 6, commodity: "Corn", delivery: "February",  futuresMonth: "Mar 27", cash: 4.4575, basisDollars: -0.58, futuresPriceCents: 503.75 },
  ],
};
const NOW = new Date("2026-08-18T15:56:49.578Z");
const clone = (o) => JSON.parse(JSON.stringify(o));
const SPREADS = { cash: 0.10, harvest: null };
const rowsOf = (html) => [...html.matchAll(/<td class="mo">([^<]*)/g)].map((m) => m[1]);

const on = (...months) =>
  Object.fromEntries(months.map((m) => [m, { basis: null, publish: true }]));

/* ── the compatibility contract ─────────────────────────────────────────── */

test("NO MONTHS IN pricing.json LEAVES THE PAGE EXACTLY AS IT WAS", () => {
  /* Byte-for-byte on the rendered panel, both paths. If this ever fails, the
     per-month work has changed a site that never asked for it. */
  const spreadWas = renderPriced(board(LIVE, { now: NOW, spreads: SPREADS }));
  const spreadNow = renderPriced(board(LIVE, { now: NOW, spreads: SPREADS, basis: null }));
  assert.equal(spreadNow, spreadWas);

  const b = board(LIVE, { now: NOW, spreads: SPREADS, basis: { cash: -0.75, harvest: -0.62 } });
  const withKey = board(LIVE, { now: NOW, spreads: SPREADS,
                                basis: { cash: -0.75, harvest: -0.62, months: null } });
  assert.equal(renderPriced(withKey), renderPriced(b),
    "a months key set to null is not the same as no months key");
  assert.deepEqual(rowsOf(renderPriced(b)), ["Cash, corn", "Harvest"]);
});

test("an empty months table is the same as no months table", () => {
  /* monthTable() collapses {} to null on the way in, so this can never reach
     board() as an object with no keys -- but board() is exported and the tests
     drive it directly, so the collapse is asserted at both ends. */
  assert.equal(monthTable({ months: {} }), null);
  assert.equal(monthTable({ months: null }), null);
  assert.equal(monthTable({}), null);
});

/* ── which months show ──────────────────────────────────────────────────── */

test("the page shows the ticked months and nothing else", () => {
  const b = board(LIVE, { now: NOW, spreads: SPREADS,
    basis: { cash: -0.75, harvest: null, months: on("September", "December") } });
  const html = renderPriced(b);
  assert.deepEqual(rowsOf(html), ["September", "December"]);
  assert.equal((html.match(/class="pay r"/g) || []).length, 2);
  /* Scoped to the delivery cells. The first version of this matched the whole
     panel for /August/ and failed on the "as of Tuesday, August 18" stamp in
     the header -- a real month name, in a place that has nothing to do with
     which months are published. */
  for (const m of ["Cash, corn", "Harvest", "August", "October", "November", "January", "February"])
    assert.ok(!rowsOf(html).includes(m), `${m} is on the record, not on the page`);
});

test("THE ORDER IS THEIR BOARD'S, not the order somebody ticked them in", () => {
  /* Ticked back to front. A page that lists December above September is a page
     whose order came from an object literal, and object order is not a
     decision anybody made about a price board. */
  const months = { December: { publish: true }, September: { publish: true },
                   August: { publish: true } };
  const b = board(LIVE, { now: NOW, spreads: SPREADS,
                          basis: { cash: -0.75, harvest: null, months } });
  assert.deepEqual(rowsOf(renderPriced(b)), ["August", "September", "December"]);
});

test("one ticked month is a one-row page, and eleven is an eleven-row page", () => {
  const one = board(LIVE, { now: NOW, spreads: SPREADS,
    basis: { cash: -0.75, harvest: null, months: on("October") } });
  assert.deepEqual(rowsOf(renderPriced(one)), ["October"]);

  const all = LIVE.bids.map((r) => r.delivery);
  const every = board(LIVE, { now: NOW, spreads: SPREADS,
    basis: { cash: -0.75, harvest: null, months: on(...all) } });
  assert.deepEqual(rowsOf(renderPriced(every)), all);
});

test("publish is a tick, not a truthy value", () => {
  /* "true", 1 and "yes" all arrive from somebody hand-editing pricing.json, and
     all three used to be the difference between a month showing and not. Only
     the boolean counts. */
  for (const v of ["true", 1, "yes", {}, []]) {
    const months = { September: { publish: v }, October: { publish: true } };
    const b = board(LIVE, { now: NOW, spreads: SPREADS,
                            basis: { cash: -0.75, harvest: null, months } });
    assert.deepEqual(rowsOf(renderPriced(b)), ["October"],
      `publish: ${JSON.stringify(v)} put a month on the page`);
  }
});

test("publishedRows returns null with no table, so the old path is untouched", () => {
  assert.equal(publishedRows(LIVE.bids, null), null);
  assert.equal(publishedRows(LIVE.bids, undefined), null);
});

/* ── nothing to show ────────────────────────────────────────────────────── */

test("NOTHING TICKED WITHDRAWS THE PRICE, it does not print an empty table", () => {
  const months = { September: { publish: false }, October: { publish: false } };
  assert.throws(
    () => board(LIVE, { now: NOW, spreads: SPREADS,
                        basis: { cash: -0.75, harvest: null, months } }),
    (e) => e instanceof Withdraw && /no delivery months are ticked/.test(e.message));
});

test("a month ticked that is not on their board today says which one", () => {
  /* Their board shrinks through the season: come November there is no August
     row to show. That is their board, not a fault here, and the message has to
     name the month or nobody can tell those two apart. */
  const months = on("July");
  assert.throws(
    () => board(LIVE, { now: NOW, spreads: SPREADS,
                        basis: { cash: -0.75, harvest: null, months } }),
    (e) => e instanceof Withdraw && /ticked to publish \(July\) are not on their board/.test(e.message));
});

test("a ticked month missing from their board does not stop the others showing", () => {
  const b = board(LIVE, { now: NOW, spreads: SPREADS,
    basis: { cash: -0.75, harvest: null, months: on("July", "October") } });
  assert.deepEqual(rowsOf(renderPriced(b)), ["October"]);
});

/* ── the basis a month is priced on ─────────────────────────────────────── */

test("A MONTH'S OWN BASIS IS WHAT IT POSTS", () => {
  const months = {
    September: { basis: -0.20, publish: true },
    October:   { basis: -0.90, publish: true },
  };
  const b = board(LIVE, { now: NOW, spreads: SPREADS,
                          basis: { cash: -0.75, harvest: -0.62, months } });
  const by = Object.fromEntries(b.bids.map((r) => [r.delivery, r]));
  assert.equal(by.September.basisDollars, -0.20);
  assert.equal(by.October.basisDollars, -0.90, "the harvest bucket beat the month's own number");
  assert.equal(by.August.basisDollars, -0.75, "an unlisted month still takes the cash basis");
  assert.equal(by.November.basisDollars, -0.62, "an unlisted new-crop month still takes the harvest basis");
});

test("a listed month with no basis falls through to the bucket, not to zero", () => {
  /* A blank box is "I did not set one", and pricing it at zero is a dollar and a
     half of swing from a field nobody filled in. */
  const months = { September: { publish: true }, October: { publish: true } };
  const b = board(LIVE, { now: NOW, spreads: SPREADS,
                          basis: { cash: -0.75, harvest: -0.62, months } });
  const by = Object.fromEntries(b.bids.map((r) => [r.delivery, r]));
  assert.equal(by.September.basisDollars, -0.75);
  assert.equal(by.October.basisDollars, -0.62);
});

test("basisFor takes a month's own number over both buckets, and only a number", () => {
  const basis = { cash: -0.75, harvest: -0.62,
                  months: { October: { basis: -0.90 }, November: { basis: null },
                            August: { basis: "-0.10" } } };
  assert.equal(basisFor("October", basis), -0.90);
  assert.equal(basisFor("November", basis), -0.62, "null must fall through, not price at null");
  assert.equal(basisFor("August", basis), -0.75, "a string is not a basis");
  assert.equal(basisFor("December", basis), -0.75);
  assert.ok(HARVEST_MONTHS.includes("November"));
});

test("EVERY PUBLISHED ROW STILL CHECKS ITSELF: futures plus its own basis, to the cent", () => {
  const months = {
    September: { basis: -0.20, publish: true },
    December:  { basis: 0.05,  publish: true },
    January:   { basis: -1.10, publish: true },
  };
  const b = board(LIVE, { now: NOW, spreads: SPREADS,
                          basis: { cash: -0.75, harvest: null, months } });
  for (const r of b.bids) {
    const want = payFromBasis(r.futures, r.basisDollars);
    assert.equal(r.pay, want, `${r.delivery} posts ${r.pay}, not ${want}`);
  }
  const html = renderPriced(b);
  for (const m of ["September", "December", "January"]) {
    const row = html.match(new RegExp(`<td class="mo">${m}[\\s\\S]*?</tr>`))[0];
    const r = b.bids.find((x) => x.delivery === m);
    assert.ok(row.includes("$" + r.pay.toFixed(2)),
      `the ${m} row does not carry ${r.pay.toFixed(2)}`);
  }
});

test("a per-month basis past the cap is refused, either sign", () => {
  for (const bad of [BASIS_ABS_MAX + 0.01, -(BASIS_ABS_MAX + 0.01), 12]) {
    assert.throws(() => monthTable({ months: { October: { basis: bad, publish: true } } }),
      /further than 1\.5 from zero/, `months.October.basis ${bad} was accepted`);
  }
  assert.doesNotThrow(() => monthTable({ months: { October: { basis: BASIS_ABS_MAX, publish: true } } }));
  assert.doesNotThrow(() => monthTable({ months: { October: { basis: -BASIS_ABS_MAX, publish: true } } }));
});

test("board() refuses a per-month basis past the cap as well, not only the reader", () => {
  /* board() is exported and is what the tests drive; the cap is checked in both
     places for the same reason the file already checks it twice. */
  assert.throws(
    () => board(LIVE, { now: NOW, spreads: SPREADS,
      basis: { cash: -0.75, harvest: null, months: { October: { basis: -1.9, publish: true } } } }),
    (e) => e instanceof Withdraw && /further than 1\.5 from zero/.test(e.message));
});

/* ── the shape of the table itself ──────────────────────────────────────── */

test("a months table that is not a table of months is refused, with the value in the message", () => {
  assert.throws(() => monthTable({ months: [] }), /months must be an object/);
  assert.throws(() => monthTable({ months: "September" }), /months must be an object/);
  assert.throws(() => monthTable({ months: { October: 5 } }), /months\.October must be an object/);
  assert.throws(() => monthTable({ months: { October: [] } }), /months\.October must be an object/);
  assert.throws(() => monthTable({ months: { October: { basis: "x" } } }), /months\.October\.basis must be a number/);
  assert.throws(() => monthTable({ months: { October: { basis: Infinity } } }), /months\.October\.basis must be a number/);
});

test("monthTable normalises what it keeps, so board() never sees a half-filled entry", () => {
  const t = monthTable({ months: { October: { basis: -0.9, publish: true },
                                   November: {}, December: { publish: false } } });
  assert.deepEqual(t, {
    October:  { basis: -0.9, publish: true },
    November: { basis: null, publish: false },
    December: { basis: null, publish: false },
  });
});

/* ── the record is not the page ─────────────────────────────────────────── */

test("THE PAGE SHOWS WHAT WAS TICKED; THE RECORD STILL KEEPS EVERY ROW", () => {
  const b = board(LIVE, { now: NOW, spreads: SPREADS,
    basis: { cash: -0.75, harvest: null, months: on("September") } });
  assert.equal(rowsOf(renderPriced(b)).length, 1);
  const j = bidsJson(b, { contact: "x@example.com", generated: NOW.toISOString() });
  assert.equal(j.bids.length, LIVE.bids.length,
    "bids.json is the record and must carry the whole board whatever the page shows");
  assert.equal(j.count, LIVE.bids.length);
});

test("rendering with months is idempotent", () => {
  const b = board(LIVE, { now: NOW, spreads: SPREADS,
    basis: { cash: -0.75, harvest: null, months: on("September", "October") } });
  assert.equal(renderPriced(b), renderPriced(b));
});

test("the rows a months table renders use only classes site.css defines", () => {
  const css = readFileSync(new URL("../site.css", import.meta.url), "utf8");
  const b = board(LIVE, { now: NOW, spreads: SPREADS,
    basis: { cash: -0.75, harvest: null, months: on("September", "October", "January") } });
  for (const m of renderPriced(b).matchAll(/class="([^"]+)"/g))
    for (const cls of m[1].split(/\s+/).filter(Boolean))
      assert.ok(new RegExp("\\." + cls + "\\b").test(css),
        `the panel uses .${cls} and site.css does not define it`);
});

/* ── the whole publish path ─────────────────────────────────────────────── */

test("THE PUBLISH PATH RUNS WITH A MONTHS TABLE, not only board() in isolation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "months-main-"));
  const cwd = process.cwd();
  try {
    cpSync(join(cwd, "index.html"), join(dir, "index.html"));
    writeFileSync(join(dir, "pricing.json"), JSON.stringify({
      spread: 0, basis: -0.75, basisHarvest: -0.62,
      months: { September: { basis: -0.20, publish: true },
                December:  { basis: -0.40, publish: true },
                October:   { basis: -0.90, publish: false } },
      company: "Test", location: "Test", city: "Test", state: "WI",
      contact: "x@example.com", price_note: null, manual: null,
    }));
    process.chdir(dir);
    const feed = { ...clone(LIVE), checkedAt: new Date().toISOString(),
                   pricedAt: new Date().toISOString() };
    const { main } = await import("../tools/update-prices.mjs");
    await main({ fetchImpl: async () => ({ ok: true, json: async () => feed,
                                           text: async () => JSON.stringify(feed) }),
                 now: new Date() });
    const html = readFileSync(join(dir, "index.html"), "utf8");
    assert.deepEqual(rowsOf(html), ["September", "December"]);
    /* Through the code's own rounding rule, never a second implementation. */
    const sep = payFromBasis(4.635, -0.20).toFixed(2);
    const dec = payFromBasis(4.88, -0.40).toFixed(2);
    assert.ok(html.includes("$" + sep), `the page does not carry September at $${sep}`);
    assert.ok(html.includes("$" + dec), `the page does not carry December at $${dec}`);
    assert.ok(!/<td class="mo">October/.test(html), "an unticked month reached the page");
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   A MONTHS TABLE WITH NO SITE-WIDE BASIS
   ══════════════════════════════════════════════════════════════════════════
   THIS IS THE SHAPE THE STAFF SCREEN ACTUALLY WRITES, and it took badgergrain
   dark for ten hours on 2026-09-09. The fallback basis was removed from the
   screen on 09-08 -- Sig: "why do we need fallback basis at all" -- so the
   applier has written `months` and no `basis` ever since. The guard here
   refused exactly that combination, because it was written when `months` was
   an addition to the single-basis model and "no top-level basis" still meant
   "on the old spread path".

   Three cases, because the distinction is the whole point: a table that CAN
   price publishes, a ticked month that CANNOT is refused by name, and an
   unticked one that cannot is simply not on the board.
   ══════════════════════════════════════════════════════════════════════════ */
const withPricing = async (pricing, fn) => {
  const dir = mkdtempSync(join(tmpdir(), "months-nobasis-"));
  const cwd = process.cwd();
  try {
    cpSync(join(cwd, "index.html"), join(dir, "index.html"));
    writeFileSync(join(dir, "pricing.json"),
                  JSON.stringify({ contact: "x@example.com", ...pricing }));
    process.chdir(dir);
    const { main } = await import("../tools/update-prices.mjs");
    return await fn(main, dir);
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
};
const feedArg = { fetchImpl: async () => ({ ok: true, json: async () => LIVE,
                                            text: async () => JSON.stringify(LIVE) }),
                  now: NOW };

test("A MONTHS TABLE THAT CAN PRICE NEEDS NO SITE-WIDE BASIS", async () => {
  /* badgergrain's own file, 2026-09-09: every month carries its own figure and
     there is no `basis` anywhere. This threw on every run for ten hours. */
  const months = {};
  for (const [m, b] of [["August", -0.52], ["September", -0.46], ["October", -0.55],
                        ["November", -0.57], ["December", -0.50], ["January", -0.60]])
    months[m] = { basis: b, publish: m === "September" || m === "October" };
  await withPricing({ spread: 0, months }, async (main, dir) => {
    await main(feedArg);
    const bids = JSON.parse(readFileSync(join(dir, "bids.json"), "utf8"));
    assert.ok(bids.bids.length, "a months table that can price published nothing");
  });
});

test("a TICKED month with no basis anywhere is refused, by name", async () => {
  /* The fault the old guard was really for, and it still stops the run -- but
     now it names the month the office has to fix rather than the file. */
  await withPricing(
    { spread: 0, months: { September: { publish: true }, October: { basis: -0.6, publish: true } } },
    async (main) => {
      await assert.rejects(main(feedArg), (e) => {
        assert.match(e.message, /September/, "the refusal does not name the month at fault");
        assert.doesNotMatch(e.message, /^October/, "it named a month that is fine");
        assert.match(e.message, /untick|Type a basis/, "it does not say what to do about it");
        return true;
      });
    });
});

test("an UNTICKED month with no basis does not take the site down", async () => {
  /* A month nobody is publishing, with a blank box, is not a reason to withdraw
     every price on the page. It is simply not on the board. */
  const months = { September: { basis: -0.46, publish: true },
                   December: { publish: false } };
  await withPricing({ spread: 0, months }, async (main, dir) => {
    await main(feedArg);
    const bids = JSON.parse(readFileSync(join(dir, "bids.json"), "utf8"));
    assert.ok(bids.bids.length, "an unticked blank month withdrew the whole board");
    assert.ok(!bids.bids.some((b) => b.delivery === "December"),
              "a month with no basis was priced anyway");
  });
});
