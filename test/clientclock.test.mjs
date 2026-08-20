/* The page works the box out in the reader's browser, and it must reach the
 * SAME answer the build would have.
 *
 * Why this exists: on 2026-08-20 badgergrain's last build was 12:01 UTC and
 * midwestcommodity's was 14:10 UTC — the same workflow file, the same crons,
 * one landed and one did not. At 9:15 Central one site said "Closed now,
 * Thursday. Opens 8:00a" with the yard open. Nothing was broken; the build had
 * simply not run. So the page now carries the rule with it.
 *
 * Two implementations of one rule is how two answers happen, so there is only
 * one: tools/today-core.mjs, imported by the build and inlined by it. What
 * this file proves is that the inlining did not change the behaviour — the
 * generated script is EXECUTED, against a frozen clock and a fake document,
 * at every ten-minute mark of a full week, in both halves of the year, and its
 * output is compared to todayBox()'s.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { todayBox, DAY_NAMES, expireToday } from "../tools/today-core.mjs";
import { clientScript, leanCore, CLIENT_BLOCK } from "../tools/update-today.mjs";

const CORE = readFileSync(new URL("../tools/today-core.mjs", import.meta.url), "utf8");

/* ---- the smallest document the generated script can run against ---------- */
class El {
  constructor(cls = "") { this.className = cls; this.textContent = ""; this.children = []; this.parentNode = null; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c, ref) { c.parentNode = this; this.children.splice(this.children.indexOf(ref), 0, c); return c; }
  removeChild(c) { this.children.splice(this.children.indexOf(c), 1); c.parentNode = null; return c; }
  *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
  querySelector(sel) {
    const want = sel.replace(/^\./, "");
    for (const n of this.walk()) if (String(n.className).split(/\s+/).includes(want)) return n;
    return null;
  }
}
function makeDoc({ withBox = true, boxClass = "today", lbl = "SERVER LABEL", hrs = "SERVER HOURS", json }) {
  const root = new El("root");
  const data = new El(); data.id = "today-hours"; data.textContent = json;
  root.appendChild(data);
  const panel = root.appendChild(new El("panel"));
  if (withBox) {
    const box = panel.appendChild(new El(boxClass));
    box.appendChild(new El("today-lbl")).textContent = lbl;
    box.appendChild(new El("today-hrs num")).textContent = hrs;
  }
  panel.appendChild(new El("hrow"));
  panel.appendChild(new El("hrow"));
  const document = {
    getElementById: (id) => { for (const n of root.walk()) if (n.id === id) return n; return null; },
    querySelector: (s) => root.querySelector(s),
    createElement: () => new El(),
  };
  return { root, document, panel };
}

/* ---- run the real generated block at a real instant ---------------------- */
const H = {
  weekday: "8:00a to 5:00p", saturday: "8:00a to 12:00p", sunday: null,
  harvest: "8:00a to 7:00p", harvest_mode: false, closed_today: false,
  today_override: null, today_date: null,
};

function generated(h = H) {
  const block = clientScript(h, CORE);
  const scripts = [...block.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return { json: scripts[0], code: scripts[1], block };
}

function runAt(instant, opts = {}) {
  const { json, code } = generated(opts.hours ?? H);
  const doc = makeDoc({ json, ...opts });
  const RealDate = Date;
  class Frozen extends RealDate {
    constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(instant.getTime()); }
    static now() { return instant.getTime(); }
  }
  const ctx = vm.createContext({
    document: doc.document, Intl, JSON, Number, String, RegExp, Math, Object, Array,
    Date: Frozen, console,
  });
  vm.runInContext(code, ctx);
  return doc;          // { root, document, panel }
}

/* What the build would have written at the same instant. */
function expected(instant, h = H) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(instant);
  const g = Object.fromEntries(p.map((x) => [x.type, x.value]));
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant);
  const copy = { ...h };
  expireToday(copy, iso);
  return todayBox(copy, {
    dow: DAY_NAMES.indexOf(g.weekday), dayName: g.weekday,
    nowMins: (Number(g.hour) % 24) * 60 + Number(g.minute),
  });
}

