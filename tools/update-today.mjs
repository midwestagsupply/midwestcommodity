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

const h = JSON.parse(readFileSync("hours.json", "utf8"));

const centralNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
const dayName = new Date().toLocaleDateString("en-US", { weekday: "long", timeZone: "America/Chicago" });
const dow = centralNow.getDay();
const todayISO = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); // YYYY-MM-DD

/* A today-only answer that was about a different day is not an answer. */
let expired = false;
if ((h.closed_today || h.today_override) && h.today_date !== todayISO) {
  expired = true;
  h.closed_today = false;
  h.today_override = null;
  h.today_date = null;
}

let label, hours;
if (h.closed_today)        { label = `Closed today, ${dayName}`;  hours = "Closed"; }
else if (h.today_override) { label = `Open today, ${dayName}`;    hours = h.today_override; }
else if (h.harvest_mode)   { label = `Harvest hours, ${dayName}`; hours = h.harvest; }
else if (dow === 0)        { label = `Closed today, ${dayName}`;  hours = "Closed"; }
else if (dow === 6)        { label = `Open today, ${dayName}`;    hours = h.saturday; }
else                       { label = `Open today, ${dayName}`;    hours = h.weekday; }

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

writeFileSync("index.html", html);
if (expired) {
  writeFileSync("hours.json", JSON.stringify(h, null, 2) + "\n");
  console.log("a today-only answer had gone out of date and was cleared");
}
