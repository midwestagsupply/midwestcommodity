/* EVERY FILE THE PRICE RUN WRITES MUST BE A FILE THE PRICE RUN COMMITS.
 *
 * WHAT HAPPENED. tools/update-prices.mjs has written price-history.json on
 * every run since it was added. .github/workflows/prices.yml said:
 *
 *     git add index.html bids.json bids.csv hours.json sitemap.xml
 *
 * price-history.json is not in that list. So the file was written into the
 * runner's working tree, never staged, never committed, and thrown away when
 * the runner was destroyed. The copy in the repository stayed at the hand-made
 * backfill of 2026-08-31.
 *
 * Nothing went red. The run was green, the prices were right, and the only
 * symptom was on the customer's own price board: on Tuesday 8 September this
 * site said
 *
 *     down 11¢ from Monday
 *
 * where "Monday" was Monday 31 AUGUST, eight days and five sessions earlier,
 * because change() takes the most recent session the history holds and the
 * history had stopped. A farmer reads that as yesterday to today.
 *
 * This is the same shape as the bids repository's `git add data/boyceville.json`,
 * which went wrong for the same reason: a hardcoded list of paths beside code
 * that writes a different set. So the guard is not "price-history.json is in
 * the list" — that fixes today and not the next one. It is: whatever the
 * writer writes, the workflow stages.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const UPDATER = read("tools/update-prices.mjs");
const WORKFLOW = read(".github/workflows/prices.yml");

/* Paths the updater writes, taken from the source rather than from memory.
   Two shapes: a literal, and HISTORY_PATH, which is a literal one line away. */
function writtenPaths(src) {
  const out = new Set();
  for (const m of src.matchAll(/writeIfChanged\(\s*"([^"]+)"/g)) out.add(m[1]);
  for (const m of src.matchAll(/writeIfChanged\(\s*([A-Z_]+)\s*,/g)) {
    const c = src.match(new RegExp(`(?:export )?const ${m[1]}\\s*=\\s*"([^"]+)"`));
    assert.ok(c, `${m[1]} is written but this test cannot resolve it to a path`);
    out.add(c[1]);
  }
  return [...out].sort();
}

/* The single `git add` line in the price workflow. */
function stagedPaths(yml) {
  const line = yml.split("\n").find((l) => l.trim().startsWith("git add "));
  assert.ok(line, "prices.yml has no `git add` line at all");
  return line.trim().replace(/^git add\s+/, "").split(/\s+/).filter(Boolean).sort();
}

test("the price run stages every file it writes", () => {
  const written = writtenPaths(UPDATER);
  const staged = stagedPaths(WORKFLOW);

  /* COUNT THE COPIES FIRST. A regex that stopped matching would find nothing
     and pass, which is exactly how a guard goes quietly blind. */
  assert.ok(written.length >= 4,
    `only found ${written.length} written path(s) — this test has stopped reading the updater`);
  assert.ok(staged.length >= 4,
    `only found ${staged.length} staged path(s) — this test has stopped reading the workflow`);

  const missing = written.filter((p) => !staged.includes(p));
  assert.deepEqual(missing, [],
    `written and never committed: ${missing.join(", ")}. The run stays green and the file in the `
    + `repository silently stops moving.`);
});

test("price-history.json in particular, because it is the one that was missed", () => {
  /* Named on its own as well as covered by the rule above. The rule is what
     catches the next one; this line is what makes the failure legible. */
  assert.ok(stagedPaths(WORKFLOW).includes("price-history.json"),
    "price-history.json is written on every run and would never be committed again");
});

test("the history the change line reads has a session from this month", () => {
  /* THE SYMPTOM, NOT THE MECHANISM. A history that stops does not throw and
     does not change the shape of anything; it just makes the page name a day
     that is further and further away. If this fails, look at whether the price
     workflow is committing price-history.json before looking anywhere else. */
  const h = JSON.parse(read("price-history.json"));
  const days = Object.keys(h.days ?? {}).sort();
  assert.ok(days.length, "price-history.json holds no sessions at all");
  const newest = days[days.length - 1];
  const age = (Date.now() - Date.parse(newest + "T23:59:59Z")) / 86_400_000;
  /* SIX DAYS, AND THE FIRST NUMBER HERE WAS FOURTEEN, WHICH WAS USELESS.
     The bug this file exists for ran for EIGHT days, so a fortnight's tolerance
     would have sat green through the whole of it. Found by putting the stale
     file back and watching the test pass anyway.
     Six is chosen against the longest gap the calendar can produce: a Thursday
     session before a Friday holiday, then the weekend, is four days to the next
     one — Christmas and New Year both land that way. Six clears that and still
     fails an eight-day stall on day six. */
  assert.ok(age < 6,
    `the newest session in price-history.json is ${newest}, ${Math.floor(age)} days old. `
    + `change() names the most recent session it holds, so the board is telling customers `
    + `the price moved "from" a day that is nearly a week gone.`);
});
