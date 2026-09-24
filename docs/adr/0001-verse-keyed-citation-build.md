# Verse-keyed citation build

The citation build walks the BYU DB's `citation_verse` table, so every shipped
cite is keyed to explicit verse numbers — that is what makes anchor verses,
per-verse chips, and the by-verse layout possible at all. The alternative
(keying by chapter or by the citation's free-text reference) would have
required parsing reference strings ourselves. Consequence: the ~0.22% of cites
with no `citation_verse` rows (almost all deliberately-skipped front matter —
title pages, intros, witnesses, facsimiles — plus ~65 section-wide refs) are
not shown, and that loss is accepted.
Where a `citation_verse` row and the cite's own `v` field disagree (1,366
cites, nearly all 2024 and 2026 talks), the display trusts `v` and clips the
row away, falling back to the index only when the two share no verse; the
build should skip those rows (`validate-citations` warns until it does).
