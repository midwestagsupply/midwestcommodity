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
import { DAY_NAMES, spanMinutes, opensAt, todayBox, expireToday } from "./today-core.mjs";

/* Imported by the tests for the pure parts, and run as a script by the
   workflow. Nothing below the guard happens on import, so `todayBox` can be
   handed any clock without this file going looking for hours.json. */
const IS_SCRIPT = import.meta.url === `file://${process.argv[1]}`;

const h = IS_SCRIPT ? JSON.parse(readFileSync("hours.json", "utf8")) : {};

/* The pattern that finds the "Open today" box in index.html.

   FIXED 2026-08-19. This was `<div class="today">`, matching the tag with no
   class list after it.
     The four closed states add `is-shut` to that div. So the first time the
   box went closed, this tool wrote a div that the pattern could no longer
   find -- and String.prototype.replace against a pattern that does not match
   returns the string unchanged and throws nothing.
     From that moment the job kept running on schedule, kept computing the
   right answer, kept printing it to the log and kept exiting 0, while
   changing nothing. Both sites sat on "Closed for the day / Tomorrow 8:00a"
   from the 6:49pm run on 18 August until 8:34am the next morning -- open,
   with trucks on the road, and a green tick on every run in between. The box
   could only ever go closed once.
     The class list is optional here now, so the pattern still finds the box
   in whichever state it was last left in. Exported because the failure was
   in this regex and nothing tested it; test/hours.test.mjs holds it against
   both renderings. */
export const BOX_BLOCK = /<div class="today(?:\s[^"]*)?">[\s\S]*?<\/div>\s*<div class="hrow">/;

/* Module level because weeklyRows() below is exported and needs it, and
   because a second copy of an HTML escaper is a second one to get wrong. */
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ---- THE WEEK'S HOURS, WHICH NOTHING WAS RENDERING ----------------------
 *
 * REPORTED 2026-08-19 by Jesse Cebulla: "When I update the hours (we are not
 * open Saturdays) it is not reflected in the hours window on the site."
 *
 * He was right, and the git history of hours.json shows what it cost him:
 *
 *     e0d1f15  site: saturday closed
 *     d6ff7bc  site: saturday 8:00a to 12:00p     <- put back; nothing had happened
 *     ea641d5  site: saturday closed              <- tried again
 *
 * Somebody setting a switch, watching the page not change, setting it back to
 * be sure, and setting it again. The staff screen was saving correctly and
 * committing correctly the entire time.
 *
 * `weekday`, `saturday` and `sunday` fed exactly one thing: today's box. The
 * three rows underneath it were hand-typed HTML that nothing read hours.json
 * to produce. So closing Saturday changed nothing a customer could see on any
 * day that was not a Saturday -- and on Saturday itself the box would say
 * CLOSED TODAY directly above a table still offering 8:00a to 12:00p, which
 * is worse than either one alone.
 *
 * This is the same fault the `hoursnote` block further down already names in
 * its own comment: "a box that accepted what you typed, committed it, and
 * changed nothing on the site -- which is worse than not offering the box at
 * all." It was true of three more fields than anybody had noticed.
 *
 * HARVEST MODE DELIBERATELY DOES NOT TOUCH THIS TABLE, and neither do
 * `today_override` or `closed_today`. The note underneath reads "During
 * harvest we run X, seven days a week. Outside harvest the hours above hold",
 * so the table is the standing week and those three are exceptions to it. A
 * closure today says nothing about next Tuesday, and a table that forgot that
 * would be a new way to be wrong.
 */
export const HROWS = /<div class="hrow">[\s\S]*?<div class="hnote">/;

