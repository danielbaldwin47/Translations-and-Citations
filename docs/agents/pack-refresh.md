# Pack refresh: one new General Conference into both data packs

A **pack refresh** takes one newly published conference into the public and
personal packs and ships it as a patch release. Vocabulary: `GLOSSARY.md`
("Pack refresh", "Derivation run", "Derived cite", "Pack vintage"); decision:
ADR-0008. Run it with the owner, in one session, a week or two after the
Church publishes the conference's text (by then the talk pages have stopped
being revised). One conference per refresh; for two missed conferences, run
the whole checklist once per conference, oldest first.

`YYYY-MM` below is the conference: `2026-10` for October 2026. Run every
command from the repo root.

## Steps

1. **Pull the private repo** (BYU databases, earlier derivation inputs, the
   personal pack) so `source-data/` holds `core.53.db`, `content.53.db` and
   `derived/gc-*.json`, and `src/citations/data-personal/` holds the personal
   pack. In a worktree, link the directory:
   `ln -s <main checkout>/source-data source-data`.
   Done when `ls source-data/derived` lists every earlier derived conference
   (compare with `derived` in `src/citations/data/index.json`).

2. **Derivation run** for the conference:

   ```
   node --experimental-sqlite tools/derive-conference.js YYYY-MM
   ```

   It fetches the conference page and each talk one at a time, five seconds
   apart (about four minutes). If the owner prefers the saved-pages
   fallback, or the endpoint refuses, the owner saves every talk page of the
   conference from a browser into one folder and you run
   `... derive-conference.js YYYY-MM --from-dir <folder>` instead.
   Done when it prints `Wrote source-data/derived/gc-YYYY-MM.json: N talks,
   M derived cites`, where N is the count the run printed first ("38 talks
   listed") less the lines marked "not a talk page, skipped" (the sustaining
   of officers and other business pages), and M is in the hundreds. October
   2026: 38 listed, 1 skipped, 37 talks, 585 cites.

3. **Build both packs**, the public one writing its diff report:

   ```
   node --experimental-sqlite tools/build-citation-data.js --report /tmp/pack-diff.md
   node --experimental-sqlite tools/build-citation-data.js --pack personal
   ```

   Done when each build ends with the diff report showing the conference
   under "Derived conferences", the vintage moved to `YYYY-MM`, G's talks
   and cites grown by the run's N and M with nothing removed, and G's
   "Footnote cites after" at least its "before" (the footnote flag `fn`).

4. **Validators**: every `node tools/validate-*.js` and
   `node --test tools/test-talk-source.js`. Done when all pass;
   `validate-citations.js` checks both packs, including that derived cites
   exist only for conferences newer than the base, that both packs share
   the vintage, and that the footnote flag `fn` is only ever `true` and only
   on a corpus whose descriptor entry has `footnoteFlag` (with 1 Nephi 3:7's
   footnote cites 139829 and 144963 flagged).

5. **Browser check of one new talk.** Pick a chapter a derived talk cites:

   ```
   node -e "const t=require('./source-data/derived/gc-YYYY-MM.json').talks.find(t=>t.cites.length); console.log(t.id, t.cites[0])"
   ```

   Load the repo unpacked in Chrome, open that book and chapter on
   churchofjesuschrist.org/study, switch the panel to Citations, open the
   cited verse's General Conference group and click the talk's row. Done
   when the talk opens inline scrolled to its anchor paragraph (`a` in the
   printed cite), the row shows an excerpt, and the Citations footer reads
   "Citations through {Month YYYY}" for the new vintage.

6. **Commit and open the PR.** Commit `src/citations/data/` on a branch
   named `pack/YYYY-MM` with message `data: pack refresh YYYY-MM`, and open
   a PR whose body is `/tmp/pack-diff.md` (`gh pr create --body-file
   /tmp/pack-diff.md`). The owner reviews the report and merges.

7. **Patch release.** After the merge, on `main`: raise the patch number of
   `version` in `manifest.json`, commit, then
   `node tools/build-store-zip.js && node tools/validate-store-zip.js`.
   Done when the zip validator passes; hand
   `dist/translations-and-citations-{version}.zip` to the owner, who uploads
   it in the Chrome Web Store dashboard (submit about three weeks before it
   should publish).

8. **Push the personal pack and the derivation input** to the private repo
   (`src/citations/data-personal/` and `source-data/derived/gc-YYYY-MM.json`).
   Done when the private repo's log shows the commit and its vintage matches
   the public pack's.

## When a step fails

- **The build stops with "the BYU base … covers it"**: the conference is
  already in the BYU base and needs no derivation; delete its
  `source-data/derived/gc-YYYY-MM.json` and rebuild.
- **The run stops on an HTTP error**: nothing is written; rerun the same
  command later, or switch to `--from-dir`. A rerun replaces the
  conference's input whole.
- **A talk is missing from the run** (N short of the list): its page was not
  a talk page (a session or a report) or, in `--from-dir` mode, was not
  saved; save it and rerun.
