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

/* THE SAME TOLERANCE AT BOTH ENDS, FOR THE SAME REASON.
 *
 * Corn futures move in quarter cents and Big River's front-month cell lags
 * its own cash by one for minutes at a time. The reader upstream already
 * refuses anything worse and refuses a board where the failures are not a
 * minority. This is the independent second check -- defence in depth is worth
 * having -- and it has to measure by the same ruler, or the two disagree and
 * the sites go dark on a board the reader was happy with. They did, at 21:47
 * on 2026-08-18. */
const TICK = 0.25;
const IDENTITY_SLACK_CENTS = TICK * 2;

/* The harvest window. Declared up here because both the spread lookup and
   the page renderer need it, and a second copy is a second thing to forget. */
export const HARVEST_MONTHS = ["October", "November"];

export const CONFIG = { FEED_URL, FEED_MAX_AGE_H, FLOOR, CEILING, HARVEST_MONTHS };

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

/* ONE SPREAD PER BUCKET, NOT ONE FOR THE WHOLE BOARD.
 *
 * Old crop and new crop are different decisions. Ten cents under for corn off
 * the truck today and fourteen under for harvest delivery is an ordinary
 * thing to want, and there is no reason the two should be chained together.
 *
 * `spreadHarvest` absent means "the same as cash", so a pricing.json written
 * before this existed keeps behaving exactly as it did. Absent and equal are
 * the same outcome here, deliberately: there is nothing a reader could do
 * differently if it could tell them apart. */
export function spreadFor(delivery, spreads) {
  const harvest = spreads.harvest;
  return HARVEST_MONTHS.includes(delivery) && harvest != null ? harvest : spreads.cash;
}

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
export function board(feed, { now, spreads, maxAgeH = FEED_MAX_AGE_H } = {}) {
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
  let checkable = 0, lagging = 0;
  for (const b of rows) {
    if (typeof b.cash !== "number" || !Number.isFinite(b.cash))
      throw new Withdraw(`${b.delivery ?? "a row"} has no usable cash price`);
    if (b.cash < FLOOR || b.cash > CEILING)
      throw new Withdraw(
        `${b.delivery} cash is ${b.cash}, outside ${FLOOR}-${CEILING}; ` +
        `that is a decimal point in the wrong place, not a market`);

    /* THE IDENTITY CHECK. The only guard that proves a number came from the
       right COLUMN rather than merely looking plausible: their own three
       figures have to agree with each other.

       A NULL QUOTE IS NOT A BROKEN FEED. The reader publishes
       futuresPriceCents: null on a row whose quote it could not verify --
       Big River's front-month cell lags its own cash by a tick for minutes at
       a time. Treating that as "this row cannot be checked, refuse
       everything" took both sites dark at 21:47 on 2026-08-18 over two rows
       out of seven, while five balanced perfectly and the cash and basis on
       all seven were sound.

       So: a row without a quote is carried, with no quote, and the page shows
       a dash. A row WITH a quote still has to balance exactly. And a majority
       of rows must carry a quote and balance, or nothing has been proved
       about the columns and the whole board is refused -- the same rule the
       reader applies upstream, for the same reason. */
    if (typeof b.basisDollars !== "number")
      throw new Withdraw(`${b.delivery} carries no basis, so nothing about it can be checked`);

    if (typeof b.futuresPriceCents === "number") {
      const derived = Math.round((b.cash - b.basisDollars) * 10000) / 10000;
      const off = Math.abs(derived * 100 - b.futuresPriceCents);
      if (off > IDENTITY_SLACK_CENTS)
        throw new Withdraw(
          `${b.delivery} fails cash - basis = futures: ` +
          `${b.cash} - (${b.basisDollars}) = ${derived} but their page quotes ` +
          `${b.futuresPriceCents / 100}, off by ${off.toFixed(2)}c. ` +
          `That is far more than a tick, so one of the columns has moved.`);
      checkable++;
      if (off > 1e-6) lagging++;
    }

    const spread = spreadFor(b.delivery, spreads);
    out.push({
      seq: typeof b.seq === "number" ? b.seq : out.length,
      commodity: b.commodity ?? "Corn",
      delivery: b.delivery,
      futuresMonth: b.futuresMonth ?? null,
      cash: b.cash,
      theirBasis: b.basisDollars,                // kept for the log, never shown
      basisDollars: basisFrom(b.basisDollars, spread),   // ours
      /* null travels through as null: the page prints a dash for it, and a
         figure nobody could verify never reaches a customer. */
      futures: typeof b.futuresPriceCents === "number" ? b.futuresPriceCents / 100 : null,
      pay: payFrom(b.cash, spread),
      spread,                                    // which one was applied
    });
  }

  /* The rows that could be checked are what proves the columns. Without a
     majority of them nothing has been proved, and a tolerant reading becomes
     no reading at all. */
  /* And the rows that balanced EXACTLY are what does the proving, so a
     tick-sized disagreement is only forgiven while they are in the majority. */
  if ((checkable - lagging) * 2 <= rows.length)
    throw new Withdraw(
      `only ${checkable - lagging} of ${rows.length} row(s) balance cash - basis = futures ` +
      `to the cent. That is not a majority, so nothing proves the columns are right, ` +
      `and no price is being published.`);

  if (checkable * 2 <= rows.length)
    throw new Withdraw(
      `only ${checkable} of ${rows.length} row(s) carry a futures quote to check ` +
      `cash - basis against. That is not a majority, so nothing proves the columns ` +
      `are right, and no price is being published.`);

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
/* WITH THE TIME, NOT JUST THE DATE.
 *
 * A date alone cannot tell you whether the copy in front of you is today's
 * build or one your phone kept from this morning -- and a phone returning to
 * a tab from the app switcher restores it from memory without asking the
 * server at all. A time makes a stale copy obvious at a glance, which beats
 * any cache header, and GitHub Pages does not let you set cache headers
 * anyway.
 *
 * It costs nothing in churn: this is built from pricedAt, so it only changes
 * when their board changes, exactly as before. */
export const asOf = (iso) => {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "America/Chicago" });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })
    .toLowerCase().replace(" ", "");
  return `${day}, ${time}`;
};

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

