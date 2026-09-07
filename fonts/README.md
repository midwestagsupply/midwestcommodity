# Fonts

## dejavusanscondensed-bold.woff2 / .woff

This is the typeface in both logos: a condensed sans, set all caps. It is
DejaVu Sans Condensed Bold, subset to the Latin characters the site actually
uses, which is why the file is 11 KB instead of 700 KB.

Licence: Bitstream Vera, in LICENSE-DejaVu.txt in this folder. It permits
redistribution and web serving outright, with no attribution requirement on
the page and no fee.

Read this before changing it. The stack in site.css names "Wordmark" first,
which is this file. Oswald, Archivo Narrow and Arial Narrow are all condensed
sans faces too, and all three draw the letters differently. Substituting one
would silently change the approved mark. That is why the face is bundled here
rather than requested from Google, and why it is first in the stack rather
than a fallback.

Weight: this is the Bold, declared at font-weight 700. There is only one file
in the family. Do not ask the browser for another weight from it, because it
will fake one and the mark will look smeared.

## Body text

Body text is Inter, self hosted from this folder at weights 500, 600, 700 and
800 (SIL Open Font Licence). Nothing on either page loads a typeface, a script
or a stylesheet from anybody else's server; a visitor behind a filter that
blocks Google gets the same page as everybody else.

This paragraph used to say the opposite -- that Inter came from Google Fonts
and could be self hosted "if you would rather not depend on Google". It was
already self hosted when that was written. The guard in test/typefaces.test.mjs
greps index.html, 404.html and site.css for fonts.googleapis, so it never saw
this file, and a maintainer acting on the old sentence would have added the
dependency the site had deliberately gone without.