/* ---- the grid ------------------------------------------------------------ */
function sweep(startUTC, label) {
  test(`the browser and the build agree at every ten minutes of a week — ${label}`, () => {
    let checked = 0, shut = 0;
    for (let m = 0; m < 7 * 24 * 60; m += 10) {
      const t = new Date(startUTC.getTime() + m * 60000);
      const { root } = runAt(t);
      const want = expected(t);
      const box = root.querySelector(".today");
      if (!want.hours) { assert.equal(box, null, `${t.toISOString()} box should be gone`); shut++; continue; }
      assert.ok(box, `${t.toISOString()} box missing`);
      assert.equal(box.querySelector(".today-lbl").textContent, want.label, t.toISOString());
      assert.equal(box.querySelector(".today-hrs").textContent, want.hours, t.toISOString());
      assert.equal(box.className, "today" + (want.open ? "" : " is-shut"), t.toISOString());
      if (!want.open) shut++;
      checked++;
    }
    assert.ok(checked > 900, `only ${checked} instants exercised`);
    assert.ok(shut > 200, "a week with no closed minutes would not be testing the closed paths");
  });
}
/* Both halves of the year, because Central is UTC-5 in summer and UTC-6 in
   winter and the whole point is that the browser resolves that, not the build. */
sweep(new Date("2026-08-16T05:00:00Z"), "August, CDT");
sweep(new Date("2027-01-17T06:00:00Z"), "January, CST");

/* ---- the specific morning that caused this ------------------------------- */
test("9:15am Central on a Thursday reads OPEN even though the page was built at 7:01", () => {
  const { root } = runAt(new Date("2026-08-20T14:15:00Z"), { lbl: "Closed now, Thursday", hrs: "Opens 8:00a", boxClass: "today is-shut" });
  const box = root.querySelector(".today");
  assert.equal(box.querySelector(".today-lbl").textContent, "Open today, Thursday");
  assert.equal(box.querySelector(".today-hrs").textContent, "8:00a to 5:00p");
  assert.equal(box.className, "today");
});

test("one minute before eight it still says closed, and at eight exactly it opens", () => {
  const a = runAt(new Date("2026-08-20T12:59:00Z")).root.querySelector(".today");
  assert.equal(a.querySelector(".today-lbl").textContent, "Closed now, Thursday");
  assert.equal(a.querySelector(".today-hrs").textContent, "Opens 8:00a");
  const b = runAt(new Date("2026-08-20T13:00:00Z")).root.querySelector(".today");
  assert.equal(b.querySelector(".today-lbl").textContent, "Open today, Thursday");
});

test("at ten past five it says closed for the day, without waiting for a build", () => {
  const box = runAt(new Date("2026-08-20T22:10:00Z")).root.querySelector(".today");
  assert.equal(box.querySelector(".today-lbl").textContent, "Closed for the day");
  assert.equal(box.querySelector(".today-hrs").textContent, "Tomorrow 8:00a");
  assert.equal(box.className, "today is-shut");
});

/* ---- the cases the build cannot cover between runs ----------------------- */
test("a box the build removed on a closed day is rebuilt by the browser the next morning", () => {
  /* Sunday's build removes the box. If Monday's build never runs, without this
     Monday has no box at all — the same failure one day later. */
  const { root, panel } = runAt(new Date("2026-08-17T14:00:00Z"), { withBox: false });   // Monday 9am CDT
  const box = root.querySelector(".today");
  assert.ok(box, "the browser must be able to put the box back");
  assert.equal(box.querySelector(".today-lbl").textContent, "Open today, Monday");
  assert.equal(box.className, "today");
  /* and it goes in ABOVE the weekly rows, not appended after them */
  assert.equal(panel.children.indexOf(box), 0);
});

