#!/usr/bin/env node
/* Keep sitemap.xml honest.

   A one page site does not need a sitemap to be found. What a sitemap
   is actually worth here is <lastmod>: it is the only way to tell a
   crawler "the price on this page changed this morning" without waiting
   for it to work that out on its own. Cash bids are the reason anybody
   searches for this business, and a bid Google last saw in April is
   worse than no bid at all.

   That only works if lastmod is TRUE. A sitemap that claims today's
   date every day, whether or not anything changed, teaches Google to
   ignore the field, and Google says as much. So this script does not
   stamp the date on a schedule. It hashes index.html, compares that to
   the hash it recorded last time inside the sitemap itself, and rewrites
   the date only when the page genuinely differs.

   Run it after anything that edits index.html. It is safe to run when
   nothing changed, which is most days: it writes nothing and says so.

     node tools/update-sitemap.mjs [folder]
     node tools/update-sitemap.mjs --index <file> --sitemap <file>

   Folder defaults to the current directory, which is how the published
   site repositories run it: index.html and sitemap.xml side by side.

   The two-file form is for build.sh, where the page being measured is
   the assembled one in dist/ but the sitemap that has to REMEMBER the
   hash is the one in the source folder, because dist/ is deleted and
   rebuilt every time. Measure the output, record it in the source. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const dir = process.argv[2]?.startsWith("--") ? null : (process.argv[2] || ".");
const idx = arg("--index")   || join(dir ?? ".", "index.html");
const map = arg("--sitemap") || join(dir ?? ".", "sitemap.xml");

if (!existsSync(idx)) { console.error(`no such file: ${idx}`); process.exit(1); }
if (!existsSync(map)) { console.error(`no such file: ${map}`); process.exit(1); }

let html = readFileSync(idx, "utf8");

/* Hash the page with the volatile parts removed, so the sitemap does not
   claim the content changed when only a timestamp did. Two things move
   without the page meaning anything different: the "as of" line the
   price publisher writes, and the today's-hours box the daily job
   rewrites every morning. A new PRICE is a real change and stays in. */
const stable = html
  .replace(/<span class="as num">[\s\S]*?<\/span>/g, "")
  .replace(/<div class="today">[\s\S]*?<\/div>\s*<div class="hrow">/g, '<div class="hrow">')
  // All whitespace goes, not just runs of it. Removing a span leaves
  // the space that sat in front of it, and that space is not a change.
  // Nothing on this page means anything different for having been
  // re-indented, so whitespace has no place in the hash at all.
  .replace(/\s+/g, "");
const hash = createHash("sha256").update(stable).digest("hex").slice(0, 16);

const xml = readFileSync(map, "utf8");
const had = xml.match(/index ([0-9a-f]{16})/)?.[1];

if (had === hash) { console.log(`sitemap: unchanged (index ${hash})`); process.exit(0); }

// Central time. A build running at 1am UTC is still yesterday in Wheeler.
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

let out = xml.replace(/<lastmod>[^<]*<\/lastmod>/, `<lastmod>${today}</lastmod>`);
out = had
  ? out.replace(/index [0-9a-f]{16}/, `index ${hash}`)
  : out.replace(/<urlset/, `<!-- index ${hash} -->\n<urlset`);

if (!/<lastmod>/.test(out)) { console.error("sitemap.xml has no <lastmod> to update"); process.exit(1); }

writeFileSync(map, out);
console.log(`sitemap: lastmod ${today} (index ${hash})`);
