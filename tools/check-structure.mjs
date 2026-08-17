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

// 5. The daily job.
if (!existsSync(".github/workflows/daily.yml"))
  problems.push("MISSING: .github/workflows/daily.yml. Without it the Open Today box goes stale.");
else notes.push(".github/workflows/daily.yml — updates today's hours, checks the notices");

console.log("\nFound:");
for (const n of notes) console.log("  " + n);

if (problems.length) {
  console.log("\nProblems:");
  for (const p of problems) console.log("  " + p);
  console.log(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}. Do not push yet.\n`);
  process.exit(1);
}
console.log("\nStructure is correct. Safe to push.\n");
