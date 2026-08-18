#!/usr/bin/env node
/* Put today's corn bid on the page, or take it off.

   The price is read from Big River's board by the `bids` repository and
   committed there as JSON. This reads that file and renders it into
   index.html. Nothing here scrapes anything; if the reader is broken this
   script's only job is to notice and say nothing rather than say something
   wrong.

   THE RULE THIS FILE EXISTS TO ENFORCE: a price goes on the page only when
   we can still see the reader working. Not when the market is quiet -- a
   board that has not moved since Friday is a true price on Monday morning --
   but when we no longer KNOW. Those are different, they have different
   clocks, and confusing them is how a dead reader publishes yesterday's
   number as today's.

     checkedAt   the last time the reader successfully read their board.
                 This is reader health. If it goes cold, we withdraw.
     pricedAt    the last time their board showed something different.
                 This can be days old over a quiet weekend and nothing is
                 wrong. It is never a reason to withdraw. It IS what the
                 page shows as "as of", so the page cannot imply a price
                 is fresher than it is.

   Withdrawing looks like `update-today.mjs` removing the hours box: the
   panel goes back to "Call for today's price". A page that cannot know
   the price should not pretend to.
*/
import { readFileSync, writeFileSync } from "node:fs";

/* ---- the decisions, all in one place ---------------------------------- */

const FEED_URL =
  "https://raw.githubusercontent.com/dnilgis/bids/main/data/boyceville.json";

/* How cold `checkedAt` may get before we stop publishing. The reader
   heartbeats every 6 hours even when the price has not moved, so anything
   past 14 means it has missed two heartbeats in a row and we are no longer
   watching a live board. Matches the figure the Cloudflare publisher used,
   so moving to Actions does not quietly change when the sites go dark. */
const FEED_MAX_AGE_H = 14;

/* A corn cash bid outside this is a decimal point in the wrong place, not a
   market. Same band the reader itself enforces. A sanity rail, not a
   forecast. */
const FLOOR = 2.0, CEILING = 12.0;

export const CONFIG = { FEED_URL, FEED_MAX_AGE_H, FLOOR, CEILING };

/* ---- money ------------------------------------------------------------ */

/* Their cash carries quarter cents (4.4375). What we pay a grower is a
   number in cents, so it has to be rounded, and the rounding rule has to
   live in exactly one place or the staff screen and the public page will
   disagree by a cent and nobody will be able to say which is right.

   Nearest cent, halves away from zero. NOT truncation: truncation always
   rounds in the elevator's favour, which is a thumb on the scale even when
   it is only ever worth half a cent. */
export function payFrom(cash, spread) {
  const exact = cash - spread;
  return Math.sign(exact) * Math.round(Math.abs(exact) * 100) / 100;
}

/* OUR BASIS, NOT THEIRS.
 *
 * We pay a fixed amount under Big River, and because cash = futures + basis,
 * taking ten cents off their cash is the same arithmetic as taking ten cents
 * off their basis. The number a grower sees beside OUR price therefore has
 * to be OUR basis, or the two do not belong to each other.
 *
 * This was wrong first time round: the page printed their basis next to our
 * price, and the pair failed the identity check the whole system is built
 * on -- 4.02 - (-0.52) is 4.54, not the 4.635 their board quoted. Anyone
 * checking our numbers against the board would have found a discrepancy we
 * had manufactured ourselves.
 *
 * Their basis stays in the reader's own file, where it is theirs and correct. */
export const basisFrom = (basis, spread) =>
  Math.round((basis - spread) * 10000) / 10000;

export const money = (n) => "$" + n.toFixed(2);

/* Basis the way it is said out loud: -0.52, not -$0.52 and not "52 under".
   Zero is shown as 0.00 and means even with the board, which is a claim.
   Absent means we are not saying, which is a different claim. */
export const basisText = (b) =>
  (b < 0 ? "−" : b > 0 ? "+" : "") + Math.abs(b).toFixed(2);

/* ---- reading the feed ------------------------------------------------- */

export class Withdraw extends Error {}

/* Everything that decides whether a price may be published. Pure, so the
   tests can put it in every state a real calendar produces without a
   network or a clock. */
