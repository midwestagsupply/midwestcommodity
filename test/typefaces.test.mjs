/* THIS BUSINESS OWNS TWO TYPEFACES AND USES NO OTHERS.
 *
 * Inter for everything, and DejaVu Sans Condensed Bold -- declared as
 * "Wordmark" -- for the lockup alone. Both are plain, neutral and self-hosted.
 * There is no script, slab, display or typewriter face anywhere, and Sig has
 * asked that it stay that way.
 *
 * This is a guard rather than a comment because typefaces creep in one at a
 * time and always for a good local reason. The og:image generator is exactly
 * how it happens: it rendered headless, off the filesystem, with no stylesheet
 * -- so it named Georgia and Courier and looked fine to whoever wrote it,
 * while shipping a card in two faces this business does not own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const OWNED = new Set(["inter", "wordmark"]);
/* Generic families are not typefaces; they are the fallback chain. */
const GENERIC = new Set([
  "sans-serif", "serif", "monospace", "system-ui", "ui-sans-serif", "ui-monospace",
  "ui-serif", "cursive", "fantasy", "inherit", "initial", "unset", "-apple-system",
  "blinkmacsystemfont", "segoe ui", "roboto", "helvetica neue", "arial",
]);

const families = (css) => {
  const out = new Set();
  for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    for (let name of m[1].split(",")) {
      name = name.trim().replace(/^["']|["']$/g, "").toLowerCase();
      if (!name || name.startsWith("var(")) continue;
      out.add(name);
    }
  }
  return out;
};

const files = ["site.css", "index.html", "404.html"];

for (const f of files) {
  test(`${f} names no typeface this business does not own`, () => {
    const text = readFileSync(f, "utf8");
    const strangers = [...families(text)].filter((n) => !OWNED.has(n) && !GENERIC.has(n));
    assert.deepEqual(strangers, [],
      `${f} asks for ${JSON.stringify(strangers)}. This site uses Inter and Wordmark. ` +
      `A face named here but not shipped in fonts/ renders as whatever the reader's ` +
      `machine happens to have, which is how a page comes out in a typeface nobody chose.`);
  });
}

/* THE GENERATOR IS CHECKED BY RUNNING IT, NOT BY READING IT.
   Grepping its source matched `font-family:"${family}"` and reported the
   business as owning a typeface called "${family}" -- a test reading code
   instead of running it, which is the one shape of test this project has
   already been bitten by. Render the card and look at the CSS it really
   emits. */
test("the og card is set in this business's own faces, checked by rendering it", async () => {
  const { card, faces, facts } = await import("../tools/make-og.mjs");
  const html = readFileSync("index.html", "utf8");
  const emitted = card(facts(html), faces(readFileSync),
                       (await import("../tools/make-og.mjs")).brandOf(readFileSync("site.css", "utf8")));
  const strangers = [...families(emitted)].filter((n) => !OWNED.has(n) && !GENERIC.has(n));
  assert.deepEqual(strangers, [],
    `the link-preview card renders in ${JSON.stringify(strangers)} — faces this site does not use. ` +
    `A card in a typeface the site never shows is the first thing a stranger sees of it.`);
  /* Named is not enough: a face named but not embedded falls back silently in
     a headless render, and nobody sees the result until it is on Facebook. */
  for (const family of OWNED)
    assert.match(emitted, new RegExp(`@font-face\\{font-family:"${family}"`, "i"),
      `${family} is used on the card but never embedded — the render will substitute`);
});

test("every face the CSS declares is actually shipped, in woff2 and woff", () => {
  const css = readFileSync("site.css", "utf8");
  const have = new Set(readdirSync("fonts"));
  const asked = [...css.matchAll(/url\("fonts\/([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(asked.length, "site.css declares no local font files at all");
  for (const file of asked)
    assert.ok(have.has(file), `site.css asks for fonts/${file} and it is not in the repository`);
  for (const f of asked.filter((x) => x.endsWith(".woff2")))
    assert.ok(have.has(f.replace(/2$/, "")), `${f} ships with no .woff fallback`);
});

test("nothing on these pages loads a font from off this site", () => {
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    assert.doesNotMatch(text, /fonts\.googleapis|fonts\.gstatic|use\.typekit|fonts\.bunny/i,
      `${f} pulls a typeface from someone else's server — a third party in the render path ` +
      `of a page whose whole point is that it keeps working`);
  }
});

/* ── AND THE SAME RULE FOR COLOUR ──────────────────────────────────────────
   This file started as a font guard. It gained these because the font bug and
   the colour bug were the same mistake twice: something read off the site for
   most values, and typed by hand for one.

   These two sites are built from one set of sources and their brands are
   DIFFERENT COLOURS -- Badger red #b8332a, Midwest teal #1c5f52. A literal in
   any shared file is one elevator's colour waiting to be stamped on the
   other's page, which is precisely what shipped: Midwest's link-preview card
   and 404 both came out in Badger's red. */
test("no page or generator hardcodes a brand colour; they read --brand", () => {
  const brand = /--brand:\s*(#[0-9a-fA-F]{3,8})/.exec(readFileSync("site.css", "utf8"));
  assert.ok(brand, "site.css declares no --brand");
  const other = ["#b8332a", "#9e2b23", "#1c5f52", "#17493f"]
    .filter((c) => c.toLowerCase() !== brand[1].toLowerCase());

  for (const f of ["404.html", "index.html", "tools/make-og.mjs"]) {
    const text = readFileSync(f, "utf8");
    const code = text.replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, "");   // comments may name them
    for (const c of other)
      assert.ok(!code.toLowerCase().includes(c),
        `${f} hardcodes ${c}, which is the OTHER elevator's brand colour. ` +
        `These files are shared between two sites: read var(--brand) instead.`);
  }
});

test("the card is stamped in this site's own brand, checked by rendering it", async () => {
  const { card, faces, facts, brandOf } = await import("../tools/make-og.mjs");
  const css = readFileSync("site.css", "utf8");
  const brand = brandOf(css);
  const emitted = card(facts(readFileSync("index.html", "utf8")), faces(readFileSync), brand);
  assert.ok(emitted.includes(brand), `the card does not use this site's brand ${brand}`);
  assert.throws(() => card(facts(readFileSync("index.html", "utf8")), "", undefined),
    /needs the site's own --brand/,
    "card() still has a default colour — one site's red waiting for a forgetful caller");
});
