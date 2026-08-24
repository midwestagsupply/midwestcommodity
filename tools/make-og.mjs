/* make-og.mjs — the picture that appears when somebody texts this site.
 *
 * WHY IT EXISTS. Neither site had og:image or twitter:image. A farmer sending
 * badgergrain.com to another farmer, or posting it in a Facebook group, got a
 * bare blue link or an empty grey card. Every other signal on these pages says
 * "a real business built this properly"; the link preview said nothing at all,
 * and the link preview is what most people see FIRST.
 *
 * WHY IT IS A GENERATOR AND NOT A PNG SOMEBODY MADE ONCE. Every word on the
 * card is read out of the page's own markup -- the name from itemprop="name",
 * the town from addressLocality, the phone from telephone. Nothing here is
 * typed twice, so the card cannot come to disagree with the site the way a
 * hand-made image would the first time a phone number changes. Re-run it and
 * the card is right again.
 *
 * Usage: node tools/make-og.mjs        (writes og.png beside index.html)
 */
import { readFileSync, writeFileSync } from "node:fs";

const pick = (html, re, what) => {
  const m = re.exec(html);
  if (!m) throw new Error(`make-og: could not read ${what} out of index.html. ` +
    `The card is built from the page's own markup on purpose -- fix the markup, ` +
    `do not hard-code it here.`);
  return m[1].trim();
};

export function brandOf(css) {
  /* READ, NOT TYPED. The first version hardcoded #b8332a -- Badger's red --
     into a generator that runs for BOTH elevators, so Midwest Commodity's card
     came out stamped in another company's colour. Caught only because Sig
     asked "sure?". The name, town and phone were all read from the site; the
     colour was the one thing I typed, and it was the one thing that was
     wrong. */
  const m = /--brand:\s*(#[0-9a-fA-F]{3,8})/.exec(css);
  if (!m) throw new Error("make-og: site.css declares no --brand colour to stamp with");
  return m[1];
}

export function facts(html) {
  return {
    name:  pick(html, /itemprop="name"[^>]*content="([^"]+)"/, "the business name"),
    town:  pick(html, /itemprop="addressLocality"[^>]*>([^<]+)/, "the town"),
    region:pick(html, /itemprop="addressRegion"[^>]*>([^<]+)/, "the state"),
    phone: pick(html, /itemprop="telephone"[^>]*>([^<]+)/, "the telephone number"),
    /* Two lines, exactly as the masthead sets them. */
    /* The host is the site's own CNAME -- the address on the ticket has to be
       the address that serves it. */
    host:  pick(html, /rel="canonical"[^>]*href="https:\/\/([^/"]+)/, "the site's own address"),
    /* READ, NOT TYPED -- and this one especially. The two elevators hold
       DIFFERENT licences: 302165 GL is Badger's, 252525 GL is Midwest's, and
       an internal note once recorded the second as a stale version of the
       first rather than as the other company's. Putting either number on a
       card by hand is how one elevator ends up publishing the other's licence
       under a rubber stamp that says "licensed". It comes off the page. */
    licence: pick(html, /Grain dealer license<\/span><span class="v num">([^<]+)</, "the grain dealer licence number"),
  };
}

/* The card is rendered headless, off the filesystem, with no stylesheet and no
   network. A font named but not embedded silently falls back to whatever the
   machine has -- which is how a card comes out in a face the site never uses
   and nobody notices until it is on Facebook. Embedded as data URIs, the only
   two faces this business owns. */
