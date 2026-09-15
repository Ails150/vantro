# PDF fonts

`NotoSans-Regular.ttf` and `NotoSans-Bold.ttf`, from the Noto project
(https://github.com/notofonts/notofonts.github.io), covering Latin, Greek and
Cyrillic.

Licensed under the SIL Open Font License 1.1, which permits embedding in
documents including commercial ones. The full licence text ships inside the font
files themselves and is readable from their name tables.

## Why they are here and not in `public/`

They are only ever read by the server, in `lib/pdf-fonts.ts`, to embed into
generated PDFs. Serving 1.2MB of fonts to browsers that will never ask for them
would be waste.

Nothing imports these files, so Next's build-time file tracing cannot discover
them. `next.config.ts` carries an `outputFileTracingIncludes` entry that ships
them with the API functions. **If that entry is removed, PDF generation keeps
working locally and silently falls back to transliterated names on Vercel** —
which is the worst shape a bug can take. `tests/unit/pdf-fonts.spec.ts` asserts
that the fonts actually load, so that failure is caught in CI instead.

## Replacing or adding a face

Any TrueType or OpenType file works. Keep the filenames, or update the two
constants in `lib/pdf-fonts.ts`. Subsetting is on, so only the glyphs a document
actually uses are embedded — a larger face costs build size, not document size.
