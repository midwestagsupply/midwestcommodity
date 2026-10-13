/* THE PRICE IS HIDDEN WHEN THE BUILD STOPS, AND THE STAMP SAYS WHEN CBOT IS SHUT.
 *
 * The PRICE:stale script in index.html is run here, as shipped, against a
 * frozen clock and the smallest document it can work on. Past two hours with
 * no build the cash column must be dashes and "Prices paid today" must be
 * gone; past a day the "since" time must carry its date; while fresh, the
 * stamp says "CBOT closed" outside trading hours and nothing extra inside them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const SRC = /<!-- PRICE:stale -->\s*<script>([\s\S]*?)<\/script>\s*<!-- \/PRICE:stale -->/.exec(HTML)[1];
const BUILT = "2026-10-13T15:10:00Z";          // Tuesday 10:10am Central, market open

class El {
  constructor(tag, cls = "") {
    this.tag = tag; this.className = cls; this.children = []; this.attrs = {};
    this._text = ""; this.parentNode = null;
    const self = this;
    this.classList = {
      remove: (c) => { self.className = self.className.split(/\s+/).filter((x) => x !== c).join(" "); },
      add: (c) => { if (!self.classList.contains(c)) self.className = (self.className + " " + c).trim(); },
      contains: (c) => self.className.split(/\s+/).includes(c),
    };
  }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
  set textContent(v) { this.children = []; this._text = String(v); }
  get firstChild() { return this.children[0] ?? null; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c, ref) { c.parentNode = this; this.children.splice(this.children.indexOf(ref), 0, c); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
  matches(sel) {
    const [tag, cls] = sel.includes(".") ? sel.split(".") : [sel, null];
    return (!tag || this.tag === tag) && (!cls || this.classList.contains(cls));
  }
  querySelectorAll(sel) {
    const alts = sel.split(",").map((s) => s.trim());
    const out = [];
    for (const n of this.walk()) {
      for (const alt of alts) {
        const parts = alt.split(/\s+/);
        if (!n.matches(parts.at(-1))) continue;
        let a = n.parentNode, ok = true;
        for (let i = parts.length - 2; i >= 0; i--) {
          while (a && !a.matches(parts[i])) a = a.parentNode;
          if (!a) { ok = false; break; }
          a = a.parentNode;
        }
        if (ok) { out.push(n); break; }
      }
    }
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}
class Text extends El {
  constructor(v) { super("#text"); this.nodeValue = v; }
  get textContent() { return this.nodeValue; }
}

function page(builtFrom) {
  const root = new El("body");
  const col = root.appendChild(new El("div", "pricecol"));
  const panel = col.appendChild(new El("div", "panel"));
  const hd = panel.appendChild(new El("div", "hd"));
  hd.appendChild(new Text("Prices paid today"));
  hd.appendChild(new El("span", "as")).textContent = "as of Tuesday, October 13, 10:10am";
  const table = panel.appendChild(new El("table", "bids"));
  for (const m of ["October", "November"]) {
    const tr = table.appendChild(new El("tr"));
    tr.appendChild(new El("td", "mo")).textContent = m;
    tr.appendChild(new El("td", "fut")).textContent = "$4.83";
    tr.appendChild(new El("td", "bas")).textContent = "−0.62";
    tr.appendChild(new El("td", "pay")).textContent = "$4.21";
  }
  const call = root.appendChild(new El("a", "call"));
  call.appendChild(new El("span", "nb")).textContent = "(715) 704-0548";
  const meta = root.appendChild(new El("script"));
  meta.id = "price-meta"; meta.textContent = JSON.stringify({ builtFrom });
  return { root, panel, hd, table };
}

function run(builtFrom, nowIso) {
  const p = page(builtFrom);
  const NOW = Date.parse(nowIso);
  class FixedDate extends Date {
    constructor(...a) { super(...(a.length ? a : [NOW])); }
    static now() { return NOW; }
  }
  const document = {
    getElementById: (id) => { for (const n of p.root.walk()) if (n.id === id) return n; return null; },
    querySelector: (s) => p.root.querySelector(s),
    createElement: (t) => new El(t),
    createTextNode: (v) => new Text(v),
    addEventListener() {},
  };
  vm.runInNewContext(SRC, { document, window: { addEventListener() {} }, Date: FixedDate, Intl,
    JSON, setInterval() {} });
  return p;
}
const pays = (p) => p.table.querySelectorAll("td.pay").map((c) => c.textContent);
const futs = (p) => p.table.querySelectorAll("td.fut").map((c) => c.textContent);

test("a fresh build during trading hours is left exactly as built", () => {
  const p = run(BUILT, "2026-10-13T15:20:00Z");
  assert.equal(p.hd.textContent, "Prices paid todayas of Tuesday, October 13, 10:10am");
  assert.deepEqual(pays(p), ["$4.21", "$4.21"]);
  assert.ok(!p.panel.classList.contains("is-stale"));
});

test("a fresh build while CBOT is shut says so on the stamp", () => {
  /* 8:00am Central Tuesday: the 7:45 to 8:30 break. */
  const p = run("2026-10-13T12:55:00Z", "2026-10-13T13:00:00Z");
  assert.match(p.hd.querySelector(".as").textContent, /· CBOT closed$/);
  assert.deepEqual(pays(p), ["$4.21", "$4.21"], "closed is not stale: the price stays");
  /* Saturday noon, and Sunday evening after 7pm when it reopens. */
  assert.match(run("2026-10-17T16:55:00Z", "2026-10-17T17:00:00Z").hd.textContent, /CBOT closed/);
  assert.doesNotMatch(run("2026-10-19T00:55:00Z", "2026-10-19T01:00:00Z").hd.textContent, /CBOT closed/);
});

test("PAST TWO HOURS THE PRICE IS HIDDEN AND THE PAGE ASKS FOR A CALL", () => {
  const ok = run(BUILT, "2026-10-13T19:05:00Z");          // 3h55m
  assert.deepEqual(pays(ok), ["$4.21", "$4.21"]);
  const p = run(BUILT, "2026-10-13T19:20:00Z");           // 4h10m
  assert.ok(p.panel.classList.contains("is-stale"));
  assert.doesNotMatch(p.hd.textContent, /Prices paid today/);
  assert.match(p.hd.textContent, /^Prices not updatingsince Tue 10:10am$/);
  assert.deepEqual(pays(p), ["—", "—"], "no cash price on a page that stopped");
  assert.deepEqual(futs(p), ["—", "—"], "nor a frozen futures quote");
  const warn = p.panel.querySelector(".stalewarn");
  assert.ok(warn, "a call prompt");
  assert.match(warn.textContent, /Call \(715\) 704-0548 for today’s price\./);
  assert.equal(warn.getAttribute("role"), "alert");
  assert.equal(warn.querySelector(".nb").textContent, "(715) 704-0548", "the number is kept on one line");
});

test("past a day the 'since' time carries its date", () => {
  const p = run(BUILT, "2026-10-15T15:20:00Z");
  assert.match(p.hd.textContent, /since Tue, Oct 13, 10:10am$/);
  assert.match(p.panel.querySelector(".stalewarn").textContent, /since Tue, Oct 13, 10:10am\./);
});
