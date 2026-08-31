/* THE CHANGE LINE — what the price did since it last moved, and when.
 *
 * WHY THIS FILE EXISTS
 *
 * Sig, 2026-08-31: "what about the change since yesterdays posted price or
 * something for people to reference with price". A number with nothing beside
 * it tells a farmer what he would be paid; it does not tell him whether to
 * haul today or wait, which is the decision he is actually making.
 *
 * WHAT THE BOARD ACTUALLY DOES, MEASURED BEFORE ANY OF THIS WAS WRITTEN
 *
 * Reconstructed from 303 commits of bids.json in this repository, 15 to 31
 * August. The posted cash price for Corn/August took **124 distinct values**
 * across 300 snapshots -- it moved ten times on 31 August alone, between 02:25
 * and 13:05. Cash is futures plus a basis, and futures move all day.
 *
 * So an intraday comparison is useless: "up 1 cent from twenty-five minutes
 * ago" is noise wearing a decimal point. The change has to be a DAILY series.
 *
 * And at daily granularity the board is well behaved. Taking the last posted
 * price of each CENTRAL day for Corn/August, straight out of the commit log:
 *
 *     Tue 08-18  4.03        
 *     Wed 08-19  4.13    +10c
 *     Thu 08-20  4.15     +2c
 *     Fri 08-21  4.22     +7c
 *     Sat 08-22  4.22     +0c
 *     Sun 08-23  4.34    +12c
 *     Mon 08-24  4.33     -1c
 *     Tue 08-25  4.43    +10c
 *     Wed 08-26  4.51     +8c
 *     Thu 08-27  4.51     +0c
 *     Fri 08-28  4.49     -2c
 *     Sat 08-29  4.5      +1c
 *     Sun 08-30  4.53     +3c
 *     Mon 08-31  4.47     -6c
 *
 * Weekdays move 1 to 12 cents. Saturday is flat, because the market is shut.
 * SUNDAY IS NOT: Globex reopens at 7pm Central on Sunday, and 23 and 30 August
 * both moved. That is why the day boundary here is Central and not UTC -- an
 * evening run at 02:25 UTC is Sunday evening in Wisconsin, and filing it under
 * Monday would put Sunday's trading into Monday's opening number.
 *
 * (One more thing the measurement turned up, recorded because it will surprise
 * somebody later: the BASIS was -0.62 on every one of those 303 snapshots.
 * Seventeen days without moving. Every cent in that table is futures. The panel
 * already shows basis in its own column, so the change line does not try to
 * split them.)
 *
 * WHAT IT WILL NOT DO
 *
 * It will not invent a comparison. With no history, or with history that does
 * not reach a different price, it renders NOTHING -- an absent line, not a
 * "0c" or an em dash. A change line that appears the day the file is created,
 * comparing today against today, would be a made-up number on a customer's
 * price board, and that is rule one.
 */

/* THE DAY THAT MATTERS IS THE TRADE DATE, NOT THE CALENDAR DATE.
 *
 * Sig, 2026-08-31: "our price should be from the last day that corn trading
 * closed, so on monday it should say down or up since friday."
 *
 * He is right and the first version of this file was wrong. It filed prices by
 * Central calendar day, so Sunday evening became "Sunday's close" and a Monday
 * morning page read "down 6c from Sunday". Measured in the feed's own
 * pricedAt -- the stamp for when THEIR board last moved -- here is what
 * actually happened over the weekend of 29 August:
 *
 *     Sat 08-29 09:34   pricedAt stops advancing, corn 512
 *     Sat ... Sun 18:41 every observation still reports pricedAt Sat 09:34
 *     Sun 08-30 19:21   pricedAt starts moving again, corn 511.5, 513, 516 ...
 *     Mon 08-31 00:21   ... straight through midnight, 515, 515.25, 515.75
 *
 * The board froze from Saturday morning until 19:21 Sunday. That is Globex
 * reopening at 7pm Central, and everything after it belongs to MONDAY's
 * session. Comparing Monday morning against "Sunday" was comparing Monday's
 * overnight trade against Monday's overnight trade.
 *
 * So the trade date rolls at 7pm Central, which is the exchange's own
 * convention, and Saturday and Sunday are not trading days at all.
 *
 * THE HOLIDAY GUARD FALLS OUT OF THE SAME MEASUREMENT and needs no calendar.
 * An observation is only filed if the board's OWN pricedAt falls inside the
 * same trade date. On a day with no session the board is frozen and reports a
 * stamp from the previous session, so nothing is filed and that day never
 * becomes a reference. This is what makes Friday evening's frozen readings --
 * pricedAt Friday 13:20, observed after 7pm and therefore Saturday's trade
 * date -- correctly contribute nothing. */

const CENTRAL = { timeZone: "America/Chicago" };

/** Central wall-clock parts for an instant. */
function central(when) {
  const d = new Date(when);
  return {
    date: d.toLocaleDateString("en-CA", CENTRAL),
    hour: Number(d.toLocaleString("en-US", { ...CENTRAL, hour: "2-digit", hour12: false })),
  };
}

