# One codebase, two data packs: the public release ships through the Chrome Web Store

Status: accepted October 6, 2026. Supersedes
[ADR-0003](0003-ship-generated-citation-data.md). Spec: issue #69.

The extension is released free on the Chrome Web Store as the **public
release**, and the same code loaded unpacked is the **personal build**. The two
**flavors** differ in exactly one thing, the **data pack**: the public pack is
committed under `src/citations/data/` and is what the Store zip contains; the
personal pack is a full standalone pack in a gitignored sibling directory, held
with the BYU databases in a private repo. Code, manifest and Store listing never
branch on a flavor; the reader learns which corpora exist, which are bundled,
which are references-only and where each is fetched from by reading the pack's
**descriptor** in its index file. A corpus the descriptor lacks does not exist
in the panel.

Kept from ADR-0003: generated citation data is committed and shipped, because
there is no public Scripture Citation Index API, a content script must work
from static files with no server of our own, and the Journal of Discourses
must read offline. Retired from ADR-0003: "personal use only, never the Chrome
Web Store". The rights record for every shipped element is the go/no-go
decision of October 6, 2026
(https://github.com/danielbaldwin47/Translations-and-Citations/issues/61#issuecomment-6025766880),
which rests on two readings: the **comprehensive factual index** (BYU's early
conference and Journal of Discourses cite sets ship whole, as factual
identifications in an exhaustive index, with no BYU snippet or prose on a
copyrighted corpus) and the **user-triggered fetch** (Church and BYU talk text
is fetched in the reader's browser by the reader's action on the chapter they
are reading, bounded and never stored past the session, never bundled). The
conditions in that record are acceptance checks of the spec; a change that
breaks one reopens the decision, not the spec.

Alternatives rejected: two extensions or a build flag (the owner wants one
codebase, the personal build "99% the same" and a reserve, not a daily driver);
a developer-run backend for licensed translations (the operator cap is about
$5/month); permission requests to BYU, the Church or the TPJS rights holders
before version 1 (the bar is a reasonable-basis reading, permission the last
resort).

Consequences:

- The only **gated element** is Galbraith's TPJS cite set and text
  (copyright TX0003720598): personal pack only. The public pack ships no `T`
  corpus. The personal-pack probe in the reader exists because a gated element
  exists; if that ever ceases, the probe is removed.
- Each corpus carries an **inclusion rule**, `all` (version 1) or `verbatim`
  (only cites re-derived by quotation matching against public-domain
  scripture, BYU's data not an input). If BYU objects to the factual-index
  reading, the answer is a one-line build-input change and a rebuild, with
  coverage falling to about 58-70% of early conference and 15-33% of Journal
  of Discourses; no reader code changes.
- The BYU database the public pack is first built from is a **frozen base**;
  every later conference is indexed from the Church's own talk pages as
  **derived cites**, so the pack's dependence on BYU shrinks with each
  conference. Talk ids never change across refreshes, because highlights key
  on them.
- Validators are pack-aware and the Store zip is the committed tree alone, so
  a gated element cannot leak. The BYU databases stay in this repo's LFS
  history; rewriting it is out of scope.

Amended October 9, 2026 (issue #90): the Store zip is the committed tree plus
one file, the **Store stamp**, which tells the pack probe to ask the public
directory alone, so the Store build requests no directory it lacks. The stamp
carries no data and is not a flavor: the descriptor still decides every
corpus, and a repo load still reads whichever pack it finds. The stamp exists
only for the personal-pack probe and is removed with it.