/* ---- THE HOURS SEARCH ENGINES READ, WHICH SAID SATURDAY -----------------
 *
 * FOUND LIVE 2026-08-20 on BOTH sites, and it is the same fault Jesse
 * Cebulla reported on the 19th, one layer further down.
 *
 * hours.json has said `"saturday": null` since the 19th. The visible table
 * was fixed that day and correctly reads "Saturday — Closed". The structured
 * data did not move:
 *
 *     <meta itemprop="openingHours" content="Mo-Fr 08:00-17:00">
 *     <meta itemprop="openingHours" content="Sa 08:00-12:00">     <-- open
 *
 * That is what Google reads for the knowledge panel. So a grower searching
 * "Badger Grain hours" could be shown OPEN SATURDAY 8:00 AM - 12:00 PM,
 * load a truck, drive out, and find a locked gate — while the website itself,
 * if he opened it, said Closed. The page and the search result disagreeing is
 * worse than either being wrong alone, because the one he checks is the one
 * he does not visit.
 *
 * The comment sitting directly above those two lines in index.html states the
 * requirement in as many words: "These must agree with the hours table further
 * up the page ... a search result that says 7am when the gate opens at 8 is
 * worse than no search result." It stated it. Nothing enforced it. That is the
 * third instance this week of a comment describing a guarantee no code kept.
 *
 * MARKERS, NOT A BARE PATTERN ON THE TAGS. If every day is closed this renders
 * NOTHING between the markers — and a pattern matching `<meta itemprop=...>`
 * would then have nothing left to find and could never restore the block. That
 * is exactly how the "Open today" box could only ever go closed once (see
 * BOX_BLOCK above). The markers are always there whether or not anything sits
 * between them.
 *
 * HARVEST IS DELIBERATELY EXCLUDED, matching the note the office wrote and the
 * rule the weekly table already follows: harvest hours are irregular and belong
 * in the Business Profile as special hours. So are `closed_today` and
 * `today_override` — a closure today says nothing about next Tuesday, and
 * telling Google otherwise would persist long after the day did. */
export const OPENING_HOURS = /<!-- HOURS:meta -->[\s\S]*?<!-- \/HOURS:meta -->/;

/* "8:00a to 5:00p" -> "08:00-17:00". Built on spanMinutes, which is the same
   parser the box uses, so the two cannot read one string two ways. */