export function board(feed, { now, spread, maxAgeH = FEED_MAX_AGE_H } = {}) {
  if (!feed || typeof feed !== "object")
    throw new Withdraw("the feed file did not parse as an object");

  if (typeof feed.checkedAt !== "string" || !Number.isFinite(Date.parse(feed.checkedAt)))
    throw new Withdraw("the feed carries no readable checkedAt, so its age cannot be known");

  const ageH = (now.getTime() - Date.parse(feed.checkedAt)) / 36e5;

  /* A checkedAt in the future is not fresh, it is a broken clock, and it
     used to read as perpetually current because the subtraction went
     negative. Treat anything more than a few minutes ahead as unusable. */
  if (ageH < -0.25)
    throw new Withdraw(
      `the feed's checkedAt is ${Math.abs(ageH).toFixed(1)}h in the FUTURE; ` +
      `a clock is wrong and the age cannot be trusted`);

  if (ageH > maxAgeH)
    throw new Withdraw(
      `the reader last succeeded ${ageH.toFixed(1)}h ago, past the ${maxAgeH}h limit; ` +
      `we are no longer watching a live board`);

  const rows = Array.isArray(feed.bids) ? feed.bids : [];
  if (!rows.length) throw new Withdraw("the feed carries no rows");

  if (feed.count != null && feed.count !== rows.length)
    throw new Withdraw(
      `the feed says count ${feed.count} but carries ${rows.length} rows; ` +
      `the file is not internally consistent`);

  const out = [];
  for (const b of rows) {
    if (typeof b.cash !== "number" || !Number.isFinite(b.cash))
      throw new Withdraw(`${b.delivery ?? "a row"} has no usable cash price`);
    if (b.cash < FLOOR || b.cash > CEILING)
      throw new Withdraw(
        `${b.delivery} cash is ${b.cash}, outside ${FLOOR}-${CEILING}; ` +
        `that is a decimal point in the wrong place, not a market`);

    /* THE IDENTITY CHECK. The only guard that proves a number came from the
       right COLUMN rather than merely looking plausible: their own three
       figures have to agree with each other. A row we cannot test is a row
       we do not publish. */
    if (typeof b.basisDollars !== "number" || typeof b.futuresPriceCents !== "number")
      throw new Withdraw(
        `${b.delivery} cannot be checked: cash - basis = futures needs all three ` +
        `and this row does not carry them`);

    const derived = Math.round((b.cash - b.basisDollars) * 10000) / 10000;
    if (Math.abs(derived * 100 - b.futuresPriceCents) > 1e-6)
      throw new Withdraw(
        `${b.delivery} fails cash - basis = futures: ` +
        `${b.cash} - (${b.basisDollars}) = ${derived} but their page quotes ` +
        `${b.futuresPriceCents / 100}. One of the columns has moved.`);

    out.push({
      seq: typeof b.seq === "number" ? b.seq : out.length,
      commodity: b.commodity ?? "Corn",
      delivery: b.delivery,
      futuresMonth: b.futuresMonth ?? null,
      cash: b.cash,
      theirBasis: b.basisDollars,                // kept for the log, never shown
      basisDollars: basisFrom(b.basisDollars, spread),   // ours
      pay: payFrom(b.cash, spread),
    });
  }

  /* Their page order is the delivery order. It is NOT derivable from the
     month names -- sorting those alphabetically puts April first. */
  out.sort((a, b) => a.seq - b.seq);

  return {
    bids: out,
    pricedAt: typeof feed.pricedAt === "string" ? feed.pricedAt : feed.checkedAt,
    checkedAt: feed.checkedAt,
    sourceStale: feed.status === "stale",
    ageH,
  };
}

/* ---- rendering -------------------------------------------------------- */

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
           .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* "as of" is built from pricedAt, not from the moment this ran. That is
   what makes the file idempotent: a run that changes nothing writes nothing,
   so the repository does not fill with commits that say the same thing. */
export const asOf = (iso) =>
  new Date(iso).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "America/Chicago",
  });

/* WHAT THE PUBLIC PAGE SHOWS.
 *
 * The whole Boyceville board is captured -- all of it goes into bids.json
 * and bids.csv, because that is the record. The PAGE shows two numbers, and
 * only two: what we pay for corn off the truck today, and what we will pay
 * for harvest delivery.
 *
 * A grower standing in the yard is deciding one of two things: haul now, or
 * book some of the crop. Seven delivery months in a column makes him do the
 * sorting himself, and the two that matter are not adjacent in it.
 *
 * Harvest is the October-November window. If the board quotes those two
 * months differently we show the LOWER of them, because the figure is
 * offered across the whole window and the higher one would be a promise we
 * had not made. The months are named on the page either way. */
