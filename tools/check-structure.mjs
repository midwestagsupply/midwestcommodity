#!/usr/bin/env node
/* Confirm this repository is laid out the way GitHub Pages needs.

   Run it before the first push, and any time something looks wrong:

       node tools/check-structure.mjs

   It exists because the failure it catches is silent and confusing. If
   the files end up one folder deep, Pages serves a 404 at the domain and
   the real page hides at /badgergrain-com/. Everything looks fine
   in the repository browser. This says so in one line instead.
*/
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

const problems = [];
const notes = [];
const need = (f, why) => existsSync(f) ? notes.push(`${f} — ${why}`) : problems.push(`MISSING: ${f} (${why})`);

// 1. The files Pages needs at the top, not one folder down.
need("index.html", "the site. Pages serves this at the domain root");
need("site.css",   "must sit beside index.html, not in a subfolder");
need("CNAME",      "tells Pages which domain this is");
need(".nojekyll",  "without it Pages hides anything starting with an underscore");
need("hours.json", "the hours");
need("pricing.json","the spread and the by-hand override. update-prices.mjs throws without it");
need("assets",     "logo artwork");
need("fonts",      "the bundled typefaces");
need("robots.txt", "tells crawlers everything here is fair game, and where the sitemap is");
need("sitemap.xml","carries the lastmod date search engines use to decide when to come back");

// 2. The classic mistake: the whole site nested one level deep.
for (const e of readdirSync(".")) {
  if (e.startsWith(".") || !statSync(e).isDirectory()) continue;
  if (existsSync(`${e}/index.html`) && existsSync(`${e}/site.css`))
    problems.push(
      `NESTED: there is a complete site inside ${e}/. Everything must be at the top ` +
      `of the repository. Move the contents of ${e}/ up one level and delete ${e}/.`
    );
}

// 3. Nothing may reach outside the repository root.
if (existsSync("index.html")) {
  const html = readFileSync("index.html", "utf8");
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const u = m[1];
    if (u.startsWith("../"))
      problems.push(`ESCAPES ROOT: index.html asks for ${u}. Pages cannot see above the repository.`);
    if (/^(https?:)?\/\//.test(u) || u.startsWith("#") || u.startsWith("data:") ||
        u.startsWith("mailto:") || u.startsWith("tel:") || u.startsWith("sms:")) continue;
    const path = u.split(/[?#]/)[0];
    if (path && !existsSync(path)) problems.push(`BROKEN LINK: index.html asks for ${path}, which is not here`);
  }
  // 4. CNAME must match what the page says about itself.
  if (existsSync("CNAME")) {
    const domain = readFileSync("CNAME", "utf8").trim();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain))
      problems.push(`CNAME reads "${domain}", which is not a bare domain. No https://, no trailing slash.`);
    else {
      notes.push(`CNAME — ${domain}`);
      // Exact match, and www counts as different. Pages serves the name
      // in CNAME and redirects the other, so a canonical pointing at the
      // www version names a URL that immediately redirects, which is a
      // signal split for nothing. Every self-reference uses one host.
      const canon = (html.match(/rel="canonical" href="https?:\/\/([^/"]+)/) || [])[1];
      if (canon && canon !== domain)
        problems.push(`MISMATCH: CNAME says ${domain} but the page's canonical tag says ${canon}`);
      const og = (html.match(/property="og:url" content="https?:\/\/([^/"]+)/) || [])[1];
      if (og && og !== domain)
        problems.push(`MISMATCH: CNAME says ${domain} but og:url says ${og}`);
      for (const [file, re, what] of [
        ["robots.txt",  /Sitemap:\s*https?:\/\/([^/\s]+)/, "the Sitemap line in robots.txt"],
        ["sitemap.xml", /<loc>https?:\/\/([^/<]+)/,        "the <loc> in sitemap.xml"],
      ]) {
        if (!existsSync(file)) continue;
        const host = (readFileSync(file, "utf8").match(re) || [])[1];
        if (host && host !== domain)
          problems.push(`MISMATCH: CNAME says ${domain} but ${what} says ${host}`);
      }
    }
  }
}

// 5. Something must rebuild the "Open today" box, on a clock.
//
// THIS USED TO LOOK FOR A FILENAME, AND THE FILENAME WAS WRONG.
//
// It required `.github/workflows/daily.yml`. That file has never existed in
// either site, so this check has been failing on an untouched, correctly
// working repository for as long as it has been here -- while the job it
// actually cares about, update-today.mjs, was running every few minutes inside
// prices.yml the whole time.
//
// A checker that cries wolf on a clean repo is worse than no checker. The next
// person reads "1 problem. Do not push yet." on a repo where nothing is wrong,
// learns that this script is noise, and is not listening on the day it is
// right.
//
// So it checks the CAPABILITY rather than the filename: is there a workflow
// that runs update-today.mjs, and does it run on a clock? Which file does it,
// and whether that file is also doing the prices, is nobody's business here.
{
  const dir = ".github/workflows";
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f)) : [];
  const runners = files
    .map((f) => ({ f, text: readFileSync(`${dir}/${f}`, "utf8") }))
    .filter((w) => w.text.includes("update-today.mjs"));

  if (!files.length) {
    problems.push(
      "MISSING: there are no workflows at all. Nothing rebuilds the \"Open today\" box, " +
      "and a box that is never rebuilt cannot know what day it is.");
  } else if (!runners.length) {
    problems.push(
      "MISSING: no workflow runs tools/update-today.mjs. Without it the \"Open today\" box " +
      `goes stale. Workflows present: ${files.join(", ")}.`);
  } else {
    // On a clock, not only on push. A push-only rebuild cannot roll the day
    // over at midnight, which is the one thing this box has to get right.
    const timed = runners.filter((w) => /^\s*schedule:/m.test(w.text) && /cron:/.test(w.text));
    if (!timed.length) {
      problems.push(
        `${runners.map((w) => w.f).join(", ")} runs update-today.mjs but has no schedule, ` +
        "so the box is only rebuilt when somebody pushes. It needs a clock: the day " +
        "rolls over at midnight whether or not anyone is committing.");
    } else {
      for (const w of timed) {
        const crons = [...w.text.matchAll(/cron:\s*["']([^"']+)["']/g)].map((m) => m[1]);
        notes.push(`${dir}/${w.f} — rebuilds the "Open today" box on ${crons.length} ` +
                   `schedule${crons.length === 1 ? "" : "s"}: ${crons.join(" | ")}`);
      }
    }
  }
}

console.log("\nFound:");
for (const n of notes) console.log("  " + n);

if (problems.length) {
  console.log("\nProblems:");
  for (const p of problems) console.log("  " + p);
  console.log(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}. Do not push yet.\n`);
  process.exit(1);
}
console.log("\nStructure is correct. Safe to push.\n");