export function schemaSpan(text) {
  const span = spanMinutes(text);
  if (!span) return null;
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${hhmm(span[0])}-${hhmm(span[1])}`;
}

/** The openingHours meta tags for the standing week. A closed day is OMITTED:
 *  schema.org has no "closed" spelling that Google reads reliably, and saying
 *  nothing about Saturday is the honest form of "we are not open Saturday". */
export function openingHoursMeta(h) {
  const days = [["Mo-Fr", h?.weekday], ["Sa", h?.saturday], ["Su", h?.sunday]];
  const out = [];
  for (const [label, text] of days) {
    /* ONE GUARD, TWO REASONS TO SKIP, and deliberately not two guards.
       A `if (!text) continue` in front of this was strictly redundant —
       schemaSpan(null) is null, so the second check already caught a closed
       day — and a mutation test showed it: deleting it broke nothing, which
       means nothing was holding it. A guard no test can distinguish is not a
       guard, it is a comment that costs a branch. So it is a comment.
         null  -> the day is closed, and a closed day says nothing at all:
                  schema.org has no closed spelling Google reads reliably, so
                  silence is the honest form.
         junk  -> unparseable is not a licence to invent an opening time, and
                  inventing one HERE is worse than in the box, because it goes
                  to search engines where nobody sees it to correct it. */
    const span = schemaSpan(text);
    if (!span) continue;
    out.push(`<meta itemprop="openingHours" content="${esc(label)} ${esc(span)}">`);
  }
  return out;
}

/* ---- THE SAME ANSWER, WORKED OUT IN THE READER'S OWN BROWSER -------------
 *
 * 2026-08-20. The box is a sentence in a static file, so it can only change
 * when a job runs, and the job is a GitHub cron. GitHub crons are best effort.
 * That morning badgergrain's last build was 12:01 UTC and midwestcommodity's
 * was 14:10 UTC -- the same workflow file, the same crons, one landed and one
 * did not -- so at 9:15 Central one site said "Closed now, Thursday. Opens
 * 8:00a" with the yard open and the other said "Open today, Thursday".
 *
 * Nothing was broken. The tests passed and this tool, run by hand against the
 * live page, produced the right answer immediately. NO AMOUNT OF CORRECTNESS
 * IN A BUILD SURVIVES A BUILD THAT DOES NOT RUN.
 *
 * So the page carries the rule with it. These are the FIRST script tags on
 * either site and that was not a decision taken lightly -- Sig chose it with
 * the trade in front of him. What keeps it honest:
 *
 *   - THE SERVER-RENDERED SENTENCE IS STILL WRITTEN, and is what a reader
 *     without JavaScript sees. The script only ever overwrites it, and only
 *     with the answer the same code would have produced.
 *   - THERE IS ONE COPY OF THE RULE. today-core.mjs is imported by this file
 *     and its SOURCE TEXT is inlined below. Not a port, not a translation --
 *     the same characters. The only transformation is deleting the word
 *     `export `, and a test asserts the inlined text still contains the real
 *     function bodies.
 *   - IT FAILS BY DOING NOTHING. Every step is inside a try/catch that leaves
 *     the built-in answer exactly where it was. A page that says the right
 *     thing until the second the script errors is not made worse by the error.
 *
 * The data comes with the page rather than from a fetch: a fetch would need a
 * round trip, could fail on its own, and would put a second copy of hours.json
 * on the wire. Only the eight fields todayBox actually reads are inlined.
 */
export const CLIENT_BLOCK = /<!-- TODAY:js -->[\s\S]*?<!-- \/TODAY:js -->/;

/* JSON inside a <script> ends at the first "</script>" the HTML parser sees,
   wherever it appears -- inside a string is no protection. Escaping the "<"
   of any closing tag is the whole fix, and it is why this is not JSON.stringify
   on its own. */
const jsonForScript = (o) => JSON.stringify(o).replace(/</g, "\\u003c");

/* TWO TRANSFORMATIONS, BOTH NAMED, AND NOTHING ELSE.
 *
 * 1. Drop the module keyword, so the text is a plain function declaration.
 * 2. Drop the comments. today-core.mjs is 7kB of prose around 2kB of code,
 *    and it was measured before this existed: inlining it whole took the
 *    page from 4,708 to 8,771 gzipped bytes. Nearly doubling a deliberately
 *    light page to ship paragraphs to a browser is not a trade worth making,
 *    and the paragraphs are still in the repository where they are read.
 *
 * ONLY LINE-INITIAL COMMENTS ARE TOUCHED, which is what makes this safe to do
 * with a pattern at all: a `/*` or `//` inside a string or a regex literal is
 * never at the start of a line in this file, and cannot become so without the
 * check below failing. today-core.mjs's own header forbids anything cleverer.
 *
 * The safety net is not the pattern, it is the test. test/hours.test.mjs runs
 * the STRIPPED text against the real module across every minute of a week and
 * asserts the two agree, so a strip that changed behaviour could not ship. */
export function leanCore(coreSource) {
  const out = String(coreSource)
    .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*\n/gm, "")
    .replace(/^[ \t]*\/\/.*\n/gm, "")
    .replace(/^export /gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  /* A strip that produced something unparseable must not reach a page. */
  new Function(`${out}\nreturn typeof todayBox;`);
  return out;
}

export function clientScript(h, coreSource) {
  /* Exactly the fields todayBox() and expireToday() read, and nothing else.
     A field the rule does not use is a field on the wire for no reason. */
  const data = {
    weekday: h.weekday ?? null, saturday: h.saturday ?? null, sunday: h.sunday ?? null,
    harvest: h.harvest ?? null, harvest_mode: !!h.harvest_mode,
    closed_today: !!h.closed_today, today_override: h.today_override ?? null,
    today_date: h.today_date ?? null,
  };
    const core = leanCore(coreSource);
  return `<!-- TODAY:js -->
<script type="application/json" id="today-hours">${jsonForScript(data)}</script>
<script>
/* The box, worked out from your clock rather than from the last build.
   Generated by tools/update-today.mjs -- edit tools/today-core.mjs, not this. */
(function () {
  "use strict";
${core.split("\n").map((l) => (l ? "  " + l : l)).join("\n")}

  try {
    var data = document.getElementById("today-hours");
    if (!data) return;
    var h = JSON.parse(data.textContent);
    var now = new Date();
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago", weekday: "long",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(now);
    var g = {};
    for (var i = 0; i < parts.length; i++) g[parts[i].type] = parts[i].value;
    var dow = DAY_NAMES.indexOf(g.weekday);
    if (dow < 0) return;
    /* en-CA gives YYYY-MM-DD, the same shape the build compares against. */
    var todayISO = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now);
    expireToday(h, todayISO);
    /* Some ICU builds render midnight as hour 24. */
    var nowMins = (Number(g.hour) % 24) * 60 + Number(g.minute);
    var r = todayBox(h, { dow: dow, dayName: g.weekday, nowMins: nowMins });

    var box = document.querySelector(".today");
    if (!r.hours) { if (box && box.parentNode) box.parentNode.removeChild(box); return; }

    /* The build removes the box on a day with no hours. Without this, a Sunday
       build followed by no Monday build would leave Monday with no box at all
       and the script with nothing to correct -- the exact failure it is here
       to prevent, arriving one day later. */
    if (!box) {
      var first = document.querySelector(".hrow");
      if (!first || !first.parentNode) return;
      box = document.createElement("div");
      var l = document.createElement("div"); l.className = "today-lbl";
      var v = document.createElement("div"); v.className = "today-hrs num";
      box.appendChild(l); box.appendChild(v);
      first.parentNode.insertBefore(box, first);
    }
    var lbl = box.querySelector(".today-lbl"), hrs = box.querySelector(".today-hrs");
    if (!lbl || !hrs) return;
    box.className = "today" + (r.open ? "" : " is-shut");
    lbl.textContent = r.label;
    hrs.textContent = r.hours;
  } catch (e) {
    /* Leave the sentence the build wrote. It was right when it was written. */
  }
})();
</script>
<!-- /TODAY:js -->`;
}

export function weeklyRows(h) {
  /* A day with no hours renders the word, not an empty span, and drops the
     `num` class -- "Closed" is not a figure and must not be set as one. That
     is how the Sunday row was already hand-written; this keeps it. */
  const row = (label, value) =>
    `<div class="hrow"><span>${esc(label)}</span>` +
    (value ? `<span class="num">${esc(value)}</span>` : "<span>Closed</span>") +
    "</div>";
  /* No indent on the first row: HROWS starts AT the opening tag, so the six
     spaces in front of it are already in the document and are not ours to
     write again. Getting that wrong indents one row twelve spaces and looks
     like a rendering bug on a page nobody would otherwise inspect. */
  return [row("Mon to Fri", h.weekday),
          row("Saturday", h.saturday),
          row("Sunday", h.sunday)].join("\n      ");
}

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
/* The decision lives in tools/today-core.mjs so that the page can run the
   SAME TEXT in the browser -- see the header of that file. Re-exported here
   because test/hours.test.mjs and anything else that grew up importing them
   from this module should not have to care that they moved. */
export { DAY_NAMES, spanMinutes, opensAt, todayBox, expireToday } from "./today-core.mjs";

/* ---- everything below runs only when this file is the script ------------ */

/* Everything from here needs hours.json and index.html on disk, so it runs
   only when this file IS the script. The pure parts above import cleanly. */
if (IS_SCRIPT) {

/* A today-only answer that was about a different day is not an answer.
   The rule lives in today-core.mjs so the browser applies the identical one
   to a page that was cached yesterday. */
const expired = expireToday(h, todayISO);

const { label, hours, open } = todayBox(h, {
  dow, dayName, nowMins: centralNow.getHours() * 60 + centralNow.getMinutes(),
});

let html = readFileSync("index.html", "utf8");
const block = BOX_BLOCK;

/* The box removes itself when the job stops running, which assumes the job is
   the only thing that can leave it stale. A write that silently does nothing
   defeats that, so a miss stops the run instead of exiting 0 having changed
   nothing -- which is exactly how the last one went unnoticed. */
if (!block.test(html)) {
  throw new Error(
    'update-today.mjs: could not find the "Open today" box in index.html. ' +
    "Refusing to exit 0 having changed nothing.");
}

if (!hours) {
  html = html.replace(block, '<div class="hrow">');
  console.log(`no hours for ${dayName}; box removed`);
} else {
  /* A cue you can read from across the yard, before you read any words.
     The label is still there and still says it -- the colour reinforces the
     sentence, it does not replace it, which is the only way a colour is
     allowed to carry a state. */
  html = html.replace(block,
    `<div class="today${open ? "" : " is-shut"}">\n        <div class="today-lbl">${label}</div>\n` +
    `        <div class="today-hrs num">${hours}</div>\n      </div>\n      <div class="hrow">`);
  console.log(`${label}, ${hours}`);
}

/* ---- the week's hours ---------------------------------------------------
 *
 * See the note on HROWS above for why this did not exist.
 *
 * THIS ONE WARNS AND CARRIES ON WHERE THE BOX GUARD REFUSES, and the reason
 * is the shape of this file rather than a softer opinion about the table.
 * index.html is written ONCE, at the very bottom. A throw here would skip
 * that write, so a malformed hours.json or a moved <div> would take down the
 * "Open today" box, the banner and the hours note along with the table -- the
 * whole page frozen by the least important thing on it. The backstop further
 * down already settles this trade in the same words: "Trading a wrong
 * sentence for a wrong day is a bad trade."
 *
 * A warning nobody reads is how the last one hid, so these are emitted as
 * GitHub workflow annotations. They surface on the run in the Actions UI even
 * though this step carries continue-on-error, rather than sitting in a log
 * that only gets opened after somebody has already noticed. */
const missing = ["weekday", "saturday", "sunday"].filter((k) => !(k in h));
if (missing.length) {
  console.log(`::warning title=hours.json is incomplete::update-today.mjs did not ` +
    `touch the week's hours: hours.json has no ${missing.join(", ")}. The rows on ` +
    `the page are whatever was there before and nothing is maintaining them.`);
} else if (!HROWS.test(html)) {
  console.log("::warning title=weekly hour rows not found::update-today.mjs could " +
    "not find the three hrow divs in index.html, so the week's hours were not " +
    "updated. The rest of the page was. This is the fault Jesse Cebulla reported " +
    "on 2026-08-19: the office sets the hours, nothing renders them.");
} else {
  html = html.replace(HROWS, weeklyRows(h) + '\n      <div class="hnote">');
  console.log(`week: Mon-Fri ${h.weekday || "closed"}, ` +
              `Sat ${h.saturday || "closed"}, Sun ${h.sunday || "closed"}`);
}

/* ---- the hours search engines read ------------------------------------- */
if (!OPENING_HOURS.test(html)) {
  console.log("::warning title=openingHours markers not found::update-today.mjs could not " +
    "find the <!-- HOURS:meta --> markers in index.html, so the structured data was NOT " +
    "updated and may now disagree with the hours table above it. On 2026-08-20 that " +
    "disagreement was telling Google both elevators open on Saturday while the page said " +
    "closed. Add the marker pair back.");
} else {
  const metas = openingHoursMeta(h);
  html = html.replace(OPENING_HOURS,
    () => `<!-- HOURS:meta -->\n    ${metas.join("\n    ")}\n    <!-- /HOURS:meta -->`
      .replace(/\n    \n/, "\n"));
  console.log(`search hours: ${metas.length ? metas.length + " day range(s)" : "none — every day closed, so nothing is claimed"}`);
}

/* ---- the same answer, in the reader's browser ---------------------------
 *
 * WARNS RATHER THAN REFUSING, for the reason HROWS does: index.html is written
 * once at the bottom of this file, so a throw here would take the box, the
 * table and the banner down with it. A missing script block costs a JS reader
 * the live clock and leaves them exactly where every reader was yesterday --
 * a degradation, not a regression. */
/* IT PUTS ITS OWN MARKERS IN, and that is not laziness -- it is what makes
   this shippable. index.html is rewritten by a job every few minutes, so a
   hand-uploaded copy of it is stale before it lands and would revert whatever
   price the last run wrote. Nothing here needs a page upload: the first run
   after this tool lands inserts the block, every run after rewrites it. */
if (!CLIENT_BLOCK.test(html)) {
  const before = /<\/body>/i;
  if (before.test(html)) {
    html = html.replace(before, "<!-- TODAY:js -->\n<!-- /TODAY:js -->\n\n</body>");
    console.log("client clock: marker pair inserted (first run)");
  } else {
    console.log("::warning title=client hours block not placed::update-today.mjs " +
      "found neither the <!-- TODAY:js --> markers nor a </body> in index.html, " +
      "so the page cannot correct its own box between builds. The server-rendered " +
      "sentence is still being written and is what every reader sees.");
  }
}
if (CLIENT_BLOCK.test(html)) {
  html = html.replace(CLIENT_BLOCK,
    () => clientScript(h, readFileSync(new URL("today-core.mjs", import.meta.url), "utf8")));
  console.log("client clock: rendered");
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