const addDay = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The exchange session an instant belongs to. Rolls at 19:00 Central. */
export function tradeDate(when = new Date()) {
  const { date, hour } = central(when);
  return hour >= 19 ? addDay(date, 1) : date;
}

/** Monday to Friday. Saturday and Sunday hold no session and no close. */
export function isTradingDay(iso) {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return dow >= 1 && dow <= 5;
}

/* Kept for callers that still want the plain Central date. */
export const centralDay = (when = new Date()) => central(when).date;

export function dayName(iso) {
  /* Noon avoids any chance of the date shifting under a timezone conversion. */
  return new Date(`${iso}T12:00:00Z`)
    .toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" });
}

export const keyOf = (r) => `${r.commodity}|${r.delivery}`;

export const EMPTY = { schema: "emmert-price-history/1", updated: null, days: {} };

/* Record today's posted price. Called on every run, so today's entry is
   overwritten until the day ends and the last write of the day is the close.
   Returns a NEW object; nothing is mutated in place. */
export function record(history, rows, when = new Date(), pricedAt = when) {
  const td = tradeDate(when);
  if (!isTradingDay(td)) return history ?? EMPTY;

  /* THE BOARD'S OWN STAMP DECIDES WHETHER THIS IS A SESSION. If pricedAt
     belongs to an earlier trade date the board is frozen -- a weekend, a
     holiday, or an evening after settlement -- and filing the carried-forward
     number would invent a close that never happened. */
  if (tradeDate(pricedAt) !== td) return history ?? EMPTY;

  const days = { ...(history?.days ?? {}) };
  const todays = { ...(days[td] ?? {}) };
  for (const r of rows) {
    const v = Number(r.pay ?? r.cashPrice);
    if (Number.isFinite(v)) todays[keyOf(r)] = Math.round(v * 10000) / 10000;
  }
  days[td] = todays;
  return { ...EMPTY, ...history, updated: new Date(when).toISOString(), days };
}

/* KEEP ENOUGH FOR THE TEN-DAY STRIP AND A MARGIN, NOT FOREVER.
   Forty days is four weeks of trading plus the weekends inside them. The file
   is committed on every price run, so an unbounded one grows the repository by
   a row a day per delivery and never stops. */
export const KEEP_DAYS = 40;

export function prune(history, keep = KEEP_DAYS) {
  const days = Object.keys(history?.days ?? {}).sort();
  if (days.length <= keep) return history;
  const drop = new Set(days.slice(0, days.length - keep));
  const kept = {};
  for (const [d, v] of Object.entries(history.days)) if (!drop.has(d)) kept[d] = v;
  return { ...history, days: kept };
}

/**
 * What to say under today's price.
 *
 *   { cents, direction, sinceDay, sinceName, text }   or   null
 *
 * `null` means say nothing. That is the honest answer whenever the history
 * cannot support a sentence, and it is deliberately the easy path.
 */
export function change(history, row, now, when = new Date()) {
  const today = tradeDate(when);
  const key = keyOf(row);

  /* Number(null) is 0. So is Number(""), Number(false) and Number([]).
     A row whose price failed to read would have compared 0 against yesterday's
     4.53 and printed "down 453c" on a customer's price board. Only a real
     number, or a string that is one, is allowed past here. */
  const current =
    typeof now === "number" ? now
    : (typeof now === "string" && now.trim() !== "") ? Number(now)
    : NaN;
  if (!Number.isFinite(current)) return null;

  /* Earlier SESSIONS that closed, most recent first. `d < today` excludes the
     one in progress; isTradingDay excludes a weekend that somehow got filed. */
  const past = Object.keys(history?.days ?? {})
    .filter((d) => d < today && isTradingDay(d) && history.days[d]?.[key] !== undefined)
    .sort()
    .reverse();
  if (!past.length) return null;

  const level = history.days[past[0]][key];

  /* The reference is the last session's close. What moves is which day gets
     NAMED: the first session that closed at that level, not the last one to
     sit there.

     An earlier version compared against the most recent DIFFERENT price, which
     is wrong in exactly the case it was meant to handle. Thursday 27 August
     closed where Wednesday did; the honest sentence is "unchanged since
     Wednesday", and that version reached past Wednesday to Tuesday's 4.43 and
     said "up 8 cents from Tuesday" -- an eight cent move on a day the board
     had not moved at all. */
  let j = 0;
  while (j + 1 < past.length && history.days[past[j + 1]]?.[key] === level) j++;
  const sinceDay = past[j];

  /* `+ 0` turns -0 into 0. Math.round(-0.00001) is -0, which compares equal to
     0 but is not the same value, and it would leak into the JSON as "-0". */
  const cents = Math.round((current - level) * 100) + 0;
  const direction = cents > 0 ? "up" : cents < 0 ? "down" : "flat";
  const name = dayName(sinceDay);
  const text = cents === 0
    ? `unchanged since ${name}`
    : `${direction} ${Math.abs(cents)}\u00a2 from ${name}`;
  return { cents, direction, sinceDay, sinceName: name, text };
}