/* THE FUTURES COLUMN, AND WHY IT SITS WHERE IT DOES.
 *
 * Futures, then basis, then what we pay -- left to right, in the order the
 * arithmetic runs. A grower reading across gets 4.635 less 62 under makes
 * 4.02, and the row checks itself. That is the same reason the staff screen
 * shows Big River's board beside the field: a number you can verify beats a
 * number you have to trust.
 *
 * It is shown on the PAGE only. bids.json and bids.csv still carry no futures
 * quote, because their own terms text says they do not, and a published
 * licence that has stopped being true is worse than a missing column. If that
 * ever changes, change the terms note in the same commit.
 *
 * Hidden on a phone with the basis, so a narrow screen shows the delivery and
 * the price and nothing to scroll sideways for. */
/* Their board carries quarter cents. Show the figure they printed: 4.88 as
   $4.88 and 4.635 as $4.635, never $4.6350, which claims a precision they did
   not publish. */
export function cashText(n) {
  const t = n.toFixed(4).replace(/0+$/, "");
  return t.endsWith(".") ? t + "00" : /\.\d$/.test(t) ? t + "0" : t;
}

const futText = (r) => (r.futures == null ? "&mdash;" : "$" + cashText(r.futures));

const line = (label, sub, r) =>
  `          <tr><td class="mo">${esc(label)}` +
  (sub ? `<span class="con">${esc(sub)}</span>` : "") + `</td>` +
  `<td class="fut r m-hide">${futText(r)}` +
  (r.futuresMonth ? `<span class="con">${esc(r.futuresMonth)}</span>` : "") + `</td>` +
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
          <tr><th>Delivery</th><th class="r m-hide">Futures</th>` +
          `<th class="r m-hide">Basis</th><th class="r">We pay</th></tr>
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

/* ---- the break-glass ---------------------------------------------------
 *
 * When the automatic reading is down, the office types a price on the staff
 * screen. It is written into pricing.json as `manual`, and it OVERRIDES the
 * feed until it is cleared -- which is exactly what the screen tells them it
 * does, so it had better be what happens.
 *
 * A hand-posted price is not a reading and is never dressed up as one. It is
 * labelled on the page, the published record says `status: "manual"`, and no
 * spread is subtracted from it: the number typed is the number we pay, which
 * is what "Cash price to post" means on the screen.
 *
 * The sanity band is enforced here as well as on the screen. Not because the
 * screen is untrusted, but because this file is the last thing between a
 * typed number and a customer, and it is the only one of the two that a test
 * can hold to it. */
export function manualBoard(m, { now }) {
  if (!m || typeof m !== "object") return null;
  const rows = [];
  const add = (delivery, cash, basis, label) => {
    if (typeof cash !== "number" || !Number.isFinite(cash))
      throw new Withdraw(`the hand-posted ${label} is not a number`);
    if (cash < FLOOR || cash > CEILING)
      throw new Withdraw(
        `the hand-posted ${label} is ${cash}, outside ${FLOOR}-${CEILING}. ` +
        `Clear it on the staff screen; nothing is being published from it.`);
    if (basis != null && (typeof basis !== "number" || Math.abs(basis) > 1.5))
      throw new Withdraw(`the hand-posted ${label} basis is ${basis}, further than 1.50 from zero`);
    rows.push({ seq: rows.length, commodity: "Corn", delivery, futuresMonth: null,
                cash, basisDollars: basis ?? null, pay: cash });
  };
  if (m.cash != null) add("Cash, corn", m.cash, m.basis ?? null, "cash price");
  if (m.harvest != null) add("Harvest", m.harvest, m.harvestBasis ?? null, "harvest price");
  if (!rows.length) return null;
  return { bids: rows, pricedAt: m.setAt ?? now.toISOString(), checkedAt: now.toISOString(),
           manual: true, sourceStale: false, ageH: 0 };
}

