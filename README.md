# Midwest Commodity Service — complete files

Four files. Each one is complete. Upload each over the top of the one
that is there. Nothing to paste into the middle of anything, nothing to
find and change by hand.

```
site.css                 replaces site.css
index.html               replaces index.html
tools/update-today.mjs   replaces tools/update-today.mjs
test/hours.test.mjs      replaces test/hours.test.mjs
```

## site.css

This is your existing stylesheet with the phone fixes already in it. All
189 of your original lines are unchanged and in the same order, including
the @font-face block pointing at `fonts/inter-*.woff2` and
`fonts/dejavusanscondensed-bold.woff2`. The new rules are appended after
them, each with the reason written above it.

**This is the file that puts the futures price back on your phone.** I
checked both live stylesheets before building it — neither had anything
appended, which is why you were still seeing two columns. It was never a
cache.

What it changes:

- **Futures and the contract month show on phones**, at every width. All
  four columns fit at 320, 360, 375, 390 and 430, measured with corn at
  $4.17 and again at $8.99. The We pay figure gives up under a pixel —
  23.8px at 320 against 24.7px before.
- **Closed stops looking like open.** The hours box goes quiet grey
  instead of the same yellow as the Call the office button.
- The footer address breaks between the street and the town instead of
  inside either one.
- "Monday to Friday" stops wrapping onto two lines at 320.
- The other elevator's name in "Our other location" was rendering at
  10.6px. Floored at 12.9px.
- The footer phone was a 21px tap target. Now about 41.
- The notes under the prices and hours were set at body size; they are
  fine print now.
- Landscape on a notched iPhone no longer clips the start of each line.

It also puts back a rule that this change would otherwise have switched
on by accident: there is a line in your stylesheet saying the second
table cell may break anywhere it likes. That cell was hidden, so it did
nothing. Showing the futures column makes it live, and what it permits
is $4.17 on one line and 25 on the next — which is not a blemish, it is
a different number.

## tools/update-today.mjs

Same file you have, plus two things: it puts the `is-shut` class on the
hours box in all four closed states, which is what the grey in the CSS
attaches to, and it clears a one-day closure once the day is over.
19 tests, all passing.

## test/hours.test.mjs

The tests for the above. Upload it with the tool, not separately.

## index.html

Your file, with **two changes and nothing else**. I checked that
mechanically: strip the added spans back out and the result is byte for
byte the file you sent me.

1. The footer address. `1881 140th Avenue` and `Baldwin, WI 54002` are
   each wrapped so they cannot break in the middle. At 320 it now reads

   ```
   Midwest Commodity Service, Inc.
   1881 140th Avenue,
   Baldwin, WI 54002.
   (715) 704-0548.
   ```

   and from 375 up the address sits on one line.

2. The Call button. The number is wrapped so it cannot split after the
   area code. It now breaks as "Call (715) 704-0548 to" / "lock a price".

**Nothing else was touched.** Not the licence numbers, not the two
statutory notices, not the drying tables, not the `openingHours` meta,
not the built stamp, and not the word "bushel" — that one is still
yours to decide and I am not choosing it for you.

---

## What I measured on the finished page

The real page, with the real stylesheet, in Chromium at 320, 375, 390
and 430 with an iPhone user agent:

- All four columns show at every width. The table never has to scroll.
- Nothing overflows the viewport at any width.
- No tap target under 44px anywhere on the page.
- Every text-on-background pair passes WCAG AA. No failures.
- The hours box renders grey when shut.

One thing I did not change, because it is wording rather than layout:
**"October and November delivery" wraps onto four lines at 320**, which
makes that row twice the height of the one above it. I tried to fix it
with column widths and it cannot be done — the words are simply longer
than an 88px column. "October and November" or "Oct and Nov" would fix
it, but that is customer-facing text on your site and your call, so it
is exactly as you sent it.
