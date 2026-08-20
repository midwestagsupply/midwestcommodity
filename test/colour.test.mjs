/* THE TWO SITES' COLOURS, CHECKED RATHER THAN TRUSTED.
 *
 * This file exists because of two faults that reading the stylesheet did not
 * find and rendering it did:
 *
 *  - 2026-08-19: the "Our other location" card drew the SISTER company's
 *    wordmark in THIS company's colour, on the one element whose whole job is
 *    to tell the two apart.
 *  - 2026-08-20: Midwest Commodity took a deep pine green, and three separate
 *    places had to move together -- its own --brand, its <meta theme-color>,
 *    and --sister-brand in the OTHER repository. Nothing checked that they
 *    agreed, so any one of them could have been missed silently.
 *
 * A test in one repository cannot see the other's stylesheet, so what is
 * checked here is every invariant that IS local. The cross-repo half is the
 * one line at the bottom, and it is a reminder with teeth: it fails if this
 * site's sister colour is the same as its own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css  = readFileSync(new URL("../site.css",   import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const varOf = (name) => {
  const m = css.match(new RegExp("--" + name + "\\s*:\\s*(#[0-9a-fA-F]{6})"));
  assert.ok(m, `--${name} is not defined in site.css`);
  return m[1].toLowerCase();
};
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("the operational yellow is the SAME on both sites and is not the brand", () => {
  // The notice banner and the Open-today box mean "read this now". Somebody
  // who uses both sites must not have to learn that signal twice, so this
  // value is the one thing that must never vary between the repositories.
  assert.equal(varOf("yellow"), "#f5cf4e");
});

test("text on the brand colour is readable", () => {
  const c = contrast(varOf("brand"), varOf("on-brand"));
  assert.ok(c >= 4.5, `--on-brand on --brand is ${c.toFixed(2)}:1, under 4.5`);
});

test("the hover keeps its contrast", () => {
  const c = contrast(varOf("brand-dk"), varOf("on-brand"));
  assert.ok(c >= 4.5, `--on-brand on --brand-dk is ${c.toFixed(2)}:1, under 4.5`);
});

test("the 'as of' line in the panel header is readable", () => {
  // Shipped at 4.12:1 once and had to be lightened. It is small, grey-ish and
  // the easiest thing on the page to leave failing.
  const c = contrast(varOf("panel-hd"), varOf("panel-hd-as"));
  assert.ok(c >= 4.5, `--panel-hd-as on --panel-hd is ${c.toFixed(2)}:1, under 4.5`);
});

test("the panel header text is readable", () => {
  const c = contrast(varOf("panel-hd"), varOf("panel-hd-fg"));
  assert.ok(c >= 4.5, `--panel-hd-fg on --panel-hd is ${c.toFixed(2)}:1, under 4.5`);
});

test("THE PHONE'S ADDRESS BAR MATCHES THE BRAND", () => {
  // <meta theme-color> is a fourth place the brand colour is written down and
  // the only one that is not in the stylesheet, so it is the one that gets
  // forgotten. It was, on both sites, until this test.
  const m = html.match(/<meta\s+name="theme-color"\s+content="(#[0-9a-fA-F]{6})"/i);
  assert.ok(m, "no theme-color meta");
  assert.equal(m[1].toLowerCase(), varOf("brand"));
});

test("THE SISTER SITE IS NOT DRAWN IN THIS SITE'S COLOUR", () => {
  // The 2026-08-19 fault, exactly. If these are ever equal, the card at the
  // foot of the page is telling the reader the two elevators are the same one.
  assert.notEqual(varOf("sister-brand"), varOf("brand"));
});

test("the sister colour is applied to the sister mark only", () => {
  assert.match(css, /\.sister\s+\.wmrule\s*\{[^}]*--sister-brand/,
    "the sister wordmark rule must use --sister-brand, or it inherits --brand");
});
