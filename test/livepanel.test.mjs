/* THE PAGE FETCHES ITS OWN NEWER PRICE, AND THESE ARE THE WAYS THAT CAN BREAK
 * WITHOUT ANYTHING GOING RED.
 *
 * PRICE:live in index.html asks GitHub for the newest commit and lifts the
 * price panel out of index.html at that commit, with its own copy of the
 * pattern tools/update-prices.mjs uses to write that panel. If the build's
 * pattern changes and the page's does not, the page quietly stops updating
 * and nobody sees it: the published copy still arrives, just minutes late.
 *
 * It was executed in Chromium against the real commits of 2026-09-21 before
 * it shipped (stale copy replaced, never backwards, 403 pause, hidden tab,
 * wrong host, stale warning both ways). What stays here is what a later edit
 * can break with no browser in the room.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const build = readFileSync(new URL("../tools/update-prices.mjs", import.meta.url), "utf8");
const block = /<!-- PRICE:live -->([\s\S]*?)<!-- \/PRICE:live -->/.exec(html);

test("the page carries the live-price script", () => {
  assert.ok(block, "index.html has no PRICE:live block");
});

test("IT LIFTS THE PANEL WITH THE SAME PATTERN THE BUILD WRITES IT WITH", () => {
  const mine = /var REGION = (\/.*\/);\n/.exec(block[1]);
  const theirs = /const REGION =\s*\n\s*(\/.*\/);\n/.exec(build);
  assert.ok(mine && theirs, "could not find REGION in one of the two files");
  assert.equal(mine[1], theirs[1],
    "the page and the build disagree on where the price panel is; the page would stop updating");
});

test("the pattern finds the panel and the stamp on this very page", () => {
  const src = block[1];
  const REGION = eval(/var REGION = (\/.*\/);\n/.exec(src)[1]);
  const META = eval(/var META = (\/.*\/);\n/.exec(src)[1]);
  const STAMP = eval(/var STAMP = (\/.*\/);\n/.exec(src)[1]);
  const r = REGION.exec(html);
  assert.ok(r && /class="as">as of /.test(r[2]), "the panel on this page has no 'as of' where the script looks");
  const m = META.exec(html);
  assert.ok(m, "no PRICE:meta block on this page");
  if (/id="price-meta"/.test(m[1])) {
    const s = STAMP.exec(m[1]);
    assert.ok(s && Number.isFinite(Date.parse(JSON.parse(s[1]).builtFrom)), "the stamp does not parse");
  }
});

test("it reads at a commit, never at a branch, and only on the two live domains", () => {
  const src = block[1];
  assert.match(src, /RAW \+ sha \+ "\/index\.html"/, "raw is read by branch name; that can serve a copy five minutes old");
  assert.doesNotMatch(src, /\/main\/index\.html/);
  assert.match(src, /"badgergrain\.com": "badgergrain", "midwestcommodity\.com": "midwestcommodity"/);
  assert.match(src, /if \(!repo \|\| /, "it does not stop on a host it does not know");
});

test("it never goes backwards and backs off when GitHub says no", () => {
  const src = block[1];
  assert.match(src, /!\(next > cur\)\) return false;/, "the never-backwards check is gone");
  assert.match(src, /r\.status === 403 \|\| r\.status === 429/, "no pause on a rate limit");
  assert.match(src, /if \(document\.hidden\) return;/, "it asks while the tab is hidden");
});

test("the stale warning looks the panel up again each time, since this script replaces it", () => {
  const stale = /<!-- PRICE:stale -->([\s\S]*?)<!-- \/PRICE:stale -->/.exec(html)[1];
  assert.match(stale, /function paint\(\) \{\s*var meta = document\.getElementById\("price-meta"\);/,
    "PRICE:stale holds the panel from page load and would warn on a panel no longer on screen");
  assert.match(stale, /addEventListener\("pricechange", paint\)/);
});
