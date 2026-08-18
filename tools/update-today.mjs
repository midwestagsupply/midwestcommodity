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
      label = "Closed for the day";
      hours = next
        ? `Open ${next.tomorrow ? "tomorrow" : next.name} ${opensAt(next.hours) ?? ""}`.trim()
        : "Call for hours";
    }
  }
  return { label, hours };
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

const { label, hours } = todayBox(h, {
  dow, dayName, nowMins: centralNow.getHours() * 60 + centralNow.getMinutes(),
});

let html = readFileSync("index.html", "utf8");
const block = /<div class="today">[\s\S]*?<\/div>\s*<div class="hrow">/;

if (!hours) {
  html = html.replace(block, '<div class="hrow">');
  console.log(`no hours for ${dayName}; box removed`);
} else {
  html = html.replace(block,
    `<div class="today">\n        <div class="today-lbl">${label}</div>\n` +
    `        <div class="today-hrs num">${hours}</div>\n      </div>\n      <div class="hrow">`);
  console.log(`${label}, ${hours}`);
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
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
