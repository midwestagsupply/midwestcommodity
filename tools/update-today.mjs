#!/usr/bin/env node
/* Update the "Open today" box in index.html.

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
*/
import { readFileSync, writeFileSync } from "node:fs";

const h = JSON.parse(readFileSync("hours.json", "utf8"));
const dayName = new Date().toLocaleDateString("en-US", { weekday: "long", timeZone: "America/Chicago" });
const dow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })).getDay();

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
writeFileSync("index.html", html);
