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

Body text is Inter, loaded from Google Fonts with a system font fallback. If
you would rather not depend on Google, download Inter (SIL Open Font Licence)
and self host it exactly the way this folder does.