export function faces(readFile) {
  const at = (file, family, weight) => {
    const b64 = readFile(`fonts/${file}`).toString("base64");
    return `@font-face{font-family:"${family}";font-weight:${weight};font-style:normal;` +
           `src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
  };
  return [
    at("inter-500.woff2", "Inter", 500),
    at("inter-600.woff2", "Inter", 600),
    at("inter-700.woff2", "Inter", 700),
    at("inter-800.woff2", "Inter", 800),
    at("dejavusanscondensed-bold.woff2", "Wordmark", 700),
  ].join("");
}

/* NO DEFAULT COLOUR. A default of "#b8332a" is Badger's red waiting to be
   stamped on somebody else's card by the next caller who forgets the argument
   -- which is exactly the bug this parameter was added to fix. Refuse. */
export function card(f, embedded = "", brand) {
  if (!brand) throw new Error("make-og: card() needs the site's own --brand colour; " +
    "read it with brandOf(site.css) rather than passing a literal");
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  /* A SCALE TICKET, not a brand card.
   *
   * The first version of this was a big serif wordmark on a red block with a
   * thin accent rule and a two-item footer -- the layout every generator
   * produces, and Sig spotted it as such immediately. It described the
   * business the way a slide would.
   *
   * A grain elevator already has a piece of design its customers know by
   * touch: the ticket the scale house hands them. Manila stock, ruled fields,
   * a typewriter face, a rubber stamp. Every farmer receiving this link has a
   * drawer full of them. It is specific to this trade, it cannot be mistaken
   * for a template, and it says "these people run an elevator" before a word
   * is read.
   *
   * WHAT IT DOES NOT CARRY IS A PRICE. Facebook and iMessage cache an
   * og:image for days, so a number here would be a stale bid in front of a
   * farmer -- the one thing this whole project refuses to do. A ticket with
   * the amount left blank is honest, and it is also what a blank ticket
   * actually looks like.
   */
  const line = (label, value, wide) =>
    `<div class="f${wide ? " w" : ""}"><span class="l">${esc(label)}</span>` +
    `<span class="v">${esc(value)}</span></div>`;
  return `<!doctype html><meta charset="utf-8"><style>${embedded}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1200px;height:630px}
  body{background:#c9c2ad;font-family:"Inter",system-ui,sans-serif;color:#2b2721;
       display:flex;align-items:center;justify-content:center}
  .ticket{width:1064px;height:436px;background:#f4efe0;position:relative;
          box-shadow:0 10px 0 rgba(0,0,0,.10);padding:34px 44px 0;display:flex;flex-direction:column}
  /* the tear-off edge, on the left, where a ticket is torn from the book */
  .perf{position:absolute;left:16px;top:22px;bottom:22px;width:2px;
        background:repeating-linear-gradient(#b9b099 0 9px,transparent 9px 18px)}
  .hd{display:flex;justify-content:space-between;align-items:flex-start;
      border-bottom:3px double #2b2721;padding-bottom:14px}
  /* The masthead face, at the masthead's own settings. The company name on
     the card and the company name on the site are now the same object. */
  .co{font-family:"Wordmark","Inter",sans-serif;font-size:40px;font-weight:700;letter-spacing:.005em}
  .ad{font-size:16px;letter-spacing:.01em;margin-top:8px;color:#5b5648;font-weight:500}
  .no{text-align:right;font-size:12px;font-weight:700;letter-spacing:.18em;line-height:1.9;color:#6d6759}
  .fields{margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:0 40px}
  .f{display:flex;align-items:baseline;gap:12px;border-bottom:1px solid #a49b85;
     padding:13px 2px 7px}
  .f.w{grid-column:1 / -1}
  .l{font-size:11px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#8a8371;white-space:nowrap}
  .v{flex:1;font-size:21px;font-weight:600;letter-spacing:-.005em;font-variant-numeric:tabular-nums}
  .stamp{position:absolute;right:52px;bottom:34px;transform:rotate(-8deg);
         border:4px solid ${brand};color:${brand};padding:11px 18px;text-align:center;
         font-size:13px;font-weight:700;letter-spacing:.13em;line-height:1.5;opacity:.9;border-radius:3px}
  .stamp b{display:block;font-size:19px;font-weight:800;letter-spacing:.07em}
  .stamp i{display:block;font-style:normal;font-size:15px;font-weight:700;letter-spacing:.1em;
           margin-top:5px;padding-top:5px;border-top:2px solid ${brand};font-variant-numeric:tabular-nums}
  .blanks{margin-top:24px;display:grid;grid-template-columns:repeat(5,1fr);gap:0 26px}
  .b{display:flex;flex-direction:column;gap:9px}
  .b span{font-size:11px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#a09884}
  .b i{display:block;height:1px;background:#a49b85}
  .foot{margin-top:auto;padding:16px 0 20px;font-size:12px;font-weight:700;letter-spacing:.14em;
        text-transform:uppercase;color:#6d6759;border-top:1px solid #b9b099}
</style>
<div class="ticket">
  <div class="perf"></div>
  <div class="hd">
    <div>
      <div class="co">${esc(f.name)}</div>
      <div class="ad">${esc(f.town)}, ${esc(f.region)}</div>
    </div>
    <div class="no">CASH GRAIN<br>TICKET</div>
  </div>
  <div class="fields">
    ${line("Commodity", "Corn")}
    ${line("Delivered to", `${f.town}, ${f.region}`)}
    ${line("Scale house", f.phone)}
    ${line("Price / hours", "posted daily")}
  </div>
  <!-- THE FIELDS OF THE TRADE, LEFT BLANK, WHICH IS WHAT A BLANK TICKET IS.
       They fill the space the way the real document does, they say "grain
       elevator" to anyone who has ever hauled a load, and they invent nothing:
       an empty field is an empty field. Putting figures here would be a
       number in front of a farmer that no scale ever weighed. -->
  <div class="blanks">
    <div class="b"><span>Gross</span><i></i></div>
    <div class="b"><span>Tare</span><i></i></div>
    <div class="b"><span>Net</span><i></i></div>
    <div class="b"><span>Moisture</span><i></i></div>
    <div class="b"><span>Test wt</span><i></i></div>
  </div>
  <div class="stamp">LICENSED<b>WISCONSIN</b>GRAIN DEALER<i>${esc(f.licence)}</i></div>
  <div class="foot">${esc(f.host)}</div>
</div>`;
}

export async function main() {
  const html = readFileSync("index.html", "utf8");
  const f = facts(html);
  const embedded = faces(readFileSync);
  const brand = brandOf(readFileSync("site.css", "utf8"));
  /* CI has playwright on the path. A sandbox may only have it by file path,
     so honour PLAYWRIGHT_IMPORT and fall back, rather than failing on a
     machine where the browser is present but not resolvable by name. */
  let chromium = null;
  try { ({ chromium } = await import("playwright")); } catch { /* try the path */ }
  if (!chromium && process.env.PLAYWRIGHT_IMPORT)
    ({ chromium } = await import(process.env.PLAYWRIGHT_IMPORT));
  if (!chromium) throw new Error("make-og needs playwright to render the card");
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await p.setContent(card(f, embedded, brand), { waitUntil: "load" });
  const png = await p.screenshot({ type: "png" });
  await b.close();
  writeFileSync("og.png", png);
  console.log(`og.png written for ${f.name} — ${(png.length / 1024).toFixed(1)} KB`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