test("a page cached yesterday does not keep telling people about yesterday's closure", () => {
  /* closed_today carries the date it was set for. The build expires it; only
     the reader knows the page has been sitting in a cache overnight. */
  const stale = { ...H, closed_today: true, today_date: "2026-08-19" };
  const { root } = runAt(new Date("2026-08-20T14:15:00Z"), { hours: stale, lbl: "Closed today, Wednesday", hrs: "Closed" });
  const box = root.querySelector(".today");
  assert.equal(box.querySelector(".today-lbl").textContent, "Open today, Thursday");
});

test("a closure set for today is still honoured", () => {
  const today = { ...H, closed_today: true, today_date: "2026-08-20" };
  const box = runAt(new Date("2026-08-20T14:15:00Z"), { hours: today }).root.querySelector(".today");
  assert.equal(box.querySelector(".today-lbl").textContent, "Closed today, Thursday");
  assert.equal(box.className, "today is-shut");
});

test("harvest mode and a today-override both reach the browser", () => {
  const harvest = { ...H, harvest_mode: true };
  const a = runAt(new Date("2026-08-20T23:30:00Z"), { hours: harvest }).root.querySelector(".today");
  assert.equal(a.querySelector(".today-lbl").textContent, "Harvest hours, Thursday");
  const over = { ...H, today_override: "9:00a to 1:00p", today_date: "2026-08-20" };
  const b = runAt(new Date("2026-08-20T19:00:00Z"), { hours: over }).root.querySelector(".today");
  assert.equal(b.querySelector(".today-lbl").textContent, "Closed for the day",
    "an override sets today's span; it does not claim they are open at two in the afternoon");
});

/* ---- it must fail by doing nothing --------------------------------------- */
test("if anything at all goes wrong the sentence the build wrote is left alone", () => {
  const { code, json } = generated();
  for (const [name, doc] of [
    ["no data element", { getElementById: () => null, querySelector: () => null, createElement: () => new El() }],
    ["unparseable data", { getElementById: () => ({ textContent: "{oh dear" }), querySelector: () => null, createElement: () => new El() }],
    ["no document at all", {}],
  ]) {
    const ctx = vm.createContext({ Intl, JSON, Number, String, RegExp, Math, Object, Array, Date, console });
    if (Object.keys(doc).length) ctx.document = doc;
    assert.doesNotThrow(() => vm.runInContext(code, ctx), name);
  }
  assert.ok(json.length > 10);
});

/* ---- the inlined copy is the real thing, not a rewrite ------------------- */
test("the inlined core is the core, with only comments and the module keyword removed", () => {
  const lean = leanCore(CORE);
  assert.ok(!/\bexport\b/.test(lean), "the module keyword cannot survive into a <script>");
  assert.ok(!/^\s*\/\*/m.test(lean), "line-initial block comments are stripped");
  /* Lines of actual code, taken verbatim out of today-core.mjs. If somebody
     replaces the inlining with a hand-written browser version, these go. */
  for (const line of [
    "function todayBox(h, { dow, dayName, nowMins }) {",
    "h.harvest_mode ? h.harvest : d === 0 ? h.sunday : d === 6 ? h.saturday : h.weekday;",
    "const span = h.closed_today ? null : spanMinutes(hours);",
    "const open = !/^Closed/.test(label);",
  ]) assert.ok(lean.includes(line), `the inlined core no longer contains: ${line}`);
  /* And it is still valid on its own. */
  assert.doesNotThrow(() => new Function(`${lean}\nreturn todayBox;`));
});

