#!/usr/bin/env node
/* Fail the build if the Wisconsin statutory notices have drifted.

   The two sites carry the same ATCP 99.14(2)(a) and 99.26(2)(a) text,
   differing only in the company named. They live in separate
   repositories, which means somebody can update one and not the other,
   and the site that missed it publishes a stale compliance notice.

   This hashes the notice text with the company name removed and
   compares it to the known-good value. If it does not match, either
   this repository drifted or the canonical text changed on purpose. If
   on purpose, update BOTH sites and then update EXPECTED here and there.

   Do not "fix" a failure by changing EXPECTED alone. That defeats the
   entire point of the check.
*/
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const EXPECTED = "7ad1c261839ecbd0";

const html = readFileSync("index.html", "utf8");
const boxes = [...html.matchAll(/<div class="statute-box">([\s\S]*?)<\/div>/g)].map(m => m[1]);
if (boxes.length !== 2) {
  console.error(`expected 2 statutory notices, found ${boxes.length}`);
  process.exit(1);
}
const canon = boxes.join("")
  .replace(/(Badger Grain Supply, LLC|Midwest Commodity Service, Inc\.)/g, "ENTITY")
  .replace(/\s+/g, " ").trim();
const got = createHash("sha256").update(canon).digest("hex").slice(0, 16);

if (got !== EXPECTED) {
  console.error("STATUTORY NOTICE TEXT HAS CHANGED.");
  console.error(`  expected ${EXPECTED}`);
  console.error(`  found    ${got}`);
  console.error("If this was deliberate, make the same change on the other site,");
  console.error("then update EXPECTED in tools/check-notices.mjs in BOTH repositories.");
  process.exit(1);
}
console.log("statutory notices unchanged");
