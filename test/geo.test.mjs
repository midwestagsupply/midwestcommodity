/* The map pin in the page's structured data (2026-10-13). One pin, inside the
   LocalBusiness block, in Wisconsin, and printed only once. The figures are the
   street-precision pins dnilgis/bids geocoded from this same street address. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("the business carries one map pin, inside Wisconsin", () => {
  const all = [...html.matchAll(/itemtype="https:\/\/schema\.org\/GeoCoordinates"><meta itemprop="latitude" content="([-\d.]+)"><meta itemprop="longitude" content="([-\d.]+)">/g)];
  assert.equal(all.length, 1);
  const [lat, lon] = [Number(all[0][1]), Number(all[0][2])];
  assert.ok(lat > 42.4 && lat < 47.1 && lon > -92.9 && lon < -86.8, `${lat},${lon} is not in Wisconsin`);
  const biz = html.indexOf('itemtype="https://schema.org/LocalBusiness"');
  const end = html.indexOf("</section>", biz);
  assert.ok(all[0].index > biz && all[0].index < end, "the pin sits outside the business it belongs to");
});