test("today-core.mjs cannot reach for anything a browser does not have", () => {
  /* Its own header states these constraints; this is what holds them. Checked
     against the STRIPPED text, because that is what ships and because the
     header itself has to be free to talk about `new Date()` and node: to
     explain why they are forbidden. */
  const lean = leanCore(CORE);
  for (const banned of [/\bimport\s/, /\brequire\(/, /\bprocess\./, /import\.meta/, /node:/, /readFileSync/])
    assert.ok(!banned.test(lean), `the inlined core must not contain ${banned}`);
  assert.ok(!/new Date\(|Date\.now\(/.test(lean),
    "the core must not read a clock; every clock value is an argument, which is what makes it testable");
});

test("the JSON island cannot be closed early by its own contents", () => {
  const nasty = { ...H, today_override: "</script><script>alert(1)</script>" };
  const { json } = generated(nasty);
  assert.ok(!json.includes("</script>"), "an HTML parser would end the island here");
  assert.ok(json.includes("\\u003c/script>"));
  assert.deepEqual(JSON.parse(json).today_override, nasty.today_override);
});

test("the marker pair round-trips, so the block can be rewritten every build", () => {
  let page = "<body>\n<!-- TODAY:js -->\n<!-- /TODAY:js -->\n</body>";
  assert.ok(CLIENT_BLOCK.test(page));
  page = page.replace(CLIENT_BLOCK, () => clientScript(H, CORE));
  assert.ok(CLIENT_BLOCK.test(page), "a rendered block must still be findable, or it freezes like the box did");
  const once = page;
  page = page.replace(CLIENT_BLOCK, () => clientScript(H, CORE));
  assert.equal(page, once, "rendering twice must be stable");
});

test("midnight rendered as hour 24 is midnight, not the twenty-fifth hour", () => {
  /* Node's ICU renders 00:00 as "00" with hour12:false, so the real sweep above
     can never reach this branch — but browser ICU builds have long rendered it
     as "24", and a guard nothing can exercise is a guard nobody can trust.
     So the formatter is replaced with one that says 24 and the answer is
     checked. Without the `% 24` this reads 1440 minutes, sails past the 5pm
     close, and tells a customer at midnight that the yard shut for the day —
     on the one hand true, on the other the wrong sentence: at midnight the
     next thing that happens is opening at eight. */
  const { code, json } = generated();
  const doc = makeDoc({ json, lbl: "SERVER", hrs: "SERVER" });
  const FakeIntl = {
    DateTimeFormat: function (locale, opts) {
      return {
        formatToParts: () => [
          { type: "weekday", value: "Thursday" },
          { type: "hour", value: "24" },
          { type: "minute", value: "00" },
        ],
        format: () => "2026-08-20",
      };
    },
  };
  const ctx = vm.createContext({
    document: doc.document, Intl: FakeIntl, JSON, Number, String, RegExp, Math,
    Object, Array, Date, console,
  });
  vm.runInContext(code, ctx);
  const box = doc.root.querySelector(".today");
  assert.equal(box.querySelector(".today-lbl").textContent, "Closed now, Thursday");
  assert.equal(box.querySelector(".today-hrs").textContent, "Opens 8:00a");
});

test("the first run inserts its own markers, so no index.html upload is needed", () => {
  /* index.html is rewritten every few minutes by a job. A hand-uploaded copy
     is stale before it lands and would revert whatever price the last run
     wrote. So the tool bootstraps itself: this is what makes the change
     deliverable as five files and no page. */
  const page = "<html><body>\n<div class=\"today\"><div class=\"today-lbl\">x</div>" +
    "<div class=\"today-hrs num\">y</div></div>\n<div class=\"hrow\"></div>\n</body></html>";
  assert.equal(CLIENT_BLOCK.test(page), false);
  const bootstrapped = page.replace(/<\/body>/i, "<!-- TODAY:js -->\n<!-- /TODAY:js -->\n\n</body>");
  assert.ok(CLIENT_BLOCK.test(bootstrapped));
  const rendered = bootstrapped.replace(CLIENT_BLOCK, () => clientScript(H, CORE));
  assert.ok(rendered.includes("today-hours"));
  assert.ok(rendered.indexOf("TODAY:js") < rendered.indexOf("</body>"), "the block goes before </body>");
});
