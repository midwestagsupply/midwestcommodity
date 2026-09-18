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
 *  - 2026-09-18: both sites took the colours sampled out of the marks Kristi
 *    delivered, and the same three places had to move again, in both
 *    repositories, in opposite directions. "Not equal to each other" would
 *    have passed with the two values swapped -- each site drawn entirely in
 *    the other company's colour, which is the 2026-08-19 fault doubled.
 *
 * A test in one repository cannot see the other's stylesheet, so what is
 * checked here is every invariant that IS local. The cross-repo half is the
 * table below: both sites' sampled colours are written down in both copies of
 * this file, and each repository is told which row is its own by its OWN
 * CNAME rather than by anything typed here. A swap fails in both repositories
 * at once, and so does a copy of the wrong site's stylesheet.
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

/* THE COLOURS AS SAMPLED OFF THE ARTWORK, 2026-09-18. Neither value was
 * chosen. Each is the most common opaque pixel in that company's own file in
 * assets/ -- 92,350 of the maroon, and the Midwest row is that mark's leaf
 * green #24b252 with its hue and saturation held and its lightness alone taken
 * down to 0.240, because the leaf itself is 2.78:1 on white and cannot be the
 * ground of a Call button. Both rows appear in BOTH repositories on purpose:
 * that is what makes a swap detectable from inside one of them. */
const MARK = {
  badgergrain:      "#82313a",
  midwestcommodity: "#15662f",
};

const slugOfMe = () =>
  readFileSync(new URL("../CNAME", import.meta.url), "utf8").trim().replace(/\.com$/, "");
const slugOfSister = () => {
  const m = /<a class="sister-a" href="https:\/\/([^/"]+)\//.exec(html);
  assert.ok(m, "there is no \"Our other location\" card to read the sister site off");
  return m[1].replace(/\.com$/, "");
};

test("THE BRAND IS THE COLOUR SAMPLED OUT OF THIS SITE'S OWN MARK", () => {
  const me = slugOfMe();
  assert.ok(MARK[me], `${me} has no sampled colour in the table above`);
  assert.equal(varOf("brand"), MARK[me],
    `${me}.com is not drawn in ${me}'s own colour`);
});

test("THE SISTER COLOUR IS THE OTHER SITE'S BRAND, TO THE BYTE", () => {
  /* "not equal to mine" is not enough. With the two values swapped it still
     passes, and every branded thing on both sites comes out in the other
     company's colour. This one reads the sister off the card's own href, so
     it is the other site's row that has to match. */
  const them = slugOfSister();
  assert.ok(MARK[them], `${them} has no sampled colour in the table above`);
  assert.equal(varOf("sister-brand"), MARK[them],
    `the foot of this page draws ${them} in a colour that is not ${them}'s`);
});

