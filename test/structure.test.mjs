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
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, existsSync } from "node:fs";
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
  for (const f of ["index.html", "site.css", "CNAME", ".nojekyll", "hours.json",
                   "pricing.json", "robots.txt", "sitemap.xml"])
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
  const d = scratch();
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.match(r.out, /prices\.yml — rebuilds the "Open today" box on 3 schedules/);
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

test("a missing file Pages needs is still a problem", () => {
  const d = scratch();
  rmSync(join(d, ".nojekyll"));
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.out, /MISSING: \.nojekyll/);
  assert.ok(!existsSync(d));
});
