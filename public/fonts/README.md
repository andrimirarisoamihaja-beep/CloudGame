# Fonts

The game ships with **no font files** on purpose: the title uses the serif stack
already on the player's machine (Georgia, Cambria, Times) and the UI uses the
system sans-serif. Nothing to download, nothing to flash, nothing to license.

If you want a specific typeface, drop the `.woff2` files here and declare them
with `@font-face` in `app/globals.css` (see the `@theme` block for the two font
families). Nothing else needs to change.