export const HARVEST_MONTHS = ["October", "November"];

export function headline(bids) {
  const spot = bids[0] ?? null;          // page order is delivery order
  const inHarvest = bids.filter((b) => HARVEST_MONTHS.includes(b.delivery));
  let harvest = inHarvest.length
    ? inHarvest.reduce((lo, r) => (r.pay < lo.pay ? r : lo))
    : null;
  /* Come October the nearest delivery IS harvest. One row, not the same
     number printed twice under two headings. */
  if (harvest && spot && harvest.delivery === spot.delivery) harvest = null;
  return { spot, harvest, window: inHarvest.map((r) => r.delivery) };
}

const line = (label, sub, r) =>
  `          <tr><td class="mo">${esc(label)}` +
  (sub ? `<span class="con">${esc(sub)}</span>` : "") + `</td>` +
  `<td class="bas r m-hide">${basisText(r.basisDollars)}</td>` +
  `<td class="pay r">${money(r.pay)}</td></tr>`;

export function renderPriced(b) {
  const { spot, harvest, window } = headline(b.bids);
  if (!spot) throw new Withdraw("no rows to lead with");

  const rows = [line("Cash, corn", `${spot.delivery} delivery`, spot)];
  if (harvest)
    rows.push(line("Harvest", window.join(" and ") + " delivery", harvest));

  return `      <div class="hd">Prices paid today<span class="as">as of ${esc(asOf(b.pricedAt))}</span></div>
      <table class="bids">
        <thead>
          <tr><th>Delivery</th><th class="r m-hide">Basis</th><th class="r">We pay</th></tr>
        </thead>
        <tbody>
${rows.join("\n")}
        </tbody>
      </table>`;
}

export const renderWithdrawn = () =>
  `      <div class="hd">Prices paid today</div>
      <div class="nobid">
        <p class="nobid-h">Call for today&rsquo;s price</p>
        <p class="nobid-p">We are posting prices here shortly. Ring the office and we will give you today&rsquo;s number.</p>
      </div>`;

/* Replace only what sits between the panel's opening div and the standing
   note underneath it. Everything else on the page -- the call button, the
   terms line, the hours panel -- is not ours to touch. */
const REGION =
  /(<div class="pricecol" id="prices">\s*<div class="panel">\n)([\s\S]*?)(\n\s*<div class="tnote">)/;

export function writeRegion(html, inner) {
  if (!REGION.test(html))
    throw new Error(
      "could not find the price panel in index.html. The page layout has " +
      "changed, and guessing where the price goes is exactly the thing this " +
      "script must never do.");
  return html.replace(REGION, (_m, open, _old, tail) => open + inner + tail);
}

/* ---- the published record --------------------------------------------- */

/* SCHEMA NOTE. The sites published `emmert-cash-bids/1`, whose only clock was
   `observed`. That single field conflated two different facts -- when we last
   read the feed, and when the price itself last moved -- which is the exact
   confusion that made a quiet weekend look like a dead reader in the reader
   repository. `/2` adds `pricedAt` and keeps `observed` meaning what it always
   meant, so a consumer written against `/1` still finds every field it knew.
   The version is bumped rather than the field quietly added: adding a field
   while still claiming `/1` is how a published contract stops being one. */
export function bidsJson(b, { contact, generated }) {
  return {
    schema: "emmert-cash-bids/2",
    generated,
    observed: b ? b.checkedAt : null,
    pricedAt: b ? b.pricedAt : null,
    status: b ? "ok" : "stale",
    terms: {
      licence: "CC0-1.0",
      note:
        "Cash bids and basis are the posting companies' own numbers, free to use, " +
        "reproduce and redistribute. No exchange-licensed futures prices are included. " +
        "Bids are indications, not offers, and change without notice. Call the elevator " +
        "to confirm before hauling.",
      contact,
    },
    count: b ? b.bids.length : 0,
    bids: b ? b.bids.map((r) => ({
      commodity: r.commodity,
      delivery: r.delivery,
      basis: r.basisDollars,
      cashPrice: r.pay,
    })) : [],
    _company: undefined,
  };
}

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export const CSV_HEADER =
  "location,company,city,state,commodity,bidType,deliveryStart,deliveryEnd," +
  "futuresSymbol,basis,cashPrice";