export function renderManual(b) {
  const rows = b.bids.map((r) =>
    `          <tr><td class="mo">${esc(r.delivery)}</td>` +
    `<td class="fut r m-hide">&mdash;</td>` +
    `<td class="bas r m-hide">${r.basisDollars == null ? "&mdash;" : basisText(r.basisDollars)}</td>` +
    `<td class="pay r">${money(r.pay)}</td></tr>`).join("\n");
  return `      <div class="hd">Prices paid today<span class="as">posted by the office</span></div>
      <table class="bids">
        <thead>
          <tr><th>Delivery</th><th class="r m-hide">Futures</th>` +
          `<th class="r m-hide">Basis</th><th class="r">We pay</th></tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>`;
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
    /* Three states, not two. A hand-posted price is a real price and is
       published, but a consumer must be able to tell it from a reading, and
       an unrecognised status is the safe direction for anything that cannot. */
    status: !b ? "stale" : b.manual ? "manual" : "ok",
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
    /* Blank, not 0.00. A hand-posted price may carry no basis, and blank means
       "we are not saying" while zero means "even with the board" -- two
       different claims, and a consumer can tell them apart. */
    r.basisDollars == null ? "" : r.basisDollars.toFixed(2),
    r.pay.toFixed(2),
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

  const harvest = site.spreadHarvest;
  if (harvest != null && (typeof harvest !== "number" || !Number.isFinite(harvest) || harvest < 0))
    throw new Error(
      `pricing.json spreadHarvest must be a number at or above zero, or absent to ` +
      `mean the same as the cash spread. Got ${JSON.stringify(harvest)}.`);
  const spreads = { cash: spread, harvest: harvest ?? null };

  let b = null, why = null;
  /* The override is checked FIRST, because that is what the screen promises:
     "Anything typed here overrides the feed until you clear it." A break-glass
     that only works when the glass is already broken is not one. */
  try {
    b = manualBoard(site.manual, { now });
  } catch (e) {
    if (!(e instanceof Withdraw)) throw e;
    why = e.message;
  }

  if (!b && !why) {
    try {
      const res = await fetchImpl(FEED_URL, { cache: "no-store" });
      if (!res.ok) throw new Withdraw(`the feed returned HTTP ${res.status}`);
      b = board(JSON.parse(await res.text()), { now, spreads });
    } catch (e) {
      if (!(e instanceof Withdraw) && !(e instanceof SyntaxError) && !(e instanceof TypeError)) throw e;
      why = e.message;
    }
  }

  if (why) {
    console.error("WITHDRAWING the price from the page.");
    console.error("  reason: " + why);
    console.error("  The page will say 'Call for today's price', which is true.");
  } else if (b.manual) {
    console.log(`POSTED BY HAND: ${b.bids.length} row(s) from pricing.json, set ${b.pricedAt}.`);
    console.log("  The automatic reading is being overridden and will stay overridden");
    console.log("  until the by-hand boxes are cleared on the staff screen.");
  } else {
    const used = [...new Set(b.bids.map((r) => r.spread))];
    console.log(`${b.bids.length} rows, priced ${b.pricedAt}, read ${b.ageH.toFixed(1)}h ago, ` +
                `spread ${used.map((v) => v.toFixed(2)).join(" / ")} under`);
    if (b.sourceStale)
      console.warn("  NOTE: the reader reports their board has not moved in a long time. " +
                   "That is not our failure and the price is still theirs, but the " +
                   "'as of' date on the page will show it. Worth a look.");
  }

  let html = readFileSync("index.html", "utf8");
  html = writeRegion(html,
    !b ? renderWithdrawn() : b.manual ? renderManual(b) : renderPriced(b));

  /* The small print under the price table, saved by the staff screen. Same
     reasoning as the note under the hours: a box that takes what you type and
     changes nothing is a worse box than none. Absent leaves the page alone.

     Kept out of writeRegion deliberately -- the terms line sits below the
     panel and outside it, and the price render must not be able to touch it
     by accident. */
  if (typeof site.price_note === "string" && site.price_note.trim()) {
    const TNOTE = /(<div class="tnote">)[\s\S]*?(<\/div>)/;
    if (!TNOTE.test(html))
      throw new Error("could not find the small print under the price table in index.html");
    html = html.replace(TNOTE, (_m, a, t) => a + esc(site.price_note) + t);
  }

  const changed = [];
  if (writeIfChanged("index.html", html)) changed.push("index.html");

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
