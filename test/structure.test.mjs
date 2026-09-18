/* tools/check-structure.mjs, against repositories that are wrong on purpose.
 *
 * WHY THIS EXISTS. The checker had a rule that required
 * `.github/workflows/daily.yml`. That file has never existed in either site,
 * so `node tools/check-structure.mjs` exited 1 on a clean, correctly working
 * repository for as long as the rule was there -- while the job it actually
 * cared about, update-today.mjs, ran every few minutes inside prices.yml the
 * whole time.
 *
 * Nothing caught it because nothing tested the checker. A checker is a guard
 * like any other, and an untested guard is a guess.
 *
 * The rule now tests the CAPABILITY -- is something rebuilding the hours box,
 * on a clock -- rather than a filename. These cases are the ones that were run
 * by hand to prove the loosened rule still bites. A guard that only ever
 * passes is not a guard, so the failure cases matter more here than the
 * passing one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/* A minimal repository that passes, built from the real one so the test can
   never drift from what the checker requires. Callers then break one thing. */
function scratch() {
  const d = mkdtempSync(join(tmpdir(), "structure-"));
  mkdirSync(join(d, "tools"), { recursive: true });
  mkdirSync(join(d, ".github", "workflows"), { recursive: true });
  /* site.webmanifest joined this list on 2026-08-29, when index.html started
     referencing it. check-structure requires every src/href in the page to
     exist, so a fixture missing this file makes the checker fail on a
     repository where nothing is wrong -- which is the one thing this test
     exists to prevent. */
  for (const f of ["index.html", "site.css", "CNAME", ".nojekyll", "hours.json",
                   "pricing.json", "robots.txt", "sitemap.xml", "site.webmanifest"])
    cpSync(join(REPO, f), join(d, f));
  for (const dir of ["assets", "fonts"]) cpSync(join(REPO, dir), join(d, dir), { recursive: true });
  cpSync(join(REPO, "tools", "check-structure.mjs"), join(d, "tools", "check-structure.mjs"));
  cpSync(join(REPO, ".github", "workflows", "prices.yml"), join(d, ".github", "workflows", "prices.yml"));
  return d;
}

function run(dir) {
  try {
    const out = execFileSync(process.execPath, ["tools/check-structure.mjs"],
      { cwd: dir, encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
}

const WITH_SCHEDULE = 'name: x\non:\n  schedule:\n    - cron: "0 * * * *"\njobs:\n' +
  "  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node tools/update-prices.mjs\n";
const PUSH_ONLY = "name: y\non:\n  push:\n    branches: [main]\njobs:\n" +
  "  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node tools/update-today.mjs\n";

test("AN UNTOUCHED REPOSITORY PASSES", () => {
  /* The whole point. This exited 1 for weeks on a repo where nothing was
     wrong, which teaches people that the checker is noise -- and then it is
     not listened to on the day it is right. */
  const d = scratch();
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Structure is correct/);
});

test("and it names the workflow that actually rebuilds the box, with its schedules", () => {
  /* THIS USED TO ASSERT THE WORD "3".
     It went red the day prices.yml went from three windows to one schedule --
     a change that made the box MORE current, not less. A test that fails when
     the thing under test gets better is pinning the shape of today's file, not
     the behaviour, and the cost is that the next person reads a red suite as
     "the edit was wrong" instead of "the assertion was".
     What the checker actually owes a reader: name the workflow, count the
     crons that are really in it, agree with itself about singular and plural,
     and print each one so a stale schedule is visible without opening the
     file. All four are derived from the file here, so this survives the next
     schedule change and still fails if the line stops being true. */
  const d = scratch();
  const yml = readFileSync(join(d, ".github", "workflows", "prices.yml"), "utf8");
  const crons = [...yml.matchAll(/cron:\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const r = run(d);
  rmSync(d, { recursive: true, force: true });

  assert.ok(crons.length, "the fixture repository has no schedule to report");
  const plural = crons.length === 1 ? "schedule" : "schedules";
  assert.match(r.out, new RegExp(
    'prices\\.yml — rebuilds the "Open today" box on ' + crons.length + " " + plural),
    `the checker did not report ${crons.length} ${plural}. Output:\n${r.out}`);
  for (const c of crons)
    assert.ok(r.out.includes(c), `the checker did not print the schedule ${c}`);
});

test("NO WORKFLOWS AT ALL IS STILL A PROBLEM", () => {
  const d = scratch();
  rmSync(join(d, ".github"), { recursive: true, force: true });
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.out, /no workflows at all/);
});

test("a workflow that does not run update-today.mjs does not count", () => {
  /* The loosened rule must not be satisfied by the mere presence of a file.
     This is the shape the old filename rule was reaching for and missing. */
  const d = scratch();
  rmSync(join(d, ".github", "workflows", "prices.yml"));
  writeFileSync(join(d, ".github", "workflows", "other.yml"), WITH_SCHEDULE);
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.out, /no workflow runs tools\/update-today\.mjs/);
  assert.match(r.out, /other\.yml/, "and it says what it did find");
});

test("RUNNING IT ONLY ON PUSH IS NOT ENOUGH", () => {
  /* The day rolls over at midnight whether or not anybody is committing. A
     push-triggered rebuild cannot do that, so the box would sit on yesterday
     until somebody happened to change a file. */
  const d = scratch();
  rmSync(join(d, ".github", "workflows", "prices.yml"));
  writeFileSync(join(d, ".github", "workflows", "other.yml"), PUSH_ONLY);
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.out, /no schedule/);
  assert.match(r.out, /It needs a clock/);
});

test("pricing.json is required, because update-prices.mjs throws without it", () => {
  const d = scratch();
  rmSync(join(d, "pricing.json"));
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.out, /MISSING: pricing\.json/);
});

