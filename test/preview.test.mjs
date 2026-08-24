/* The link preview and the 404, which are the two pages of this site most
   people see before they see the site.

   Both were missing. A shared link rendered as a bare URL or an empty grey
   card, and a mistyped address landed on GitHub's own 404, which names GitHub
   and not this elevator. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { facts, card, faces, brandOf } from "../tools/make-og.mjs";

const html = readFileSync("index.html", "utf8");
const host = readFileSync("CNAME", "utf8").trim();

test("the page offers a link preview image at all", () => {
  assert.match(html, /property="og:image"/, "no og:image — a shared link has no picture");
  assert.match(html, /name="twitter:image"/, "no twitter:image");
});

test("the preview points at this site's own file, on this site's own host", () => {
  const m = /property="og:image" content="([^"]+)"/.exec(html);
  assert.ok(m, "og:image has no content");
  assert.equal(m[1], `https://${host}/og.png`,
    "the preview must be absolute and on this host — a relative og:image is ignored by every scraper");
});

test("the image the preview promises actually exists, and is the size it claims", () => {
  assert.ok(existsSync("og.png"), "og:image is declared and og.png is not in the repository");
  const png = readFileSync("og.png");
  /* PNG header: width and height are big-endian 32-bit at bytes 16 and 20. */
  assert.equal(png.readUInt32BE(16), 1200, "og.png is not 1200 wide");
  assert.equal(png.readUInt32BE(20), 630, "og.png is not 630 tall");
  const declaredW = /property="og:image:width" content="(\d+)"/.exec(html);
  const declaredH = /property="og:image:height" content="(\d+)"/.exec(html);
  assert.equal(Number(declaredW[1]), 1200);
  assert.equal(Number(declaredH[1]), 630);
  assert.ok(statSync("og.png").size < 300 * 1024, "og.png is too heavy for a link preview");
});

test("EVERY WORD ON THE CARD IS READ OFF THIS PAGE, not typed twice", () => {
  const f = facts(html);
  /* card() refuses without the site's own brand colour, on purpose: a
     default would be one elevator's red waiting to be stamped on the
     other's card. Read it the same way the generator does. */
  const c = card(f, faces(readFileSync), brandOf(readFileSync("site.css", "utf8")));
  for (const [what, value] of Object.entries(f)) {
    assert.ok(html.includes(value),
      `the card prints ${what} = ${JSON.stringify(value)}, which is not on the page it claims to describe`);
    assert.ok(c.includes(value.replace(/&/g, "&amp;")),
      `${what} was read but never reached the card`);
  }
});

test("the generator refuses rather than inventing when the markup is missing", async () => {
  assert.throws(() => facts("<html><body>nothing</body></html>"),
    /could not read the business name/,
    "with no markup to read the generator must refuse, not fall back to a hard-coded name");
});

test("a mistyped address lands on this elevator's own page, not GitHub's", () => {
  assert.ok(existsSync("404.html"), "no 404.html — GitHub serves its own, which names GitHub");
  const four = readFileSync("404.html", "utf8");
  const name = /itemprop="name"[^>]*content="([^"]+)"/.exec(html)[1];
  assert.ok(four.includes(name), "the 404 does not say whose site it is");
  assert.match(four, /href="\/"/, "the 404 offers no way back to the prices");
  assert.match(four, /tel:\+1\d{10}/, "the 404 offers no phone number");
  assert.match(four, /name="robots" content="noindex"/, "a 404 must not be indexable");
});

/* THE LICENCE ON THE CARD IS THIS COMPANY'S LICENCE.
 *
 * The two elevators hold different licences: 302165 GL is Badger Grain
 * Supply's, 252525 GL is Midwest Commodity Service's. An internal note once
 * recorded the second as a superseded version of the first rather than as the
 * other company's number -- the same mistake, exactly, as the brand colour a
 * few days earlier: two entities, two values, one filed as a stale copy of
 * the other.
 *
 * A rubber stamp reading "LICENSED WISCONSIN GRAIN DEALER" over the wrong
 * number is a specific and serious thing to publish, so it is guarded by
 * RENDERING the card and reading what came out, not by grepping the source.
 */
test("the preview card carries this elevator's own licence, read off the page", async () => {
  const html = readFileSync("index.html", "utf8");
  const f = facts(html);
  const mine = (/Grain dealer license<\/span><span class="v num">([^<]+)</.exec(html) || [])[1];
  assert.ok(mine, "the page does not state a grain dealer licence number");
  assert.equal(f.licence, mine, "the card's licence is not the one printed on the page");

  const brand = brandOf(readFileSync("site.css", "utf8"));
  const markup = card(f, "", brand);
  assert.ok(markup.includes(mine), `the rendered card does not carry ${mine}`);

  /* and never the other elevator's */
  const OTHERS = ["302165 GL", "302162 GW", "252525 GL", "286621 GW"].filter((n) => n !== mine);
  for (const n of OTHERS)
    assert.ok(!markup.includes(n),
      `the card carries ${n}, which belongs to the other elevator`);
});