test("THE LEAF GREEN NEVER CARRIES TEXT", () => {
  /* Midwest's mark has a second colour, the leaf #24b252. It is 2.78:1 on the
     paper -- under the 4.5 body-text floor and under the 3.0 large-text floor
     -- so it is kept as a token for decoration and must never be set as a
     colour. If it is ever painted as one, this fails before it ships. */
  const m = css.match(/--leaf\s*:\s*(#[0-9a-fA-F]{6})/);
  if (!m) return;                       // only the site whose mark has a leaf
  assert.equal(m[1].toLowerCase(), "#24b252", "--leaf is not the sampled leaf");
  assert.ok(contrast(m[1].toLowerCase(), varOf("paper")) < 4.5,
    "--leaf now passes for text, so this restriction is describing the wrong colour");
  assert.doesNotMatch(css, /(^|[;{\s])color\s*:\s*var\(\s*--leaf\s*\)/,
    "--leaf is being used as a text colour, at 2.78:1 on the paper");
});

test("THE SISTER SITE IS NOT DRAWN IN THIS SITE'S COLOUR", () => {
  // The 2026-08-19 fault, exactly. If these are ever equal, the card at the
  // foot of the page is telling the reader the two elevators are the same one.
  assert.notEqual(varOf("sister-brand"), varOf("brand"));
});

/* ── THE SISTER MARK STOPPED BEING A WORDMARK ──────────────────────────────
 *
 * This assertion used to read:
 *
 *     assert.match(css, /\.sister\s+\.wmrule\s*\{[^}]*--sister-brand/)
 *
 * and on 2026-09-18 it became a true statement about a dead element. The
 * "Our other location" card no longer builds the other company's name out of
 * .wm1 / .wmrule / .wm2; Kristi asked for the real logos back, so it is one
 * <img class="mark"> now. The rule it was checking is still in site.css --
 * left there with the rest of the lockup, because the corn artwork is still in
 * the repository -- so the old line would have gone on passing forever while
 * checking nothing that renders. That is worse than a red test.
 *
 * The invariant it was protecting has not changed and is restated below on the
 * element that actually draws: the card at the foot of the page shows the
 * OTHER elevator, in the OTHER elevator's colour. Both halves are checked,
 * and both are derived from this repository's own CNAME rather than typed, so
 * neither can be satisfied by a copy of the wrong site's file.
 */
test("the sister colour is applied to the sister mark only", () => {
  assert.match(css, /\.logo\.sm\s+\.mark\s*\{[^}]*--sister-brand/,
    "the sister mark must use --sister-brand, or it falls back to this site's own colour");
  assert.doesNotMatch(css, /\.logo\s+\.mark\s*\{[^}]*--sister-brand/,
    "the MASTHEAD mark is drawn in --sister-brand, which is the other company's colour");
});

test("THE FOOT OF THE PAGE SHOWS THE OTHER ELEVATOR'S MARK, NOT THIS ONE'S", () => {
  /* The 2026-08-19 fault could only ever recolour the sister card. The same
     card can now be wrong in a louder way: pointed at this site's own logo
     file, so the "Our other location" link shows the location you are already
     standing in. Read off CNAME and off the link's own href, so this test does
     not care which of the two repositories it is running in. */
  const slug = (host) => host.replace(/\.com$/, "");
  const mine = slug(readFileSync(new URL("../CNAME", import.meta.url), "utf8").trim());

  const head = /<h1 class="logo">[\s\S]*?<\/h1>/.exec(html);
  assert.ok(head, "there is no masthead to check");
  const headSrc = /<img[^>]*\bsrc="([^"]+)"/.exec(head[0]);
  assert.ok(headSrc, "the masthead draws no image");
  assert.equal(headSrc[1], `assets/logo-${mine}.png`,
    `the masthead of ${mine}.com does not show ${mine}'s own mark`);

  /* The <h1> has no text of its own any more -- the mark IS the heading -- so
     the alt attribute is the only thing naming this business at the top of the
     page, to a screen reader and to a browser that has no artwork to draw. It
     has to be the same name the structured data gives. */
  const headAlt = /<img[^>]*\balt="([^"]+)"/.exec(head[0]);
  assert.ok(headAlt && headAlt[1].trim(),
    "the masthead mark has no alt text, so the <h1> of this page is empty");
  const stated = /itemprop="name"[^>]*content="([^"]+)"/.exec(html)[1];
  assert.equal(headAlt[1], stated,
    "the name at the top of the page and the name in the structured data are different");

  const card = /<a class="sister-a" href="https:\/\/([^/"]+)\/"[\s\S]*?<\/a>/.exec(html);
  assert.ok(card, "there is no \"Our other location\" card to check");
  const theirs = slug(card[1]);
  assert.notEqual(theirs, mine, "the other location links back to this same site");
  const cardSrc = /<img[^>]*\bsrc="([^"]+)"/.exec(card[0]);
  assert.ok(cardSrc, "the sister card draws no image");
  assert.equal(cardSrc[1], `assets/logo-${theirs}.png`,
    "the card that links to the other elevator is not showing the other elevator's mark");

  /* And the name beside it is the alt text on it, so a reader who never sees
     the artwork load is told the same thing either way. */
  const alt = /<img[^>]*\balt="([^"]+)"/.exec(card[0]);
  assert.ok(alt && alt[1].trim(), "the sister mark has no alt text, so a page without the " +
    "artwork shows an empty box where the other elevator's name should be");
  assert.ok(card[0].includes(`<strong>${alt[1]}</strong>`),
    `the sister mark's alt text is ${JSON.stringify(alt[1])} and the card names a different company`);
});