test("the checks that were already there still fire", () => {
  /* Guarding the guard: this file changed section 5 and added one `need`.
     If a later edit breaks the nesting or link checks, that shows up here
     rather than on a 404 at the domain. */
  const d = scratch();
  mkdirSync(join(d, "badgergrain-com"));
  cpSync(join(d, "index.html"), join(d, "badgergrain-com", "index.html"));
  cpSync(join(d, "site.css"), join(d, "badgergrain-com", "site.css"));
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.out, /NESTED: there is a complete site inside badgergrain-com\//);
});

/* ── THE LOGO THE OWNER HAS NOT SENT YET ───────────────────────────────────
 *
 * On 2026-09-18 both mastheads and both "Our other location" cards stopped
 * being a CSS lockup and became one <img class="mark"> apiece, pointing at
 * assets/logo-badgergrain.png and assets/logo-midwestcommodity.png. Kristi is
 * sending the artwork; the slot shipped first so that uploading the two files
 * is the whole of the remaining work.
 *
 * That put rule 3 -- every src/href in the page must exist -- in direct
 * conflict with the shipped state of the repository, and the wrong way out of
 * that conflict is to soften rule 3. These four cases are the fence around the
 * narrow exemption that was added instead: it names exactly two paths, it only
 * applies while the reference still carries the company name as alt text, it
 * never touches the exit code, and it disappears by itself the moment the file
 * is there. Everything else that is missing is still "Do not push yet".
 */
const MARKS = ["assets/logo-badgergrain.png", "assets/logo-midwestcommodity.png"];

test("ARTWORK THAT HAS NOT ARRIVED IS REPORTED, AND IS NOT A PROBLEM", () => {
  /* THE MARKS LANDED ON 2026-09-18 AND THIS TEST OUTLIVED THEM. It used to
     read the waiting state straight off the repository, so delivering the
     artwork turned it red -- a test failing because the thing it was waiting
     for arrived. The waiting state is still worth guarding, because the next
     mark that is commissioned will pass through it, so the state is now made
     on purpose in the scratch copy instead of borrowed from the repository. */
  const d = scratch();
  for (const m of MARKS) rmSync(join(d, m), { force: true });
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Awaiting artwork/, "the checker says nothing about the missing marks");
  for (const m of MARKS)
    assert.ok(r.out.includes(m), `the checker did not name ${m} as awaited`);
  assert.doesNotMatch(r.out, /BROKEN LINK: index\.html asks for assets\/logo-/,
    "an awaited mark was reported as a broken link");
});

test("and the line goes away by itself once the file is there", () => {
  /* The exemption must be self-deleting. If it were not, it would go on
     reporting artwork as outstanding after it had been delivered, and the next
     person would learn to skip that section. */
  const d = scratch();
  for (const m of MARKS) writeFileSync(join(d, m), "not really a png, but it exists");
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /Awaiting artwork/,
    "the marks are in the repository and the checker still says it is waiting for them");
});

test("A MISSING FILE THAT IS NOT ON THAT LIST IS STILL A HARD PROBLEM", () => {
  /* The exemption is two paths long and must not have widened into "images are
     allowed to be missing". site.webmanifest is the file that joined rule 3's
     coverage last, so it is the one to prove with. */
  const d = scratch();
  rmSync(join(d, "site.webmanifest"));
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.out, /BROKEN LINK: index\.html asks for site\.webmanifest/);
});

test("an awaited mark WITHOUT alt text is a broken link again", () => {
  /* The alt text is the entire reason a missing mark is survivable: it is what
     the browser draws in the file's place, so the page still names the
     business. Strip it and the masthead is an empty box, which is not a state
     to wave through. */
  const d = scratch();
  /* Same reason as the awaited-artwork test above: this case is about a mark
     that is NOT in the repository, so the scratch copy has to be put back into
     that state now that the real files are there. */
  for (const m of MARKS) rmSync(join(d, m), { force: true });
  const p = join(d, "index.html");
  const html = readFileSync(p, "utf8");
  const stripped = html.replace(/(<img class="mark"[^>]*?)\s+alt="[^"]*"/g, "$1");
  assert.notEqual(stripped, html, "the fixture page has no <img class=\"mark\"> to strip");
  writeFileSync(p, stripped);
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /BROKEN LINK: index\.html asks for assets\/logo-/);
});

test("a missing file Pages needs is still a problem", () => {
  const d = scratch();
  rmSync(join(d, ".nojekyll"));
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.out, /MISSING: \.nojekyll/);
  assert.ok(!existsSync(d));
});