export function bidsCsv(b, site) {
  if (!b) return CSV_HEADER + "\n";
  const rows = b.bids.map((r) => [
    site.location, site.company, site.city, site.state,
    r.commodity, "cash", r.delivery, r.delivery,
    "",                       // futures symbol deliberately blank; see terms
    r.basisDollars.toFixed(2), r.pay.toFixed(2),
  ].map(csvCell).join(","));
  return [CSV_HEADER, ...rows].join("\n") + "\n";
}

/* ---- what actually runs ------------------------------------------------ */

/* Writes only when the content differs. A run that changes nothing must
   leave the repository untouched, or every quiet fifteen minutes becomes a
   commit and the git history stops being a record of prices. */
function writeIfChanged(path, next) {
  let before = null;
  try { before = readFileSync(path, "utf8"); } catch { /* new file */ }
  if (before === next) return false;
  writeFileSync(path, next);
  return true;
}

export async function main({ fetchImpl = fetch, now = new Date() } = {}) {
  const site = JSON.parse(readFileSync("pricing.json", "utf8"));
  const spread = site.spread;
  if (spread === null)
    throw new Error(
      "pricing.json has no spread yet.\n" +
      "  This is the number that decides what a grower is paid, and nobody has\n" +
      "  told this repository what it is. It is left null on purpose: a\n" +
      "  plausible-looking default here would put a real price on a real page\n" +
      "  on the strength of a guess.\n" +
      "  Set \"spread\" in pricing.json to the dollars-under-Big-River figure the\n" +
      "  owners have agreed, then run again. Until then no price is published,\n" +
      "  and the page keeps saying 'Call for today's price', which is true.");
  if (typeof spread !== "number" || !Number.isFinite(spread) || spread < 0)
    throw new Error(`pricing.json spread must be a number at or above zero, got ${JSON.stringify(spread)}`);

  let b = null, why = null;
  try {
    const res = await fetchImpl(FEED_URL, { cache: "no-store" });
    if (!res.ok) throw new Withdraw(`the feed returned HTTP ${res.status}`);
    b = board(JSON.parse(await res.text()), { now, spread });
  } catch (e) {
    if (!(e instanceof Withdraw) && !(e instanceof SyntaxError) && !(e instanceof TypeError)) throw e;
    why = e.message;
  }

  if (why) {
    console.error("WITHDRAWING the price from the page.");
    console.error("  reason: " + why);
    console.error("  The page will say 'Call for today's price', which is true.");
  } else {
    console.log(`${b.bids.length} rows, priced ${b.pricedAt}, read ${b.ageH.toFixed(1)}h ago`);
    if (b.sourceStale)
      console.warn("  NOTE: the reader reports their board has not moved in a long time. " +
                   "That is not our failure and the price is still theirs, but the " +
                   "'as of' date on the page will show it. Worth a look.");
  }

  const html = readFileSync("index.html", "utf8");
  const changed = [];
  if (writeIfChanged("index.html", writeRegion(html, b ? renderPriced(b) : renderWithdrawn())))
    changed.push("index.html");

  /* `generated` would otherwise churn on every run, so it is carried over
     from the existing file whenever nothing else moved. */
  let prev = null;
  try { prev = JSON.parse(readFileSync("bids.json", "utf8")); } catch { /* first run */ }
  const settled = bidsJson(b, { contact: site.contact, generated: now.toISOString() });
  const sameButForStamp =
    prev && JSON.stringify({ ...prev, generated: 0 }) === JSON.stringify({ ...settled, generated: 0 });
  if (!sameButForStamp && writeIfChanged("bids.json", JSON.stringify(settled, null, 2) + "\n"))
    changed.push("bids.json");

  if (writeIfChanged("bids.csv", bidsCsv(b, site))) changed.push("bids.csv");

  console.log(changed.length ? "changed: " + changed.join(", ") : "nothing changed");
  return { withdrawn: !!why, changed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
