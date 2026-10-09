/*
 * The side panel — a deep module that owns everything panel-shaped: its DOM,
 * its state (mode, citation layout, collapsed, width, this visit's mode
 * click and dropdown pick), the arrangement (what its body shows), the persistence of that
 * state through __BTX.settings, scroll-sync, and drag-to-resize. It is also the *view
 * host*: callers ask for a named view and the panel decides whether to
 * rebuild it or re-mount the one it cached, and it is the only writer of the
 * body's scroll position. The orchestrator supplies chapter context and
 * content; it never sequences panel setters, persists panel state, or holds
 * panel DOM.
 *
 * Interface:
 *   init(handlers)                 build the DOM, adopt persisted state, wire
 *                                  controls; must be awaited before use
 *   showChapter({ key, texts, picks, languages, layout, dismissed }) -> arrangement
 *                                  make the panel visible for a chapter and
 *                                  arrange it: `key` names the chapter, the
 *                                  rest are the arrangement's facts (see the
 *                                  pure arrangement). Another chapter starts
 *                                  a new visit (its mode click and dropdown
 *                                  pick go) and
 *                                  invalidates every cached view; the same
 *                                  one again (a settings change) keeps the
 *                                  click, Citations and the talk
 *   arrange({ texts, picks, languages, layout, dismissed }) -> arrangement
 *                                  a fact about the chapter showing moved
 *                                  (the chapter check settled, a pick): the
 *                                  arrangement again, no view dropped
 *   arrangement(facts?)            the current answer: { mode, body, text,
 *                                  saves, note, noteLang, page, pageNext };
 *                                  the orchestrator applies `body` and `note`
 *                                  to the panel and `page` to the page split.
 *                                  With `facts`, the answer they would give
 *                                  this visit, nothing stored (a question
 *                                  asked while the chapter check runs)
 *   setNote({ kind, row, chapter, layout } | null)
 *                                  the note slot: one quiet line at the top of
 *                                  the body, above the mounted view (copy: the
 *                                  pure noteCopy; `row` is the language's
 *                                  churchText row). It shows while the view it
 *                                  belongs to is mounted (the no-translation
 *                                  line: Citations; the beside-the-page and
 *                                  missing-chapter lines: Translation) and
 *                                  goes with any other; a
 *                                  line coming or going keeps the reader's
 *                                  place. Its buttons: Add a language = a
 *                                  Translation click, × = onDismissNote,
 *                                  Change = the layout control in the line's
 *                                  place, pressing `layout` (the same line
 *                                  again re-presses it in place)
 *   hide()
 *   toggleCollapsed(force)         collapse to the edge tab or expand — flip,
 *                                  or `force` true/false like classList.toggle
 *                                  (the toolbar icon); persisted like the
 *                                  header's Collapse button
 *   effectiveMode()                'translation' | 'citations': the
 *                                  arrangement's mode, the one source of
 *                                  truth for the mode showing
 *   citationView()                 'source' | 'verse'
 *   showView({ name, key, cache, render })  mount the named view; see the view
 *                                  host section below. Returns render's result.
 *   keepView(keep)                 the mounted view says whether what it
 *                                  rendered may be re-mounted (false for an
 *                                  error or a spinner)
 *   scrollIntoView(target, { clearTop, frames })  reveal a node inside the
 *                                  mounted view — near the middle of the body,
 *                                  so the text leading into it is visible, and
 *                                  clear of any sticky chrome the caller
 *                                  declares (instant: callers reveal a target
 *                                  as part of opening a view)
 *   showTranslation(state)         render a translation-mode body state into
 *                                  the mounted view (copy: the pure setupCopy,
 *                                  besideCopy, errorCopy):
 *                                    { kind:'loading', label }
 *                                    { kind:'waiting', seconds }  rate-limited;
 *                                      counts down to the orchestrator's retry
 *                                    { kind:'setup', chapter, bible, languages }
 *                                      nothing offers the chapter: add a Church
 *                                      language (`languages` [{ code, label }],
 *                                      a select plus Add), set up api.bible
 *                                      (`bible` 'nokey' | 'noversions' | null),
 *                                      or see the talks
 *                                    { kind:'error', code, name, chapter, church, alternatives, remote, retryAfterMs }
 *                                    { kind:'content', blocks, copyright, lang, dir, besideLink }
 *                                    { kind:'beside', name, layout, effective, collapseFits }  the text
 *                                      is split into the page (__BTX.pageSplit);
 *                                      the card sets where it shows (LAYOUTS)
 *                                      and offers collapsing: to widen
 *                                      columns, or in the narrow window's
 *                                      bottom sheet to hide the panel
 *                                  (`lang` is the text's BCP 47 tag, if it
 *                                  isn't English — CJK glyphs and hyphenation
 *                                  depend on it; `dir` 'rtl' for Arabic, …;
 *                                  `besideLink` puts the same layout control
 *                                  above the text, the way back into the page)
 *   updateBeside({ layout, effective, collapseFits })  restate the layout
 *                                  control in place: the reader picked another
 *                                  in-page layout, or the split fit another.
 *                                  Reaches the mounted beside card and the open
 *                                  Change control of the beside-the-page line.
 *                                  The pressed segment is the layout the page
 *                                  shows (pressedLayout), not the setting: with
 *                                  columns wanted and no room it is Under each
 *                                  verse, the setting stays columns, and a click
 *                                  on Side by side (layoutClick: 'explain')
 *                                  says what would make room (roomHint).
 *   populateTranslations(menu, selectedId)  the dropdown, from
 *                                  __BTX.churchText.menuFor; hidden when empty
 *   controlNodes(name)             the node(s) a CONTROL_NAMES name stands for
 *                                  (the A− / A+ stepper is two): what a welcome
 *                                  callout points at; [] before init
 *   retryWait(error, attempts)     pure: whether a rate-limited load retries by
 *                                  itself (ms to wait) or shows the error card
 *                                  (null)
 *   getRootEl()
 *
 * handlers: { renderMode(mode), onTranslationChange(id), onGear(section),
 *   onRetry, onAddLanguage(code), onLayoutChange(layout, pick), onDismissNote }.
 *   `renderMode` fires whenever the panel invalidated its own body content
 *   (mode toggle, citation-layout toggle, a synced change from another
 *   context); the orchestrator answers by rendering that mode's content.
 *   After showChapter() the orchestrator renders what the arrangement
 *   answered itself — showChapter and arrange never fire events. `onGear(section)` opens the
 *   options page, at a card when `section` names one ('bible' from the setup
 *   card and the key errors; none from the header's Settings button).
 *   `onAddLanguage`, `onLayoutChange` and `onDismissNote` are the cards' and
 *   the note's picks; the panel writes no setting for them, the orchestrator
 *   does. `onLayoutChange`'s `pick` is the row the choice makes the pick, or
 *   null (the pure layoutChoice: "In the panel" moves the page's language
 *   into the panel in the Bible version's place).
 *
 * Body scroll has exactly one owner and one writer. Each view either *owns* its
 * position (Citations, the talk reader: restored on the way back to where it
 * was left) or is *page-synced* (Translation: the page scroll is the source of
 * truth, so it is placed where the page says instead).
 * viewRestoresScroll() is that rule, and it is why scroll-sync and
 * scroll-restore can no longer both write the same body. The `scrollSync`
 * setting is an input to it: with sync off nothing is page-synced, so
 * Translation owns its scroll like everything else — which is why every view
 * records its offset on the way out even when nothing will read it.
 *
 * A text-size change (A− / A+, or the options slider) keeps the reader's
 * place: the passage on screen keeps its distance from the body's top
 * (keptScrollTop), and page-synced Translation is placed against the page
 * again.
 *
 * Every move routes through setBodyScroll, and almost all of them are instant:
 * tracking the page 1:1 is what makes the panel feel like the browser's own
 * scrolling. Exactly one move eases — re-alignment. The user may scroll the
 * panel away from the page (`syncDetached`, detected by isForeignScroll); the
 * panel then leaves it alone until the page scrolls again, and eases it back
 * rather than snapping. Nothing else animates, and the system's reduced-motion
 * preference is deliberately not consulted: the browser scrolls this page
 * smoothly regardless, and the panel matches the browser, not the OS. A reader
 * who wants none of it turns the `scrollSync` setting off: then the page never
 * moves the body at all — no tracking and no re-alignment either.
 *
 * The welcome (GLOSSARY: Welcome) is the panel's too: a labelled dialog laid
 * over the body on any panel shown while the synced `welcomeSeen` flag is
 * false (the pure welcomeDue; collapsing hides it without counting as seen).
 * Its content is the pure callouts table (WELCOME_CALLOUTS: each line's copy
 * and the CONTROL_NAMES control it points at, filtered by welcomeCallouts).
 * Each line with a control showing is a bubble under it, caret aimed at it,
 * and the control is ringed; a line without one (no control, or a control
 * not showing) is a plain line. Placement is the pure calloutPlacement over
 * rects measured inside the layer (separateRings keeps the joined tabs'
 * rings apart), redone on any resize of the panel, its chrome or its
 * controls. Only Got it closes it: it writes the flag true and focuses the panel's
 * first control. Esc stops at the layer, so the talk reader never sees it.
 *
 * The panel's top: 0, except while the site's header band, laid out for the
 * full window while the panel was away, runs under the open panel — then the
 * panel starts below the band until it fits again (panelTop, --btx-top).
 * Meanwhile a cap in the panel's header colour fills the strip above it,
 * beneath the band's overflowing controls (paintTopCap, #89).
 *
 * IIFE -> __BTX.panel (ADR-0002). The pure state core below is also exported
 * for Node (tools/validate-panel-state.js); the DOM shell is skipped there.
 */
(function (root) {
  'use strict';

  const C = (root.__BTX && root.__BTX.const)
    || (typeof require === 'function' ? require('../shared/constants.js') : null);
  // __BTX.churchText, whose walks the arrangement shares (loaded before this
  // file in the manifest; required in Node).
  const churchText = () => (root.__BTX && root.__BTX.churchText) || require('./church-text.js');

  // ---- Pure state core (Node-testable) -----------------------------------
  // The panel's state machine, free of DOM: which mode is effective and what
  // each user action means. Values arrive already normalized by
  // __BTX.settings; the guards here only defend against garbage clicks.

  function createState(init) {
    return {
      mode: init.mode === 'translation' ? 'translation' : 'citations', // agrees with the settings default
      citationView: init.citationView === 'verse' ? 'verse' : 'source',
      collapsed: init.collapsed === true,
      chapter: null, // the key of the chapter showing
      facts: null, // what content.js last said about it (setChapter / arrange)
      click: null, // this visit's mode click: cleared by the next chapter
      picked: null, // this visit's dropdown pick (a row id): cleared by the next chapter
      welcomeSeen: init.welcomeSeen === true, // the synced flag: Got it was pressed
    };
  }

  // ---- The arrangement --------------------------------------------------------
  // The one rule for what the panel shows (GLOSSARY: Arrangement). Pure:
  //   arrangement({ texts, picks, languages, layout, dismissed, mode, click, picked }) -> {
  //     mode:  'translation' | 'citations'   the effective mode
  //     body:  'citations' | 'loading' | 'setup' | 'beside' | 'text'
  //     text:  row id | null    the row the Translation tab is about ('beside', 'text')
  //     saves: 'translation' | 'citations' | null   what the click writes to panelMode
  //     note:  'no-translation' | 'beside-page' | 'missing-chapter' | null   the one quiet line above the body
  //     noteLang: Church code | null     the language the line names
  //     page:  Church row id | null      the page split's language, in either mode
  //     pageNext: lang | null            a language the check must ask before `page` is known
  //   }
  // Inputs, from content.js except the last three (the panel's own state):
  //   texts      the rows that may sit beside this chapter, each with
  //              `offered` true | false | null (chapterOffer's texts; null =
  //              the chapter check hasn't asked yet). Not an array: nothing is
  //              known yet, as if the check were asking.
  //   picks      the pick memory, newest first (plus the default row id)
  //   languages  the enabled Church language codes
  //   layout     churchLanguageLayout: a Church row shows as the beside card
  //              unless it is 'panel'
  //   dismissed  the reader pressed × on the no-translation line (a synced
  //              setting, noTranslationLineDismissed)
  //   mode       the stored panelMode
  //   click      this visit's mode click, or null
  //   picked     this visit's dropdown pick (a row id), or null
  // A click is saved on any chapter. Stored Citations shows Citations. Stored
  // Translation walks the texts with churchText.firstOffered (the walk the
  // chapter check makes): the first one offered shows; one not yet checked
  // before it means the loading state (so Citations never paints first, then
  // switches). When this visit's dropdown pick lacks the chapter, the text
  // shown in its place carries the missing-chapter line. With nothing
  // offered, the setup card when no Church language is on or the reader
  // clicked Translation on this visit, else Citations with the
  // no-translation line (note) unless it was dismissed. The page's
  // language is churchText.pageLanguage, whatever the mode; the text it
  // names shows as the beside card ('beside' means text === page), any other
  // text in the panel (NIV beside Español on the page), with the
  // beside-the-page line naming the page's language.
  function arrangement(input) {
    const o = input || {};
    const click = o.click === 'translation' || o.click === 'citations' ? o.click : null;
    const stored = o.mode === 'translation' ? 'translation' : 'citations';
    const mode = click || stored;
    const saves = click && click !== stored ? click : null;
    // The page's language is the same in either mode (the split stays on the
    // page in Citations).
    const ct = churchText();
    const page = ct.pageLanguage({ texts: o.texts, picks: o.picks, layout: o.layout });
    const show = (m, body, text, note, noteLang) => ({
      mode: m, body, text: text || null, saves, note: note || null, noteLang: noteLang || null,
      page: page.id, pageNext: page.next,
    });
    if (mode !== 'translation') return show('citations', 'citations');
    if (!Array.isArray(o.texts)) return show('translation', 'loading');
    const walk = ct.firstOffered(o.texts, o.picks);
    if (walk.next) return show('translation', 'loading');
    const row = walk.row;
    if (row) {
      // This visit's dropdown pick lacks the chapter: the line says so above
      // the text shown in its place.
      const missed = o.texts.find((t) => t.id === o.picked && t.offered === false && t.provider === ct.PROVIDER);
      const body = row.id === page.id ? 'beside' : 'text';
      if (missed) return show('translation', body, row.id, 'missing-chapter', missed.lang);
      // The text the tab is about holds the page: the beside card says so.
      if (body === 'beside') return show('translation', body, row.id);
      // A Bible version in the panel while a language holds the page: the
      // line says where the language went (Bible rows never hold the page).
      if (page.id && row.provider !== ct.PROVIDER) {
        return show('translation', body, row.id, 'beside-page', page.id.slice(ct.ID_PREFIX.length));
      }
      return show('translation', body, row.id);
    }
    const anyLanguage = Array.isArray(o.languages) && o.languages.length > 0;
    if (!anyLanguage || click === 'translation') return show('translation', 'setup');
    if (o.dismissed === true) return show('citations', 'citations');
    return show('citations', 'citations', null, 'no-translation', noteLanguage(o.picks, o.languages));
  }

  // The language the no-translation line names: the enabled Church language
  // nearest the front of the pick memory (so it speaks about the text the
  // reader expected), else the first enabled one. Pick ids are `church:{code}`.
  function noteLanguage(picks, languages) {
    const prefix = churchText().ID_PREFIX;
    for (const id of Array.isArray(picks) ? picks : []) {
      if (typeof id !== 'string' || !id.startsWith(prefix)) continue;
      const code = id.slice(prefix.length);
      if (languages.includes(code)) return code;
    }
    return languages[0];
  }

  // What a pick on the layout control writes (the beside card, the
  // beside-the-page line's Change, the control above a language read in the
  // panel): the split layout, and the row it makes the pick, or null. Moving
  // the page's language into the panel makes it the text the Translation tab
  // shows, in the place of the Bible version beside it (the dropdown then
  // selects it); every other pick leaves the pick memory alone.
  //   layoutChoice(arrangement, layout) -> row id | null   the row the pick makes the pick
  function layoutChoice(a, layout) {
    const page = a && a.page;
    return layout === 'panel' && page ? page : null;
  }

  // The arrangement of the panel's state: its stored mode and this visit's
  // click over what content.js last said about the chapter.
  function arrangementOf(s) {
    return arrangement(Object.assign({}, s.facts, { mode: s.mode, click: s.click, picked: s.picked }));
  }

  // The mode showing: the arrangement's. panel.effectiveMode() reads it.
  function effectiveMode(s) {
    return arrangementOf(s).mode;
  }

  // A mode-segment click: this visit's click, saved as the stored mode (the
  // caller persists `mode` when it moved). True when the effective mode
  // changed (content must re-render).
  function selectMode(s, m) {
    if (m !== 'citations' && m !== 'translation') return false;
    const before = effectiveMode(s);
    s.click = m;
    const a = arrangementOf(s);
    if (a.saves) s.mode = a.saves;
    return a.mode !== before;
  }

  // A dropdown pick: this visit's, so a pick lacking the chapter is said
  // (the arrangement's missing-chapter line) rather than silently replaced.
  function selectText(s, id) {
    s.picked = typeof id === 'string' && id ? id : null;
  }

  // A citation-layout click. Only acts while citations are showing.
  function selectCitationView(s, v) {
    if (v !== 'source' && v !== 'verse') return false;
    if (v === s.citationView) return false;
    if (effectiveMode(s) !== 'citations') return false;
    s.citationView = v;
    return true;
  }

  // A chapter was shown: a new one, or the same one again (a settings change,
  // the chapter check settling, a pick) — `key` tells them apart. `chapter`
  // is { key, texts, picks, languages, layout }: the arrangement's facts. A
  // new chapter (or one with no key) starts a new visit, so this visit's
  // click goes; the same one keeps it. True when the effective mode flipped.
  function setChapter(s, chapter) {
    const c = chapter || {};
    const before = effectiveMode(s);
    const key = c.key == null ? null : String(c.key);
    if (key === null || key !== s.chapter) Object.assign(s, { click: null, picked: null });
    s.chapter = key;
    s.facts = factsOf(c);
    return effectiveMode(s) !== before;
  }

  function factsOf(c) {
    return { texts: c.texts, picks: c.picks, languages: c.languages, layout: c.layout, dismissed: c.dismissed === true };
  }

  // Whether showing `chapter` leaves every cached view valid: the same chapter
  // again (a settings change re-renders it, the chapter check settles it). The
  // views depend on the chapter, not on which texts offer it, so the talk and
  // the citation list keep their filter, open groups and scroll.
  function sameChapter(s, chapter) {
    const c = chapter || {};
    return c.key != null && String(c.key) === s.chapter;
  }

  // A text-size step (the header's A− / A+ buttons), along the grid the
  // settings module defines: `bounds` is { min, max, step } read from
  // __BTX.settings, which stays the single owner of the clamp — this walks the
  // bounds it is handed and never invents its own. Returns null when the step
  // changes nothing (already at that end, no direction, no usable scale), which
  // is what disables the button *and* what keeps a spent click from writing a
  // setting that would normalize straight back to the value already stored.
  // The result is rounded because a 0.1 grid in floats is not exact (0.7 + 0.1
  // = 0.7999999999999999) and a value that differs from the same number written
  // by the options slider would register as a change that never happened.
  function stepFontScale(scale, dir, bounds) {
    if (!Number.isFinite(scale) || !Number.isFinite(dir) || dir === 0) return null;
    const { min, max, step } = bounds;
    const moved = Number((scale + dir * step).toFixed(4));
    const next = Math.max(min, Math.min(max, moved));
    return next === scale ? null : next;
  }

  // ---- The welcome (GLOSSARY: Welcome) ----------------------------------------
  // When the welcome shows over the panel's body: on any panel shown while
  // the synced `welcomeSeen` flag is false — every chapter until Got it, so a
  // tab closed without it greets again. A collapsed panel shows no welcome,
  // and collapsing doesn't count as seen: expanding brings it back.
  function welcomeDue(s) {
    return s.welcomeSeen !== true && s.chapter !== null && s.collapsed !== true;
  }

  // The flag moved: Got it (true), "Show the welcome again" or another
  // computer's write (either way). True when it changed; the caller persists
  // a change it made.
  function setWelcomeSeen(s, seen) {
    const v = seen === true;
    if (s.welcomeSeen === v) return false;
    s.welcomeSeen = v;
    return true;
  }

  // The controls the panel builds, by name: what a welcome callout may point
  // at. The DOM shell maps each name to its node(s) (controlNodes), and
  // validate-panel-state holds the callouts table to this list.
  //   translation-tab / citations-tab   the header's mode segments
  //   settings / collapse               the header's icon buttons
  //   translation-select                the toolbar's version dropdown
  //   citation-layout                   the toolbar's By source | By verse
  //   text-size                         the toolbar's A− / A+ (two buttons)
  const CONTROL_NAMES = ['translation-tab', 'citations-tab', 'settings', 'collapse', 'translation-select', 'citation-layout', 'text-size'];

  // What the welcome says. Each callout: `id`, the `control` it points at (a
  // CONTROL_NAMES name, or null: the toolbar icon is the browser's, not the
  // panel's, so its line names it in words), its `text` (one short sentence;
  // `{icon}` marks where the extension's icon is drawn inline, calloutParts),
  // and optionally `when`: facts the line needs, all of which must match
  // (welcomeCallouts). In reading order. The copy is spec A's model: the panel
  // opens on Citations, and a language you add reads beside the page's text
  // whatever the panel shows.
  const WELCOME_COPY = { title: 'Welcome to Translations & Citations', gotIt: 'Got it' };
  const WELCOME_CALLOUTS = [
    { id: 'translation', control: 'translation-tab', text: 'Translation shows this chapter in another version or language.' },
    { id: 'citations', control: 'citations-tab', text: 'Citations, where the panel opens, lists the talks that quote each verse.' },
    { id: 'languages', control: 'translation-tab', text: 'A language you add reads beside the page’s text; change that under Translation.' },
    { id: 'settings', control: 'settings', text: 'Settings holds the rest: languages, Bible translations and reading options.' },
    { id: 'text-size', control: 'text-size', text: 'A− and A+ change the size of the panel’s text.' },
    { id: 'toolbar-icon', control: null, text: 'The {icon} button in your browser’s toolbar shows and hides the panel.' },
  ];

  // The lines that show, given what the panel knows (`facts`, e.g.
  // { pinned }): a line with `when` shows only when every fact it names is
  // known and matches — unsure, the welcome says nothing.
  function welcomeCallouts(facts, table) {
    const f = facts || {};
    return (table || WELCOME_CALLOUTS).filter((c) => !c.when || Object.keys(c.when).every((k) => f[k] === c.when[k]));
  }

  // A callout's text as parts to render: strings, and { icon: true } where
  // the extension's icon is drawn.
  function calloutParts(c) {
    const out = [];
    String(c.text).split('{icon}').forEach((t, i) => {
      if (i) out.push({ icon: true });
      if (t) out.push(t);
    });
    return out;
  }

  // Where a callout is drawn: a bubble in the welcome's list under the
  // control it names, its caret aimed at the control's centre, and a ring
  // round the control. Inputs in the welcome layer's coordinates (the panel's
  // box): `control` the control's measured rect (null, or a box of no size —
  // a control not showing, or a line with no control — gives a plain line
  // across the list: no caret, no ring), `list` the list's content box
  // ({left, width}), `panel` ({width}). Out, whole pixels: `card` {left
  // (relative to the list), width}, `caret` (x within the card, or null),
  // `ring` (a rect, or null). The bubble is the list's width up to
  // `cardMax`, centred under the control and kept inside the list; the
  // caret stays `caretInset` in from the bubble's corners; the ring sits
  // `ringPad` out from the control and stops at the panel's edges.
  const CALLOUT_GEOMETRY = { cardMax: 300, caretInset: 16, ringPad: 3 };
  function calloutPlacement({ control, list, panel }, geometry) {
    const g = Object.assign({}, CALLOUT_GEOMETRY, geometry);
    const listW = Math.round(list.width);
    if (!control || !(control.width > 0) || !(control.height > 0)) {
      return { card: { left: 0, width: listW }, caret: null, ring: null };
    }
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const cx = control.left + control.width / 2;
    const width = Math.min(listW, g.cardMax);
    const left = clamp(Math.round(cx - width / 2), Math.round(list.left), Math.round(list.left) + listW - width);
    const caret = clamp(Math.round(cx - left), g.caretInset, width - g.caretInset);
    const x0 = Math.max(0, Math.round(control.left - g.ringPad));
    const y0 = Math.max(0, Math.round(control.top - g.ringPad));
    const x1 = Math.min(Math.round(panel.width), Math.round(control.left + control.width + g.ringPad));
    const y1 = Math.round(control.top + control.height + g.ringPad);
    return {
      card: { left: left - Math.round(list.left), width },
      caret,
      ring: { left: x0, top: y0, width: x1 - x0, height: y1 - y0 },
    };
  }

  // The controls the welcome rings: each one a line names, once, in reading
  // order (both Translation-tab lines share one ring).
  function welcomeRings(callouts) {
    return [...new Set(callouts.map((c) => c.control).filter(Boolean))];
  }

  // Rings that overlap side by side (the Translation and Citations tabs are
  // joined halves) would cross: each such pair meets at the middle of its
  // overlap, `gap` px apart. Null entries (no ring) pass through.
  function separateRings(rings, gap) {
    const g = gap === undefined ? 2 : gap;
    const out = rings.map((r) => (r ? Object.assign({}, r) : null));
    for (let i = 0; i < out.length; i++) {
      for (let j = 0; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        if (i === j || !a || !b || a.left >= b.left) continue; // a is the left one
        const aRight = a.left + a.width;
        const bRight = b.left + b.width;
        const rowsMeet = a.top < b.top + b.height && b.top < a.top + a.height;
        if (!rowsMeet || aRight + g <= b.left || aRight >= bRight) continue;
        const mid = (aRight + b.left) / 2;
        a.width = Math.floor(mid - g / 2) - a.left;
        const left = Math.ceil(mid + g / 2);
        b.width = bRight - left;
        b.left = left;
      }
    }
    return out;
  }

  // One box round several (the A− / A+ stepper is two buttons); a node not
  // showing (no size) adds nothing. Null when nothing shows.
  function unionRect(rects) {
    const shown = rects.filter((r) => r && r.width > 0 && r.height > 0);
    if (!shown.length) return null;
    const left = Math.min(...shown.map((r) => r.left));
    const top = Math.min(...shown.map((r) => r.top));
    const right = Math.max(...shown.map((r) => r.left + r.width));
    const bottom = Math.max(...shown.map((r) => r.top + r.height));
    return { left, top, width: right - left, height: bottom - top };
  }

  // ---- Pure translation-state copy (Node-testable) ------------------------
  // What each Translation-mode card and error says, and which action it
  // offers. `chapter` is the chapter as the reader names it ("Psalm 23"),
  // `name` the text as a sentence names it ("NIV", "Spanish").

  // The setup card, for a chapter no enabled text offers. `bible` is null off
  // the Bible, else what the api.bible path is missing: 'nokey' (no key yet)
  // or 'noversions' (none turned on). The World English Bible ships with the
  // extension, so on the Bible api.bible offers *more* translations.
  function setupCopy(o) {
    const chapter = (o && o.chapter) || 'this chapter';
    const bible = o && o.bible;
    return {
      heading: `Read ${chapter} in another ${bible ? 'translation or language' : 'language'}`,
      languages: 'Choose a Church language…',
      add: 'Add',
      languagesHint: 'Published by the Church. No key needed.',
      // The in-product disclosures (C.DISCLOSURE), beside the action they consent to.
      languagesDisclosure: C.DISCLOSURE.churchLanguage,
      bible: !bible ? null : Object.assign(bible === 'noversions'
        ? { text: 'Turn on more Bible translations from your api.bible key.', button: 'Choose Bible translations' }
        : { text: 'More Bible translations, such as NIV and NKJV, need a free api.bible key.', button: 'Set up more translations' },
      { disclosure: C.DISCLOSURE.apiBible }),
      talks: `See the talks that cite ${chapter}`,
    };
  }

  // The one quiet line above the body (the arrangement's `note`). `note` is
  // { kind, row, chapter }: the kind the arrangement answered, the language's
  // row ({ abbr: its own name, name: its English name }) and the chapter as
  // a sentence names it ("Doctrine and Covenants 76").
  //   -> { view, language, text, actions: [{ id, label, title? }] } or null
  // `view` is the named view the line sits above: it is shown only while that
  // view is mounted. `language` is the name the line uses. The actions' ids
  // are the shell's verbs: 'add' opens the setup card for this visit,
  // 'dismiss' is the ×, 'change' opens the layout control in the line's place.
  // Kinds, each naming the language its own way:
  //   'no-translation'  above Citations: nothing offers the chapter ("Kiribati")
  //   'missing-chapter' above Translation: this visit's dropdown pick lacks
  //                     the chapter ("Pohnpeian"); no buttons
  //   'beside-page'     above a Bible version in the panel: the language
  //                     holding the page, as the dropdown leads its row ("Español")
  function noteCopy(note) {
    const kind = note && note.kind;
    const row = (note && note.row) || {};
    if (kind === 'beside-page') {
      const language = row.abbr || row.name || '';
      return {
        view: 'translation',
        language,
        text: `${language || 'A language'} is beside the page text ·`,
        actions: [{ id: 'change', label: 'Change' }],
      };
    }
    if (kind !== 'no-translation' && kind !== 'missing-chapter') return null;
    const language = row.name || '';
    const text = language && note.chapter ? `No ${language} translation for ${note.chapter}.` : 'No translation for this chapter.';
    if (kind === 'missing-chapter') return { view: 'translation', language, text, actions: [] };
    return {
      view: 'citations',
      language,
      text,
      actions: [
        { id: 'add', label: 'Add a language' },
        { id: 'dismiss', label: '×', title: 'Dismiss for good' },
      ],
    };
  }

  // Where a Church language shows, named the same on the options page:
  // [churchLanguageLayout value, label].
  const LAYOUTS = [['columns', 'Side by side'], ['interlinear', 'Under each verse'], ['panel', 'In the panel']];

  // The card shown while a Church language is split into the page. `layout` is
  // the reader's setting ('columns' | 'interlinear'); `effective` is what the
  // page split could actually lay out (null until it has mounted), and
  // `collapseFits` whether collapsing the panel would give columns room.
  // `pressed` is the segment the layout control shows pressed: the layout the
  // page shows, so control, status and page agree (pressedLayout).
  // `collapse` is the label of the card's collapse button, null when it isn't
  // offered. Beside the page, collapsing is offered only where it delivers
  // columns: it widens columns already there, or makes room for them. In the
  // narrow window's bottom sheet (`sheet`) nothing can make room for columns,
  // so there is no room note until the reader clicks Side by side (`nudged`),
  // and the sheet covering the page is what collapsing fixes: it is always
  // offered, as "Hide panel".
  function besideCopy(o) {
    const c = o || {};
    const name = c.name || 'The translation';
    const layout = c.layout === 'interlinear' ? 'interlinear' : 'columns';
    const shown = c.effective === 'columns' || c.effective === 'interlinear' ? c.effective : layout;
    const status = shown === 'columns' ? `${name} is shown side by side.` : `${name} is shown under each verse.`;
    const pressed = pressedLayout(layout, c.effective);
    if (c.sheet === true) {
      return { status, note: c.nudged === true ? roomHint({ layout, effective: shown, collapseFits: false }) : '', collapse: 'Hide panel', pressed };
    }
    return {
      status,
      note: roomHint({ layout, effective: shown, collapseFits: c.collapseFits }),
      collapse: layout === 'columns' && (shown === 'columns' || c.collapseFits === true) ? 'Collapse panel for wider columns' : null,
      pressed,
    };
  }

  // The layout the control shows pressed: the one the page is laid out in.
  // Columns wanted but not fitting is shown as Under each verse while the
  // setting stays columns, so side by side returns by itself when room does.
  // `effective` is null until the split has measured; "In the panel" has no
  // split to fit.
  function pressedLayout(layout, effective) {
    if (layout !== 'columns' && layout !== 'interlinear') return layout;
    return effective === 'columns' || effective === 'interlinear' ? effective : layout;
  }

  // What a click on layout `value` does, given the reader's setting `layout`
  // and the split's `effective` layout: 'write' the setting, 'explain' (the
  // setting already is `value` but the page can't show it: say what would
  // make room, change nothing), or 'none'. Compared with the setting, never
  // with the pressed segment: Under each verse is pressed while columns are
  // wanted, and picking it is still a change of preference.
  function layoutClick(o) {
    const c = o || {};
    if (c.value !== c.layout) return 'write';
    return pressedLayout(c.layout, c.effective) !== c.value ? 'explain' : 'none';
  }

  // Why Side by side isn't shown, in a line: collapsing the panel would give
  // columns room (the owner's wording), or there is no room to be had. Empty
  // where columns fit or weren't asked for. `sheet` is the bottom sheet:
  // collapsing can't help there.
  function roomHint(o) {
    const c = o || {};
    if (c.layout !== 'columns' || c.effective !== 'interlinear') return '';
    return c.collapseFits === true && c.sheet !== true ? 'Collapse the panel for side by side.' : 'Not enough room for side by side.';
  }

  // A rate-limited chapter load: wait and retry by itself, or stop? Only a
  // short, stated wait is waited out — the local 30-second window, or an
  // api.bible 429 whose Retry-After is at most RETRY_MAX_WAIT_MS — and only
  // RETRY_MAX times in a row for one chapter and version (`attempts` is how
  // many automatic retries already ran). A 429 with no Retry-After, a longer
  // one, the daily cap, or a wait that keeps coming back stops at the error
  // card: every retry spends the reader's api.bible allowance.
  //   -> ms to wait before the retry, or null for the error card
  const RETRY_MAX_WAIT_MS = 60000;
  const RETRY_MAX = 3;

  function retryWait(error, attempts) {
    const e = error || {};
    if (e.code !== 'RATE_LIMITED') return null;
    const ms = Number(e.retryAfterMs);
    if (!(ms > 0) || ms > RETRY_MAX_WAIT_MS) return null;
    if (!((Number(attempts) || 0) < RETRY_MAX)) return null;
    return Math.max(1000, Math.ceil(ms));
  }

  // A chapter that failed to load. `code` is a C.ERR code; `church` says it
  // came from the Church's site rather than api.bible; `alternatives` that the
  // dropdown offers something else to pick. A RATE_LIMITED error that reaches
  // the card (retryWait said stop) is api.bible refusing the key (`remote`),
  // the local daily cap (no wait, or one past RETRY_MAX_WAIT_MS), or a short
  // wait that kept recurring. action: 'settings' | 'retry' | null.
  function errorCopy(o) {
    const e = o || {};
    const name = e.name || 'this translation';
    const chapter = e.chapter || 'this chapter';
    const other = e.church ? 'language' : 'translation';
    switch (e.code) {
      case 'NO_KEY':
        return { message: 'Bible translations need an api.bible key.', hint: '', action: 'settings' };
      case 'INVALID_KEY':
        return { message: 'api.bible didn’t accept your key.', hint: 'Check that you copied all of it.', action: 'settings' };
      case 'FORBIDDEN':
        return {
          message: `${name} isn’t included with your api.bible key.`,
          hint: e.alternatives ? 'Add it at scripture.api.bible, or choose another translation above.' : 'Add it at scripture.api.bible.',
          action: 'settings',
        };
      case 'NOT_FOUND':
        return {
          message: e.church ? `${chapter} isn’t available in ${name}.` : `${name} doesn’t include ${chapter}.`,
          hint: e.alternatives ? `Choose another ${other} above.` : '',
          action: null,
        };
      case 'RATE_LIMITED':
        if (e.remote) {
          return {
            message: 'Your api.bible key has used its allowance for now.',
            hint: 'Chapters you’ve already read still open. Try again later.',
            action: 'retry',
          };
        }
        if (e.retryAfterMs > 0 && e.retryAfterMs <= RETRY_MAX_WAIT_MS) {
          return { message: 'api.bible is busy.', hint: 'Try again in a minute.', action: 'retry' };
        }
        return {
          message: 'You’ve used today’s api.bible allowance.',
          hint: 'Chapters you’ve already read still open. Others will load again tomorrow.',
          action: null,
        };
      case 'NETWORK':
        return {
          message: e.church ? 'Couldn’t reach churchofjesuschrist.org.' : 'Couldn’t reach api.bible.',
          hint: 'Check your connection.',
          action: 'retry',
        };
      default:
        return { message: `Something went wrong loading ${name}.`, hint: '', action: 'retry' };
    }
  }

  // ---- Pure view-host core (Node-testable) --------------------------------
  // A *view* is a named body of panel content: 'translation', 'citations',
  // 'talk'. The host keeps at most one cached body per name, tagged with a
  // caller-supplied content key. Same name + same key => the very same DOM is
  // re-mounted (at the scroll offset it was left at, if it is a view that owns
  // its scroll — see viewRestoresScroll); a different key (another chapter,
  // another citation layout, another translation) means rebuild. Nothing
  // outside the panel decides when a body may be reused.

  function createViews() {
    return { active: null, entries: {} };
  }

  // Which views own their scroll position. Translation mode does not: there the
  // page is the source of truth and the body mirrors it (see scroll-sync
  // below), so saving and restoring an offset would be a second, competing
  // answer to "where should the body be?". Citations and the talk reader have
  // no such external driver, so they save and restore.
  //
  // With scroll-sync switched off (the `scrollSync` setting) there is no
  // external driver for Translation either — so it owns its scroll like the
  // rest, and coming back to it lands where the user left it rather than
  // wherever the page happens to point.
  const PAGE_SYNCED_VIEWS = { translation: true };

  function viewRestoresScroll(name, scrollSync) {
    if (scrollSync === false) return true;
    return !PAGE_SYNCED_VIEWS[name];
  }

  // Whether the page's scroll may move the body at all. Four inputs, each of
  // which can move on its own; the shell re-asserts this after every one of
  // them (refreshScrollSync) and nowhere else — rendering content is not a
  // state change. `visible` must be explicit; the setting defaults to on, so an
  // unknown value reads as on rather than switching the feature off.
  function wantsScrollSync(s, opts) {
    const o = opts || {};
    if (o.visible !== true) return false;
    if (s.collapsed) return false;
    if (effectiveMode(s) !== 'translation') return false;
    return o.scrollSync !== false;
  }

  // Record where the mounted view was scrolled, just before swapping it out —
  // this is what makes Citations (and "< Back" out of a talk) land where the
  // user left off. Every view records, including a page-synced one whose offset
  // nothing will read: ownership can change under a view (the `scrollSync`
  // setting), and a view that recorded nothing while page-synced would come
  // back to a `scrollTop` of 0 — the top of the chapter — rather than to where
  // the reader actually was. Recording is inert; viewRestoresScroll decides
  // whether the number is ever read.
  function saveViewScroll(v, scrollTop) {
    const e = v.active && v.entries[v.active];
    if (e) e.scrollTop = Math.max(0, Math.round(Number(scrollTop) || 0));
  }

  // Choose between re-mounting the cached body and building a fresh one, and
  // make `name` the mounted view either way. `cacheable === false` marks the
  // fresh body as throwaway: it is rebuilt on every request.
  function selectView(v, name, key, cacheable) {
    const hit = v.entries[name];
    v.active = name;
    if (hit && hit.keep === true && hit.node && hit.key === key) return { action: 'restore', entry: hit };
    // keep starts undecided: a body earns its cache slot, it isn't given one.
    const entry = { key, node: null, scrollTop: 0, cacheable: cacheable !== false, keep: null };
    v.entries[name] = entry;
    return { action: 'build', entry };
  }

  // The mounted view saying whether what it just rendered is worth re-mounting.
  // A finished translation chapter is; a spinner, a no-key prompt, or an error
  // is not — re-mounting one of those instead of retrying strands the user.
  function keepView(v, keep) {
    const e = v.active && v.entries[v.active];
    if (e) e.keep = keep === true;
  }

  // The render is over. A view that said nothing either way earns its slot by
  // having finished and left something behind (`produced`) — so a render that
  // bailed out after an await can never cache a blank body. One that already
  // answered keeps its answer.
  function settleView(entry, produced) {
    if (!entry.cacheable) { entry.keep = false; return; }
    if (entry.keep === null) entry.keep = produced === true;
  }

  // A new chapter invalidates every cached body at once. `keep` names the
  // slots that are still valid (the same chapter shown again keeps Citations
  // and the talk; its Translation inputs are what changed).
  function dropViews(v, keep) {
    const kept = {};
    for (const name of Array.isArray(keep) ? keep : []) if (v.entries[name]) kept[name] = v.entries[name];
    v.entries = kept;
    if (!kept[v.active]) v.active = null;
  }

  // Scroll-owning views outlive a same-chapter re-render; Translation is what
  // the re-render is for.
  const SAME_CHAPTER_VIEWS = ['citations', 'talk'];

  // ---- Pure scroll easing (Node-testable) ---------------------------------
  // One frame of an exponential chase — the remaining distance decays with time
  // constant `tau`, so the step is proportional to how far there is left to go.
  // The one move that uses it is re-alignment, which can be worth thousands of
  // pixels and so has to be carried rather than jumped.
  //
  // Normalizing on elapsed `dt` rather than counting frames is what keeps 60Hz
  // and 120Hz displays feeling the same.
  //
  // The target is a *fixed* gap, never a moving one: a page scroll arriving
  // mid-flight is carried 1:1 instead of retargeting the chase (see
  // carryScroll), so `tau` is purely how long the gap takes to close and
  // nothing here ever trails the page. (Instant moves don't come through here
  // at all; setBodyScroll short-circuits them. `tau <= 0` is only a guard
  // against a nonsense value.)
  //   ramp  0..1 multiplier on the step, used to *start* the move gently (see
  //         easeRamp). Defaults to 1 — full exponential ease-out.
  function scrollStep(from, target, dt, tau, ramp) {
    const f = Number(from) || 0;
    const t = Number(target) || 0;
    if (!(tau > 0)) return t; // no easing configured — land on it
    if (!(dt > 0)) return f; // no time has passed, so nothing has moved
    const r = ramp === undefined ? 1 : Math.min(1, Math.max(0, Number(ramp) || 0));
    const k = Math.min(1, 1 - Math.exp(-dt / tau)) * r;
    return f + (t - f) * k;
  }

  // How much of the easing is "switched on" `elapsed` ms into a move. An
  // exponential chase is fastest on its very first frame, which is what makes a
  // long re-alignment feel like being thrown rather than carried. Ramping the
  // step in over the first fraction of a second gives the move a beginning you
  // can see: it accelerates in, then the exponential decelerates it out.
  // Smoothstep, so there is no corner at either end.
  function easeRamp(elapsed, rampMs) {
    if (!(rampMs > 0)) return 1;
    const x = Math.min(1, Math.max(0, (Number(elapsed) || 0) / rampMs));
    return x * x * (3 - 2 * x);
  }

  // A floor under the step, in the direction of travel. The browser stores
  // scrollTop in whole pixels and an exponential step is proportional to the
  // distance left, so the last handful of pixels ask for moves under half a
  // pixel: they round away to nothing and the body stops short. The stall exit
  // in realignmentDone notices and finishes the move, but *finishing* it is a
  // jump of a few pixels, and the rule here is that the body never jumps. So
  // once the chase is slower than a pixel a frame, it walks the rest at a pixel
  // a frame — about 80ms for the tail, too small to read as motion, but it
  // arrives instead of being snapped there.
  function floorStep(from, next, target, minPx) {
    const f = Number(from) || 0;
    const n = Number(next) || 0;
    const distance = (Number(target) || 0) - f;
    const min = minPx > 0 ? minPx : 0;
    if (!min || distance === 0) return n;
    const direction = distance > 0 ? 1 : -1;
    if ((n - f) * direction >= min) return n; // already moving faster than the floor
    return f + direction * Math.min(min, Math.abs(distance)); // never past the target
  }

  // Re-alignment tuning. RAMP is how long the move takes to get going (so it
  // has a visible beginning instead of snapping to full speed); TAU is how fast
  // it settles once moving. Both live here, above the DOM shell, so the
  // validator can assert the *shipped* numbers rather than a copy of them.
  const SCROLL_TAU_MS = 165;
  const SCROLL_RAMP_MS = 130;
  const SCROLL_MIN_STEP_PX = 1; // the smallest move the browser can actually store
  const SCROLL_LIMITS = {
    // Arrival, in whole pixels — and it can be this tight only because
    // floorStep guarantees at least a pixel of progress per frame, so the last
    // stretch takes frames rather than the half second an exponential tail
    // spends being invisible (during which the panel is still re-aligning
    // instead of tracking 1:1).
    settlePx: 1,
    // "Didn't move at all", not "moved a little": a step is proportional to the
    // distance left, so a larger value here would fire on the ordinary tail and
    // make every arrival a small jump. The rounding case this exists for
    // freezes the body completely, so it moves exactly 0.
    stallPx: 0.05,
    stallAfterMs: SCROLL_RAMP_MS + 32, // ...but not before the ramp is open
    maxMs: 1800, // backstop, measured from the start (see carryScroll)
  };

  // The page moved while a re-alignment is in flight. Two motions are running
  // at once and they are not the same kind: the page's own movement is the
  // panel's to mirror 1:1, and only the detach gap is what eases. So carry the
  // body along by the page's delta and leave the gap untouched — the ease keeps
  // its own schedule and finishes on time no matter how long the user keeps
  // scrolling.
  //
  // Without this the chase is aimed at a target that runs away from it, so it
  // settles into a trail of roughly `tau x velocity` behind the page for as
  // long as the scrolling continues: the panel floats along after the page
  // instead of arriving, which reads as lag rather than as smoothness.
  // The body may not have room for the whole delta (it is already at the top or
  // the bottom), so the caller measures the shift it *actually* got out of the
  // return value rather than assuming it landed.
  function carryScroll(from, prevTarget, nextTarget, max) {
    const shifted = (Number(from) || 0) + ((Number(nextTarget) || 0) - (Number(prevTarget) || 0));
    return Math.max(0, Math.min(Number(max) || 0, shifted));
  }

  // Is the re-alignment over? Three ways to be done, and two of them exist
  // because a scroll container will not simply arrive where it is sent.
  //   distance  how far is left to travel
  //   moved     how far the body actually moved last frame — not how far it was
  //             asked to. null on the first frame, which hasn't moved
  //   elapsed   ms since the re-alignment began (drives the ramp and the cap)
  //
  // The browser rounds scrollTop to whole pixels, so a chase aiming at a
  // fractional target eventually asks for sub-pixel steps that round away to
  // nothing: it stops moving while still measurably short. That is the stall
  // exit. It must stay shut until the ramp is open (`stallAfterMs`), because
  // during ramp-in the body is *meant* to be nearly still — reading that as
  // arrival would cancel the animation on its very first frame and turn every
  // re-alignment back into the teleport this whole seam exists to avoid.
  //
  // `maxMs` runs from the start, and can do so *because* of `carryScroll`: a
  // target that moves with the page no longer stretches the travel, so the gap
  // this is closing only ever shrinks. It is a hard ceiling on how long the
  // panel may stay in re-alignment — which is what guarantees it goes back to
  // tracking 1:1 however long the user keeps scrolling.
  function realignmentDone(progress, limits) {
    const p = progress || {};
    const l = limits || SCROLL_LIMITS;
    if (Math.abs(Number(p.distance) || 0) <= l.settlePx) return true;
    if ((Number(p.elapsed) || 0) >= l.maxMs) return true;
    const rampOpen = (Number(p.elapsed) || 0) >= l.stallAfterMs;
    const stalled = p.moved !== null && p.moved !== undefined && Math.abs(Number(p.moved) || 0) < l.stallPx;
    return rampOpen && stalled;
  }

  // ---- Where a revealed target lands ---------------------------------------
  // Opening a citation is a reading task, not a navigation one: the cited
  // sentence usually sits mid-paragraph, so parking it at the very top of the
  // panel hides the run-up to it and the reader has to scroll back for the
  // context they opened the thing to see. So a revealed target lands near the
  // vertical *middle* of the visible body instead, with the lead-in above it.
  //
  // The gap above is a fraction of the body's own height rather than a pixel
  // count, so it holds at any panel width or window height. Slightly above
  // centre: a citation is read forwards, so the text after it deserves the
  // larger half.
  //   targetTop  the target's distance from the top of the scrollable content
  //   viewportH  the body's visible height
  //   maxScroll  the body's scrollable range (scrollHeight - clientHeight)
  //   clearTop   px at the top of the body that must not cover the target —
  //              the talk reader's sticky header. Centring clears it on any
  //              panel taller than about 2.5x the header, but the floor is in
  //              the rule rather than left to those numbers happening to work.
  //
  // Both clamps are intended behaviour, not leftovers: a target too near the
  // start of the content scrolls to the top and sits wherever it falls (no jump
  // and no second scroll to bounce off), and one near the end scrolls to the
  // bottom, where it is still visible. This is also why the range is a
  // parameter and not the shell's business: "as close as possible" is part of
  // the placement rule, so it is decided and tested here. (setBodyScroll clamps
  // again against the *live* range, which is the same clamp a frame later.)
  //
  // A target inside the top clamp is the one case the floor cannot honour: no
  // scroll position lifts content that is already above the fold, so the panel
  // does the only thing left and goes to the top. In the talk reader that never
  // costs anything — the header is `position: sticky`, so it takes up flow at
  // the top of the content and nothing the reader can cite starts above it.
  const SCROLL_REVEAL_FRACTION = 0.4;
  const SCROLL_REVEAL_CLEAR_PX = 10; // breathing room below a sticky header

  function revealTop(pos) {
    const p = pos || {};
    const targetTop = Number(p.targetTop) || 0;
    const viewportH = Math.max(0, Number(p.viewportH) || 0);
    const maxScroll = Math.max(0, Number(p.maxScroll) || 0);
    const clear = Math.max(0, Number(p.clearTop) || 0);
    // Keeping the target on screen outranks keeping it clear: in a panel too
    // short to do both (shorter than its own header), the floor gives way
    // rather than pushing the target past the bottom edge.
    const roomForFloor = Math.max(0, viewportH - SCROLL_REVEAL_CLEAR_PX);
    const floor = clear > 0 ? Math.min(clear + SCROLL_REVEAL_CLEAR_PX, roomForFloor) : 0;
    const gap = Math.max(viewportH * SCROLL_REVEAL_FRACTION, floor);
    return Math.max(0, Math.min(maxScroll, targetTop - gap));
  }

  // Did the body move because we moved it, or because the user did? Every write
  // records the position it left behind; a 'scroll' event reporting anything
  // else is the user's own, and the panel must yield to it rather than drag the
  // body back. `expected` is null until we have written at all.
  function isForeignScroll(actual, expected, tolerance) {
    if (expected === null || expected === undefined) return true;
    const tol = tolerance > 0 ? tolerance : 1;
    return Math.abs((Number(actual) || 0) - expected) > tol;
  }

  // ---- Keeping the reader's place through a text-size change -----------------
  // A− / A+ reflow everything above the passage being read, so a body left at
  // the same scrollTop lands the reader somewhere else in the talk. Instead an
  // anchor element (the passage on screen) keeps its distance from the body's
  // top: `before` and `after` are that distance either side of the size
  // change; the body moves by the difference, within its range.
  function keptScrollTop(p) {
    const o = p || {};
    const moved = (Number(o.after) || 0) - (Number(o.before) || 0);
    return Math.max(0, Math.min(Math.max(0, Number(o.maxScroll) || 0), (Number(o.scrollTop) || 0) + moved));
  }

  // ---- Where the panel's top sits ---------------------------------------------
  // The site lays its header band out for the width it measured at render and
  // re-measures only when the window's width changes. A header laid out while
  // the panel was collapsed or away keeps the full-window layout once the
  // panel opens beside it, so its right end (Sign In, the account menu) runs
  // under the panel. While that is so, the panel starts below the band —
  // following the band as the page scrolls it away — and goes back to the top
  // once the band fits again.
  //   overflows  the band's content is wider than the band
  //   bottom     the band's bottom edge in the viewport, px
  //   reserve    the page width reserved for the open panel (0: collapsed,
  //              hidden, or the narrow window's bottom sheet)
  //   -> px from the top of the window
  function panelTop(p) {
    const o = p || {};
    if (!(o.reserve > 0) || o.overflows !== true) return 0;
    return Math.max(0, Math.round(Number(o.bottom) || 0));
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      createState, arrangement, layoutChoice, arrangementOf, effectiveMode, selectMode, selectText, selectCitationView, setChapter, sameChapter,
      welcomeDue, setWelcomeSeen, CONTROL_NAMES, WELCOME_COPY, WELCOME_CALLOUTS, welcomeCallouts, calloutParts,
      CALLOUT_GEOMETRY, calloutPlacement, welcomeRings, separateRings, unionRect,
      stepFontScale, setupCopy, noteCopy, besideCopy, pressedLayout, layoutClick, roomHint, errorCopy, retryWait, LAYOUTS, RETRY_MAX_WAIT_MS, RETRY_MAX,
      createViews, saveViewScroll, selectView, keepView, settleView, dropViews, SAME_CHAPTER_VIEWS,
      viewRestoresScroll, wantsScrollSync,
      scrollStep, easeRamp, floorStep, carryScroll, realignmentDone, isForeignScroll,
      revealTop, keptScrollTop, panelTop,
      SCROLL_TAU_MS, SCROLL_RAMP_MS, SCROLL_MIN_STEP_PX, SCROLL_LIMITS,
      SCROLL_REVEAL_FRACTION, SCROLL_REVEAL_CLEAR_PX,
    };
  }
  if (typeof document === 'undefined') return; // Node: pure core only

  // ---- DOM shell -----------------------------------------------------------

  const SAN = () => root.__BTX.sanitize;
  const SETTINGS = () => root.__BTX.settings;

  // At this width and under, the panel is a bottom sheet (panel.css's media
  // query of the same width): no page reserve, and the beside card offers to
  // hide the panel rather than to widen columns.
  const SHEET_QUERY = '(max-width: 700px)';
  function inSheet() {
    return !!(window.matchMedia && window.matchMedia(SHEET_QUERY).matches);
  }

  // Panel mode/collapsed used to live in these ad-hoc chrome.storage.local
  // keys; init() migrates them into the settings module once.
  const LEGACY_MODE_KEY = 'btxPanelMode';
  const LEGACY_COLLAPSED_KEY = 'btxPanelCollapsed';

  // The settings this panel handles by itself when they change. Exposed as
  // panel.HANDLED_KEYS so the orchestrator can skip its full re-render for a
  // change touching only these — one list, no mirror to drift.
  const PANEL_HANDLED_KEYS = ['sidebarWidth', 'fontScale', 'citationView', 'panelMode', 'panelCollapsed', 'scrollSync', 'welcomeSeen'];

  let ui = null; // refs once built
  const cbs = {}; // event handlers set by init()
  let state = createState({});
  let views = createViews();
  let visible = false;
  let scrollRaf = null;
  // The `scrollSync` setting: may the page's scroll move the body at all? An
  // input to wantsScrollSync *and* to who owns a view's scroll, so it is read
  // before the first applyModeUI and re-read on every settings change. Distinct
  // from pageScrollBound below, which is the mechanism the setting switches:
  // whether the window listener is attached right now.
  let scrollSync = true;
  // The body-text multiplier currently applied, always a normalized value (it
  // is written by applyFontScale, never assigned raw). The header's stepper
  // steps from this rather than re-reading storage, so a click is instant and
  // the disabled ends match what is on screen.
  let fontScale = 1;
  let pageScrollBound = false;
  let scrollFadeTimer = null;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // Icons: shapes on a 24-unit grid, stroked in currentColor so each follows
  // its button's colour and the theme. Built node by node, never from markup.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PANEL_FRAME = [['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }], ['path', { d: 'M15 3v18' }]];
  const ICONS = {
    settings: [
      ['circle', { cx: 12, cy: 12, r: 3 }],
      ['path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z' }],
    ],
    collapse: PANEL_FRAME.concat([['path', { d: 'm8 9 3 3-3 3' }]]), // chevron toward the edge
    expand: PANEL_FRAME.concat([['path', { d: 'm10 15-3-3 3-3' }]]), // chevron out of it
  };

  function svgNode(tag, attrs) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k of Object.keys(attrs)) n.setAttribute(k, String(attrs[k]));
    return n;
  }

  function icon(name, size) {
    const svg = svgNode('svg', {
      viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
      'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'aria-hidden': 'true', focusable: 'false',
    });
    for (const [tag, attrs] of ICONS[name]) svg.appendChild(svgNode(tag, attrs));
    return svg;
  }

  // A button whose visible content is a glyph or an icon: its accessible name
  // and its tooltip are the same words.
  function labelled(node, label) {
    node.setAttribute('aria-label', label);
    node.title = label;
    return node;
  }

  // A segmented control: buttons in a named group, the chosen one pressed.
  function segmented(cls, label, buttons) {
    const group = el('div', cls);
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    for (const b of buttons) group.appendChild(b);
    return group;
  }

  function setPressed(button, on) {
    button.classList.toggle('btx-active', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  // Two rows of chrome above the body. The header row lines up with the
  // site's toolbar and holds what is always there: the mode control, Settings
  // and Collapse. The toolbar row under it holds the current mode's controls —
  // the translation dropdown, or the By source | By verse toggle — beside the
  // text-size stepper.
  function ensureRoot() {
    const existing = document.getElementById('btx-root');
    if (existing && ui) return ui;

    const rootEl = existing || el('div', null);
    rootEl.id = 'btx-root';
    rootEl.setAttribute('role', 'complementary');
    rootEl.setAttribute('aria-label', 'Translations & Citations');
    rootEl.setAttribute('data-btx-theme', 'light');
    rootEl.setAttribute('data-btx-mode', 'translation');

    const panel = el('div', 'btx-panel');

    const modeTranslation = el('button', 'btx-mode', 'Translation');
    const modeCitations = el('button', 'btx-mode', 'Citations');
    const modes = segmented('btx-modes', 'Show', [modeTranslation, modeCitations]);
    const gear = labelled(el('button', 'btx-btn btx-icon-btn btx-gear'), 'Settings');
    gear.appendChild(icon('settings', 18));
    const collapse = labelled(el('button', 'btx-btn btx-icon-btn btx-collapse'), 'Collapse panel');
    collapse.appendChild(icon('collapse', 18));
    const header = el('div', 'btx-header');
    header.appendChild(modes);
    header.appendChild(gear);
    header.appendChild(collapse);

    // Named apart from the Translation mode button above it. Its tooltip is
    // the chosen text's full label (showSelectedTitle): a narrow panel cuts
    // the closed select off mid-word.
    const select = el('select', 'btx-select');
    select.setAttribute('aria-label', 'Translation or language');
    const citViewSource = el('button', 'btx-cit-mode', 'By source');
    const citViewVerse = el('button', 'btx-cit-mode', 'By verse');
    const citModes = segmented('btx-cit-modes', 'Group citations', [citViewSource, citViewVerse]);
    // Text-size stepper. Two buttons rather than the options page's slider
    // because the size is read-and-adjust: the reader is looking at the text
    // while stepping it. Both write the same setting the slider does.
    const smaller = labelled(el('button', 'btx-btn btx-font-step', 'A−'), 'Smaller text');
    const larger = labelled(el('button', 'btx-btn btx-font-step btx-font-larger', 'A+'), 'Larger text');
    const toolbar = el('div', 'btx-toolbar');
    toolbar.appendChild(select);
    toolbar.appendChild(citModes);
    toolbar.appendChild(smaller);
    toolbar.appendChild(larger);

    const body = el('div', 'btx-body');

    // Drag-to-resize grip on the panel's left (inner) edge.
    const resize = el('div', 'btx-resize');
    resize.title = 'Drag to resize';

    panel.appendChild(resize);
    panel.appendChild(header);
    panel.appendChild(toolbar);
    panel.appendChild(body);

    // The collapsed panel: one icon tab on the window's right edge.
    const tab = labelled(el('button', 'btx-tab'), 'Show Translations & Citations');
    tab.appendChild(icon('expand', 20));

    rootEl.appendChild(panel);
    rootEl.appendChild(tab);
    if (!existing) {
      rootEl.style.display = 'none'; // stay hidden until showChapter()
      document.body.appendChild(rootEl);
      window.addEventListener('resize', () => { updatePageReserve(); scheduleTopChecks(); }, { passive: true });
      // Into or out of the bottom sheet: the beside card's collapse offer changes.
      if (window.matchMedia) window.matchMedia(SHEET_QUERY).addEventListener('change', () => updateBeside());
    }

    // Wire controls.
    select.addEventListener('change', () => {
      showSelectedTitle();
      selectText(state, select.value);
      if (cbs.onTranslationChange) cbs.onTranslationChange(select.value);
    });
    smaller.addEventListener('click', () => onFontStep(-1));
    larger.addEventListener('click', () => onFontStep(1));
    gear.addEventListener('click', () => cbs.onGear && cbs.onGear());
    collapse.addEventListener('click', () => setCollapsed(true));
    tab.addEventListener('click', () => setCollapsed(false));
    modeTranslation.addEventListener('click', () => onModeClick('translation'));
    modeCitations.addEventListener('click', () => onModeClick('citations'));
    citViewSource.addEventListener('click', () => onCitViewClick('source'));
    citViewVerse.addEventListener('click', () => onCitViewClick('verse'));
    resize.addEventListener('pointerdown', onResizeDown);
    // Show the scrollbar while scrolling, fade it ~1s after it stops.
    body.addEventListener('scroll', () => {
      onBodyScrolled();
      body.classList.add('btx-scrolling');
      clearTimeout(scrollFadeTimer);
      scrollFadeTimer = setTimeout(() => body.classList.remove('btx-scrolling'), 1000);
    }, { passive: true });

    // Each of CONTROL_NAMES to the node(s) it names: what a welcome callout
    // points at (controlNodes).
    const controls = {
      'translation-tab': [modeTranslation],
      'citations-tab': [modeCitations],
      settings: [gear],
      collapse: [collapse],
      'translation-select': [select],
      'citation-layout': [citModes],
      'text-size': [smaller, larger],
    };

    ui = { rootEl, panel, header, toolbar, select, smaller, larger, modes, modeTranslation, modeCitations, citModes, citViewSource, citViewVerse, body, tab, collapse, resize, controls };
    return ui;
  }

  // ---- State -> DOM --------------------------------------------------------

  function applyModeUI() {
    const cit = effectiveMode(state) === 'citations';
    setPressed(ui.modeTranslation, !cit);
    setPressed(ui.modeCitations, cit);
    ui.select.style.display = cit ? 'none' : '';
    ui.rootEl.setAttribute('data-btx-mode', cit ? 'citations' : 'translation');
    refreshScrollSync();
  }

  function applyCitationViewUI() {
    const verse = state.citationView === 'verse';
    setPressed(ui.citViewVerse, verse);
    setPressed(ui.citViewSource, !verse);
  }

  function applyCollapsedUI() {
    ui.rootEl.classList.toggle('btx-collapsed', state.collapsed);
    refreshScrollSync();
    updatePageReserve();
    applyWelcomeUI();
  }

  // ---- The welcome -----------------------------------------------------------
  // A layer over the body (header and toolbar stay in view and usable), shown
  // while welcomeDue says so. It is a labelled dialog *within* the panel, not
  // a modal: the page beside it stays fully usable, and only Got it closes it
  // — a click elsewhere, a scroll or Esc leave it up. Focus moves into it when
  // it appears, and to the panel's first control on Got it.
  let welcome = null; // { layer, sheet, list, items, rings, observer, frame } while it shows

  function applyWelcomeUI() {
    if (!ui) return;
    const want = visible && welcomeDue(state);
    if (want && !welcome) openWelcome();
    else if (!want && welcome) closeWelcome();
  }

  // The layer covers the whole panel but takes no pointer events: it holds
  // the rings drawn round the controls the lines name (header and toolbar
  // stay usable through them) and the sheet, which covers the body only and
  // holds the dialog. Each line that names a control is a bubble placed
  // under it (calloutPlacement, from measured rects: placeWelcome).
  function buildWelcome() {
    const layer = el('div', 'btx-welcome');
    const rings = {};
    for (const name of welcomeRings(welcomeCallouts({}))) {
      const ring = el('div', 'btx-welcome-ring');
      ring.setAttribute('data-btx-control', name);
      ring.setAttribute('aria-hidden', 'true');
      rings[name] = ring;
      layer.appendChild(ring);
    }
    const sheet = el('div', 'btx-welcome-sheet');
    const dialog = el('div', 'btx-welcome-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-labelledby', 'btx-welcome-title');
    dialog.tabIndex = -1;
    const title = el('h2', 'btx-welcome-title', WELCOME_COPY.title);
    title.id = 'btx-welcome-title';
    const list = el('ul', 'btx-welcome-list');
    const items = [];
    for (const c of welcomeCallouts({})) {
      const item = el('li', 'btx-welcome-item');
      item.setAttribute('data-btx-callout', c.id);
      if (c.control) item.setAttribute('data-btx-control', c.control);
      for (const part of calloutParts(c)) item.appendChild(typeof part === 'string' ? document.createTextNode(part) : extensionIcon());
      // Hovering a line lights its control's ring and dims the others.
      const ring = c.control && rings[c.control];
      if (ring) {
        item.addEventListener('pointerenter', () => { layer.classList.add('btx-welcome-tracing'); ring.classList.add('btx-lit'); });
        item.addEventListener('pointerleave', () => { layer.classList.remove('btx-welcome-tracing'); ring.classList.remove('btx-lit'); });
      }
      items.push({ item, control: c.control });
      list.appendChild(item);
    }
    const done = el('button', 'btx-cta btx-welcome-done', WELCOME_COPY.gotIt);
    done.addEventListener('click', onGotIt);
    dialog.appendChild(title);
    dialog.appendChild(list);
    dialog.appendChild(done);
    sheet.appendChild(dialog);
    layer.appendChild(sheet);
    // Esc is not Got it, and must not reach the talk reader's Back either.
    layer.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopPropagation(); });
    return { layer, sheet, list, items, rings };
  }

  // The extension's own toolbar icon, drawn where the toolbar line names it.
  function extensionIcon() {
    const img = el('img', 'btx-welcome-icon');
    img.alt = 'Translations & Citations';
    img.width = 16;
    img.height = 16;
    try { img.src = chrome.runtime.getURL('icons/icon-32.png'); } catch (e) { /* extension reloaded: the alt text stands */ }
    return img;
  }

  // Measure, then place: the sheet starts where the body does (below
  // whichever chrome rows show); each bubble and ring goes where
  // calloutPlacement puts it for its control's rect, in the layer's
  // coordinates. A control not showing gets a plain line and no ring.
  function placeWelcome() {
    if (!welcome) return;
    const { layer, sheet, list, items, rings } = welcome;
    sheet.style.top = `${ui.body.offsetTop}px`;
    const base = layer.getBoundingClientRect();
    const rel = (r) => ({ left: r.left - base.left, top: r.top - base.top, width: r.width, height: r.height });
    const boxes = {};
    const boxOf = (name) => {
      if (!(name in boxes)) boxes[name] = unionRect(controlNodes(name).map((n) => rel(n.getBoundingClientRect())));
      return boxes[name];
    };
    const listBox = { left: list.getBoundingClientRect().left - base.left, width: list.clientWidth };
    const panelBox = { width: base.width, height: base.height };
    for (const { item, control } of items) {
      const p = calloutPlacement({ control: control ? boxOf(control) : null, list: listBox, panel: panelBox });
      item.style.marginLeft = `${p.card.left}px`;
      item.style.width = `${p.card.width}px`;
      item.toggleAttribute('data-btx-pointing', p.caret !== null);
      if (p.caret !== null) item.style.setProperty('--btx-caret-x', `${p.caret}px`);
    }
    const names = Object.keys(rings);
    const placed = separateRings(names.map((n) => calloutPlacement({ control: boxOf(n), list: listBox, panel: panelBox }).ring));
    names.forEach((n, i) => {
      const ring = rings[n];
      const r = placed[i];
      ring.hidden = !r;
      if (!r) return;
      ring.style.left = `${r.left}px`;
      ring.style.top = `${r.top}px`;
      ring.style.width = `${r.width}px`;
      ring.style.height = `${r.height}px`;
    });
  }

  // Re-place once per frame on any size change the placement reads: the
  // panel (a drag), the chrome rows and their controls, the body's top and
  // the list's width (a scrollbar appearing in the sheet).
  function schedulePlaceWelcome() {
    if (!welcome || welcome.frame) return;
    welcome.frame = requestAnimationFrame(() => { if (welcome) { welcome.frame = 0; placeWelcome(); } });
  }

  function openWelcome() {
    welcome = Object.assign(buildWelcome(), { observer: null, frame: 0 });
    ui.panel.appendChild(welcome.layer);
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(schedulePlaceWelcome);
      for (const node of [ui.panel, ui.header, ui.toolbar, ui.body, welcome.list]) observer.observe(node);
      for (const name of CONTROL_NAMES) for (const node of controlNodes(name)) observer.observe(node);
      welcome.observer = observer;
    }
    placeWelcome();
    welcome.layer.querySelector('[role="dialog"]').focus({ preventScroll: true });
  }

  // Collapse, hide or Got it on another computer. Focus inside it goes to
  // the panel's first control rather than to the page's top.
  function closeWelcome() {
    const { layer, observer, frame } = welcome;
    const hadFocus = layer.contains(document.activeElement);
    welcome = null;
    if (observer) observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    layer.remove();
    if (hadFocus && visible && !state.collapsed) firstControl().focus({ preventScroll: true });
  }

  function firstControl() {
    return ui.controls['translation-tab'][0];
  }

  function onGotIt() {
    if (setWelcomeSeen(state, true)) persist({ welcomeSeen: true });
    applyWelcomeUI();
    firstControl().focus({ preventScroll: true });
  }

  // The nodes a CONTROL_NAMES name stands for (empty for an unknown name or
  // before the panel is built): what a callout points at.
  function controlNodes(name) {
    return (ui && ui.controls[name]) ? ui.controls[name].slice() : [];
  }

  // The reader's text-size multiplier. It is a *second* variable rather than a
  // pre-multiplied size because theme.js owns --btx-size and rewrites it
  // whenever the site's own font-size changes: the two compose in CSS
  // (--btx-body-size), so neither write can clobber the other and a theme
  // re-apply that captured the same site size still writes nothing.
  function applyFontScale(scale) {
    // Through the module's own normalizer, not a second clamp here: a bad value
    // would otherwise reach the CSS var and take the whole body's font-size
    // down with it (unlike clampWidth, which exists for raw drag pixels).
    const safe = SETTINGS().normalize({ fontScale: scale }).fontScale;
    const replace = safe !== fontScale ? holdReadingPlace() : null;
    fontScale = safe; // the applied value, and what the header steps from
    ui.rootEl.style.setProperty('--btx-size-scale', String(safe));
    if (replace) replace();
    applyFontStepUI();
    return safe; // so a caller persists what was applied, not what it asked for
  }

  // The text the reader is on, before a size change reflows it: returns what
  // puts it back afterwards (or null — nothing mounted to keep). A view that
  // owns its scroll keeps its anchor's distance from the body's top
  // (keptScrollTop); page-synced Translation is placed against the page again,
  // unless the reader has scrolled it away from the page.
  function holdReadingPlace() {
    if (!ui || !visible || state.collapsed || !views.active) return null;
    if (!viewRestoresScroll(views.active, scrollSync) && !syncDetached) return () => syncNow({ animate: false });
    const anchorTop = readingAnchor();
    if (!anchorTop) return null;
    const before = anchorTop();
    return () => {
      const after = anchorTop();
      if (after === null) return;
      setBodyScroll(keptScrollTop({ scrollTop: ui.body.scrollTop, before, after, maxScroll: maxBodyScroll() }));
    };
  }

  // What the reader is on: the cited passage while it is on screen, else the
  // first text in flow at the top of the body (below any pinned header) — to
  // the character, since one Journal of Discourses paragraph can run for
  // screens. -> a function reading its viewport top (null once it is gone),
  // or null.
  function readingAnchor() {
    const node = viewNode();
    if (node === ui.body || !node.isConnected) return null;
    const box = ui.body.getBoundingClientRect();
    if (!(box.height > 0 && box.width > 0)) return null;
    const topOf = (n) => () => (n.isConnected ? n.getBoundingClientRect().top : null);
    const mark = node.querySelector('.btx-cit-highlight');
    if (mark) {
      const r = mark.getBoundingClientRect();
      if (r.bottom > box.top && r.top < box.bottom) return topOf(mark);
    }
    const x = box.left + box.width / 2;
    for (let y = box.top + 1; y < box.bottom; y += 8) {
      const hit = document.elementFromPoint(x, y);
      if (!hit || hit === node || !node.contains(hit) || pinnedIn(hit, node)) continue;
      const caret = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
      const text = caret && caret.startContainer;
      if (text && text.nodeType === 3 && hit.contains(text) && caret.startOffset < text.length) {
        const range = document.createRange();
        range.setStart(text, caret.startOffset);
        range.setEnd(text, caret.startOffset + 1);
        return () => (text.isConnected ? range.getBoundingClientRect().top : null);
      }
      return topOf(hit);
    }
    return null;
  }

  // Inside something that stays put while the body scrolls (a sticky header)?
  function pinnedIn(n, stop) {
    for (; n && n !== stop; n = n.parentElement) {
      const pos = getComputedStyle(n).position;
      if (pos === 'sticky' || pos === 'fixed') return true;
    }
    return false;
  }

  // The grid the header's stepper walks. Read from the settings module every
  // time rather than captured, so the bounds have exactly one owner.
  function fontScaleBounds() {
    const S = SETTINGS();
    return { min: S.FONT_SCALE_MIN, max: S.FONT_SCALE_MAX, step: S.FONT_SCALE_STEP };
  }

  // A stepper button is spent when its direction would change nothing — the
  // same rule that decides where a click lands, so the disabled state cannot
  // disagree with what a click would do.
  function applyFontStepUI() {
    const bounds = fontScaleBounds();
    ui.smaller.disabled = stepFontScale(fontScale, -1, bounds) === null;
    ui.larger.disabled = stepFontScale(fontScale, 1, bounds) === null;
    // The last step in a direction disables the very button that was just
    // pressed. A disabled element drops focus to the document, stranding a
    // keyboard user mid-adjustment, so hand focus to the other end of the
    // stepper — which is by definition still live, since the two ends cannot
    // both be spent.
    if (document.activeElement === ui.smaller && ui.smaller.disabled) ui.larger.focus();
    else if (document.activeElement === ui.larger && ui.larger.disabled) ui.smaller.focus();
  }

  function persist(partial) {
    try { SETTINGS().patch(partial); } catch (e) { /* storage unavailable — state still applied */ }
  }

  function requestRender() {
    cbs.renderMode && cbs.renderMode(effectiveMode(state));
  }

  // ---- User actions --------------------------------------------------------

  // A click is saved on any chapter (the arrangement's `saves`); one that
  // repeats the stored mode writes nothing.
  function onModeClick(m) {
    const preferred = state.mode;
    const changed = selectMode(state, m);
    if (state.mode !== preferred) persist({ panelMode: state.mode });
    if (!changed) return;
    applyModeUI();
    requestRender();
  }

  function onCitViewClick(v) {
    if (!selectCitationView(state, v)) return;
    applyCitationViewUI();
    persist({ citationView: state.citationView });
    requestRender();
  }

  // A− / A+. Applied first so the text resizes on the click, then persisted —
  // and what is persisted is what applyFontScale actually applied, so a raw
  // step can never be stored as a value the CSS never showed. The write is a
  // normal settings patch: it carries the panel's own-write tag, and an open
  // options form adopts the new value through its own subscription. The echo
  // re-applies the same scale (fontScale sits above onSettingsChange's `own`
  // guard, with width and the other pure-appearance keys), which is a no-op.
  // Body text only — nothing here re-renders, the CSS vars do the work.
  function onFontStep(dir) {
    const next = stepFontScale(fontScale, dir, fontScaleBounds());
    if (next === null) return; // spent end: no write, no echo
    persist({ fontScale: applyFontScale(next) });
  }

  // Focus follows the control across the swap: a keyboard user who collapses
  // lands on the tab, and on Collapse again when expanding. Focus elsewhere
  // (the toolbar icon, a synced change) is left where it is.
  function setCollapsed(collapsed) {
    const c = collapsed === true;
    if (state.collapsed === c) return;
    const hadFocus = ui.rootEl.contains(document.activeElement);
    state.collapsed = c;
    applyCollapsedUI(); // an expand may bring the welcome back, which takes focus
    if (hadFocus && !(welcome && !c)) (c ? ui.tab : ui.collapse).focus();
    persist({ panelCollapsed: c });
  }

  // ---- Lifecycle -----------------------------------------------------------

  // One-time migration of the legacy chrome.storage.local keys into the
  // settings module. Resolves once the settings hold the migrated values.
  function migrateLegacyLocal() {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      try {
        chrome.storage.local.get([LEGACY_MODE_KEY, LEGACY_COLLAPSED_KEY], async (d) => {
          try {
            const partial = {};
            if (d && d[LEGACY_MODE_KEY] !== undefined) partial.panelMode = d[LEGACY_MODE_KEY];
            if (d && d[LEGACY_COLLAPSED_KEY] !== undefined) partial.panelCollapsed = d[LEGACY_COLLAPSED_KEY];
            if (Object.keys(partial).length) {
              await SETTINGS().patch(partial); // normalizes any legacy garbage
              chrome.storage.local.remove([LEGACY_MODE_KEY, LEGACY_COLLAPSED_KEY], finish);
              return;
            }
          } catch (e) { /* fall through */ }
          finish();
        });
      } catch (e) { finish(); }
    });
  }

  // Another context (options page, a synced machine, or our own patch echo)
  // changed the settings. Width and text size are pure appearance — always
  // applied. State we already applied before persisting is skipped
  // via `own`; a genuinely external state change is adopted and, if it makes
  // the mounted content stale, triggers a re-render.
  function onSettingsChange({ next, changed, own }) {
    if (changed.includes('sidebarWidth')) applyWidth(next.sidebarWidth);
    if (changed.includes('fontScale')) applyFontScale(next.fontScale);
    if (own) return;
    // Got it on another computer, or "Show the welcome again".
    if (changed.includes('welcomeSeen') && setWelcomeSeen(state, next.welcomeSeen)) applyWelcomeUI();
    // When the same write also moved a key the panel doesn't handle, the
    // orchestrator's own settings subscriber will do a full re-render — firing
    // renderMode too would race two renders into the same body.
    const orchestratorWillRender = changed.some((k) => !PANEL_HANDLED_KEYS.includes(k));
    let contentStale = false;
    if (changed.includes('citationView') && next.citationView !== state.citationView) {
      state.citationView = next.citationView;
      applyCitationViewUI();
      if (effectiveMode(state) === 'citations') contentStale = true;
    }
    if (changed.includes('panelMode') && next.panelMode !== state.mode) {
      const before = effectiveMode(state);
      state.mode = next.panelMode;
      state.click = null; // the reader chose elsewhere: this visit's click is spent
      applyModeUI();
      if (effectiveMode(state) !== before) contentStale = true;
    }
    if (changed.includes('panelCollapsed') && next.panelCollapsed !== state.collapsed) {
      state.collapsed = next.panelCollapsed;
      applyCollapsedUI();
    }
    // Switching sync off leaves the body exactly where it is and stops the page
    // reaching it; switching it back on re-asserts the predicate, and attaching
    // syncs immediately rather than waiting for the user's next page scroll.
    // Content is unaffected either way — this changes who moves the body, not
    // what is in it.
    if (changed.includes('scrollSync') && next.scrollSync !== scrollSync) {
      scrollSync = next.scrollSync;
      refreshScrollSync(); // one of the predicate's four inputs just moved
    }
    if (contentStale && visible && !orchestratorWillRender) requestRender();
  }

  async function init(handlers) {
    Object.assign(cbs, handlers || {});
    ensureRoot();
    await migrateLegacyLocal();
    const s = await SETTINGS().get();
    state = createState({ mode: s.panelMode, citationView: s.citationView, collapsed: s.panelCollapsed, welcomeSeen: s.welcomeSeen });
    scrollSync = s.scrollSync; // before applyModeUI: it asserts the sync predicate
    applyWidth(s.sidebarWidth);
    applyFontScale(s.fontScale);
    applyModeUI();
    applyCitationViewUI();
    applyCollapsedUI();
    SETTINGS().subscribe(onSettingsChange);
  }

  function showChapter(ctx) {
    ensureRoot();
    stopBodyScroll(); // a chase aimed at the outgoing chapter dies with it
    // Another chapter invalidates every cached view. The same one again (a
    // settings change) keeps Citations and the talk — filter, open groups,
    // scroll — and drops only Translation, whose inputs are what changed.
    dropViews(views, sameChapter(state, ctx) ? SAME_CHAPTER_VIEWS : null);
    visible = true;
    ui.rootEl.style.display = '';
    setChapter(state, ctx);
    applyModeUI();
    updatePageReserve();
    applyWelcomeUI();
    scheduleTopChecks(); // the site may re-lay its header out after navigating
    return arrangementOf(state);
  }

  // An input of the chapter showing moved (the chapter check settled, a pick,
  // the split layout): the arrangement again, with no view dropped.
  function arrange(facts) {
    ensureRoot();
    setChapter(state, Object.assign({}, facts, { key: state.chapter }));
    applyModeUI();
    return arrangementOf(state);
  }

  function hide() {
    if (!ui) return;
    visible = false;
    ui.rootEl.style.display = 'none';
    refreshScrollSync(); // `visible` just moved — one of the predicate's inputs
    updatePageReserve();
    applyWelcomeUI();
  }

  // ---- The body's scroll position -------------------------------------------
  // Every move of .btx-body's scrollTop goes through here: scroll-sync, view
  // placement, restore, and scrollIntoView. That is what makes "the panel is
  // the only writer" checkable rather than aspirational, and it is where the
  // no-snap rule lives — a move eases unless it is *placement* (a view that
  // just mounted, so there is no previous position to ease from) or the user
  // asked the system for reduced motion.

  const SCROLL_OWN_PX = 1; // slack for the browser's own sub-pixel rounding
  // { target, raf, last, started, wasAt } while re-aligning
  let bodyAnim = null;
  let lastWrittenTop = null; // where our last write left the body
  // True once the user has scrolled the panel away from the page's position.
  // While detached the panel keeps whatever position the user gave it; the next
  // page scroll eases it back, and that is the only animation in the module.
  let syncDetached = false;

  // The one and only assignment to the body's scroll position. Reads the value
  // back rather than trusting what we asked for: the browser clamps to the
  // scrollable range, and the clamped number is what the resulting 'scroll'
  // event will report, so it is what tells our own writes from the user's.
  function writeBodyScroll(px) {
    ui.body.scrollTop = px;
    lastWrittenTop = ui.body.scrollTop;
  }

  // The user scrolled the panel themselves. Stop fighting them: drop any
  // in-flight re-alignment and leave the body where they put it.
  function onBodyScrolled() {
    if (!ui || !isForeignScroll(ui.body.scrollTop, lastWrittenTop, SCROLL_OWN_PX)) return;
    stopBodyScroll();
    syncDetached = true;
  }

  function maxBodyScroll() {
    return Math.max(0, ui.body.scrollHeight - ui.body.clientHeight);
  }

  // The one place the body's scrollable range is applied.
  function clampToBody(px) {
    return Math.max(0, Math.min(maxBodyScroll(), Number(px) || 0));
  }

  function stopBodyScroll() {
    if (!bodyAnim) return;
    cancelAnimationFrame(bodyAnim.raf);
    bodyAnim = null;
  }

  // Read the live position each frame rather than integrating our own: the
  // browser may clamp it (content shorter than we thought) and the user may
  // scroll the body by hand mid-flight. Either way the chase continues from
  // where the body actually is.
  function stepBodyScroll(ts) {
    if (!ui || !bodyAnim) return;
    const from = ui.body.scrollTop;
    // Re-clamp every frame, not just at the start: if the body shrinks while
    // we're chasing (a render finishing, a filter hiding rows), a target past
    // the new bottom is one the browser will never let us reach — and the
    // settle test would never pass, leaving the rAF loop running forever.
    // Clamp for *this frame* only: `bodyAnim.target` stays the position the page
    // asked for, so the next carry can still subtract two figures in the same
    // coordinates. Writing the clamp back would make that difference something
    // other than how far the page moved, and the carry would apply it.
    const target = clampToBody(bodyAnim.target);
    if (!bodyAnim.started) bodyAnim.started = ts;
    // How far the body actually travelled last frame — not how far we asked it
    // to. The difference is the whole point: see realignmentDone.
    const moved = bodyAnim.wasAt === null ? null : from - bodyAnim.wasAt;
    if (realignmentDone({
      distance: target - from,
      moved,
      elapsed: ts - bodyAnim.started,
    }, SCROLL_LIMITS)) {
      writeBodyScroll(target);
      stopBodyScroll();
      syncDetached = false; // caught up with the page — track it 1:1 again
      return;
    }
    const dt = bodyAnim.last ? Math.max(0, ts - bodyAnim.last) : 16;
    bodyAnim.last = ts;
    bodyAnim.wasAt = from;
    const ramp = easeRamp(ts - bodyAnim.started, SCROLL_RAMP_MS);
    const eased = scrollStep(from, target, dt, SCROLL_TAU_MS, ramp);
    writeBodyScroll(floorStep(from, eased, target, SCROLL_MIN_STEP_PX));
    bodyAnim.raf = requestAnimationFrame(stepBodyScroll);
  }

  //   animate  ease toward `top` instead of landing on it. Only scroll-sync's
  //            re-alignment sets it; nothing else in the panel animates.
  function setBodyScroll(top, opts) {
    if (!ui) return;
    const target = clampToBody(top);
    if (!(opts && opts.animate)) {
      stopBodyScroll();
      writeBodyScroll(target);
      return;
    }
    // The target moved while we're re-aligning — the page scrolled again. Carry
    // the body the same distance right now (1:1, no easing) and the gap the
    // chase is closing is unchanged, so it keeps both its ramp and its
    // schedule. Anything else leaves the panel trailing the page for as long as
    // the scrolling lasts.
    if (bodyAnim) {
      if (target !== bodyAnim.target) {
        const at = ui.body.scrollTop;
        const to = carryScroll(at, bodyAnim.target, target, maxBodyScroll());
        writeBodyScroll(to);
        // Move the mark the stall test measures from by however much of the
        // carry the body actually took (it may have been at the top or bottom),
        // so `moved` next frame is still the chase's own travel and nothing
        // else. Dropping the mark instead would blind the stall test for the
        // whole gesture — a page scroll carries on nearly every frame — and the
        // sub-pixel stranding it exists to catch would be back.
        if (bodyAnim.wasAt !== null) bodyAnim.wasAt += to - at;
        bodyAnim.target = target;
      }
      return;
    }
    bodyAnim = { target, last: 0, started: 0, wasAt: null, raf: requestAnimationFrame(stepBodyScroll) };
  }

  // ---- View host -------------------------------------------------------------
  // The body holds exactly one view container at a time. Callers never receive
  // or hand back DOM: they name a view and describe how to build it, and the
  // host decides between building and re-mounting what it already has.

  function mountView(entry) {
    stopBodyScroll(); // a chase aimed at the outgoing view must not survive it
    ui.body.textContent = '';
    ui.body.appendChild(entry.node);
    setCard(null); // a card belongs to the view that drew it
    placeNote();
  }

  // ---- The note slot ----------------------------------------------------------
  // One quiet line at the top of the body, above the mounted view (never inside
  // it: a view re-renders and re-mounts from its cache, a line must not). The
  // orchestrator names the arrangement's note (setNote); the line shows while
  // the view it belongs to (noteCopy's `view`) is the one mounted, and goes
  // with any other. Its buttons are the panel's own verbs: Add a language is a
  // Translation click on this visit, × asks the orchestrator to dismiss,
  // Change swaps the line for the layout control (the beside card's) in the
  // same place, open until the line goes.
  // { key, copy, node, layout, control }: what the orchestrator last named;
  // `control` is the layout control once Change opened it.
  let note = null;
  let shownNote = null; // the line's node while it is on the body

  function buildNote(copy) {
    const node = el('p', 'btx-note');
    node.appendChild(el('span', 'btx-note-text', copy.text));
    for (const a of copy.actions) {
      node.appendChild(document.createTextNode(' '));
      const b = button(a.id === 'dismiss' ? 'btx-note-x' : 'btx-link btx-note-link', a.label, () => onNoteAction(a.id));
      if (a.title) labelled(b, a.title);
      node.appendChild(b);
    }
    return node;
  }

  function onNoteAction(id) {
    if (id === 'add') onModeClick('translation');
    else if (id === 'dismiss' && cbs.onDismissNote) cbs.onDismissNote();
    else if (id === 'change') openNoteLayouts();
  }

  // Change: the layout control in the line's place, no new row. Focus goes
  // to its pressed choice, where the keyboard user's Change was; the body
  // stays where it is (setBodyScroll is its one writer, so focus() must not
  // scroll it).
  function openNoteLayouts() {
    if (!note || note.control) return;
    const control = layoutControl(() => note.layout, `Where to show ${note.language}`, {
      effective: () => splitFit.effective,
      explain: () => { note.nudged = true; pressNote(); },
    });
    const node = el('div', 'btx-note btx-note-tools');
    node.appendChild(control.group);
    const hint = el('span', 'btx-note-hint');
    hint.setAttribute('role', 'status');
    node.appendChild(hint);
    const was = note.node;
    Object.assign(note, { node, control, hint });
    pressNote();
    if (shownNote === was) {
      was.replaceWith(node);
      shownNote = node;
      focusPressedLayout(control, { preventScroll: true });
    }
  }

  // Restate the open Change control in place (never rebuilt: a keyboard user's
  // focus is on it): it presses the layout the page shows, and after a click on
  // Side by side that has no room it says why in its own line.
  function pressNote() {
    if (!note || !note.control) return;
    if (note.layout !== note.nudgedFor) Object.assign(note, { nudged: false, nudgedFor: note.layout });
    const hint = note.nudged ? roomHint(Object.assign({ layout: note.layout, sheet: inSheet() }, splitFit)) : '';
    if (hint !== note.hint.textContent) {
      keepPlace(() => {
        note.hint.textContent = hint;
        note.hint.hidden = !hint;
      });
    }
    note.control.press();
  }

  // Take the line off the body (focus stays in the panel when the button the
  // reader pressed goes with it), and put it back above the view now mounted
  // when that is the view it belongs to.
  function placeNote() {
    if (!ui) return;
    if (shownNote) {
      if (shownNote.contains(document.activeElement)) ui.body.focus();
      shownNote.remove();
      shownNote = null;
    }
    if (note && views.active === note.copy.view && viewNode() !== ui.body) {
      shownNote = note.node;
      ui.body.insertBefore(note.node, ui.body.firstChild);
    }
  }

  // Show `n` ({ kind, row, chapter, layout }) or, with null, no line.
  // `layout` is the split layout an opened Change control presses. The same
  // line again changes nothing but that: an open control re-presses in place
  // (focus stays on it). One coming or going keeps the reader's place.
  function setNote(n) {
    ensureRoot();
    const copy = noteCopy(n);
    const key = copy ? JSON.stringify(copy) : null;
    if ((note ? note.key : null) === key) {
      if (note) note.layout = n.layout;
      if (note && note.control) {
        pressNote();
        refocusLayout = false; // restated in place: focus never left
      }
      return;
    }
    keepPlace(() => {
      note = copy ? { key, copy, node: buildNote(copy), layout: n.layout, language: copy.language, control: null } : null;
      placeNote();
    });
  }

  // Run `change` (the note slot growing or shrinking above the mounted view)
  // and keep the reader's place: the body scrolls by as far as the view moved.
  function keepPlace(change) {
    const view = views.active && views.entries[views.active];
    const top = () => (view && view.node ? view.node.getBoundingClientRect().top : 0);
    const before = top();
    change();
    const moved = top() - before;
    if (moved && ui && ui.body.scrollTop > 0) setBodyScroll(ui.body.scrollTop + moved);
  }

  // Position a view that has just mounted, twice: once now and once next frame.
  // A freshly mounted body can still be reflowing (web fonts, re-applied
  // highlights, a translation still growing) when the first pass lands, and its
  // scroll height is what both callers below measure against. The second pass
  // is skipped if the view was swapped out again in between.
  // A view's own reveal (scrollIntoView) outranks a placement still pending
  // for it: a list re-mounted and then revealed at the verse being read must
  // not be put back at its old offset a frame later.
  let placement = 0;
  function placeOnMount(node, apply) {
    const mine = ++placement;
    apply();
    afterFrames(1, () => {
      if (mine === placement && ui && node && ui.body.contains(node)) apply();
    });
  }

  // A scroll-owning view comes back to the offset it was left at.
  function restoreScroll(entry) {
    placeOnMount(entry.node, () => setBodyScroll(entry.scrollTop));
  }

  // A page-synced view has no saved offset: it is placed where the page
  // currently sits. Instant — the content is appearing for the first time, so
  // there is nothing to ease from.
  function placeSyncedView(node) {
    placeOnMount(node, () => syncNow({ animate: false }));
  }

  // Mount the named view.
  //   name    'translation' | 'citations' | 'talk' — one cache slot each
  //   key     content identity; a different key rebuilds
  //   cache   false for a view that must never be re-mounted
  //   render(node)  fills the fresh container; may be async. Called only on a
  //                 rebuild, and only after the container is in the document.
  // Returns render's result (so callers can await it), or undefined on a hit.
  function showView(spec) {
    ensureRoot();
    saveViewScroll(views, ui.body.scrollTop);
    const { action, entry } = selectView(views, spec.name, spec.key, spec.cache);
    const restores = viewRestoresScroll(spec.name, scrollSync);
    if (action === 'restore') {
      // Already on screen (the same view asked for again): leave it be, so
      // focus, a half-typed filter and the scroll stay exactly where they are.
      if (entry.node.parentNode === ui.body) return undefined;
      mountView(entry);
      if (restores) restoreScroll(entry);
      else placeSyncedView(entry.node);
      return undefined;
    }
    entry.node = el('div', 'btx-view');
    mountView(entry);
    setBodyScroll(0);
    // A page-synced view is placed once it has content — see showTranslation.
    // A slow render whose view was swapped out meanwhile writes into a detached
    // container — it can no longer paint over whatever replaced it, and it only
    // caches what it actually left behind (see settleView).
    const settle = (ok) => settleView(entry, ok && entry.node.childElementCount > 0);
    const out = spec.render ? spec.render(entry.node) : undefined;
    if (out && typeof out.then === 'function') {
      return out.then(
        (r) => { settle(true); return r; },
        (err) => { settle(false); throw err; },
      );
    }
    settle(true);
    return out;
  }

  // The container the mounted view renders into. Falls back to the body itself
  // so a stray call before any showView still shows something.
  function viewNode() {
    const e = views.active && views.entries[views.active];
    return (e && e.node) || ui.body;
  }

  function afterFrames(n, fn) {
    if (!(n > 0)) { fn(); return; }
    requestAnimationFrame(() => afterFrames(n - 1, fn));
  }

  // Scroll the body so `target` is readable *in context* — see revealTop for
  // where it lands and why. Views request scrolls through here rather than
  // writing scrollTop, so the host stays the one writer — and a scroll aimed at
  // a view that has since been swapped out is dropped instead of moving
  // whatever replaced it.
  //   clearTop  px of sticky chrome at the top of the body that must not cover
  //             the target (the talk reader's header)
  //   frames    defer the measurement N animation frames, for layout to settle
  //
  // Instant, not eased: every caller reveals its target as part of opening the
  // view (the talk reader's cited passage, the citations focus verse), so the
  // target should already be on screen when the view first paints — easing
  // there would mean watching the panel scroll through content the user never
  // asked to see.
  function scrollIntoView(target, opts) {
    const o = opts || {};
    // This reveal is where the mounted view goes, not a pending placement. (A
    // stale view's reveal, aimed into a container already swapped out, leaves
    // the mounted view's placement alone.)
    if (ui && target && ui.body.contains(target)) ++placement;
    afterFrames(o.frames || 0, () => {
      if (!ui || !target || !ui.body.contains(target)) return;
      const delta = target.getBoundingClientRect().top - ui.body.getBoundingClientRect().top;
      setBodyScroll(revealTop({
        targetTop: ui.body.scrollTop + delta,
        viewportH: ui.body.clientHeight,
        maxScroll: maxBodyScroll(),
        clearTop: o.clearTop,
      }));
    });
  }

  // ---- Body content (translation mode) --------------------------------------

  // Which card, if any, the mounted view is showing: 'setup' | 'beside' | null.
  // Mirrored onto the root so the chrome can make room for it — neither card
  // is text the A− / A+ stepper sizes (the split takes the site's own size),
  // and the setup card has no dropdown to show either.
  function setCard(kind) {
    if (!ui) return;
    if (kind) ui.rootEl.setAttribute('data-btx-card', kind);
    else ui.rootEl.removeAttribute('data-btx-card');
  }

  function clearBody() {
    viewNode().textContent = '';
    setCard(null);
    beside = null;
  }

  // A centred state (loading, waiting, error). The container is a polite live
  // region, so a screen reader hears the state that replaced the last one.
  function stateWrap(cls) {
    const wrap = el('div', 'btx-state' + (cls ? ' ' + cls : ''));
    wrap.setAttribute('role', 'status');
    return wrap;
  }

  function button(cls, text, onClick) {
    const b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  // The split's fit as the page split last reported it (updateBeside), kept
  // whether or not a beside card is on screen: the line's Change control
  // presses by it too. `effective` null until measured.
  const splitFit = { effective: null, collapseFits: null };

  // The beside card on screen: { node, name, layout, effective, parts }, so the
  // layout control and the page split can restate it in place (updateBeside)
  // without rebuilding it under a keyboard user's focus.
  let beside = null;
  // A keyboard pick that rebuilds the view — a layout moving the text between
  // the page and the panel, or a language added from the setup card — would
  // drop focus out of the panel with the control it was on. The rebuilt view's
  // layout control (its pressed choice, on the beside card or above the text
  // in the panel) takes it instead.
  let refocusLayout = false;

  // The pick goes to the orchestrator with the row it makes the pick
  // (layoutChoice: the page's language, moving into the panel).
  function pickLayout(value) {
    refocusLayout = !!ui && ui.rootEl.contains(document.activeElement);
    if (cbs.onLayoutChange) cbs.onLayoutChange(value, layoutChoice(arrangementOf(state), value));
  }

  // Where a Church language shows (LAYOUTS), as one segmented control: on the
  // beside card, above the text when it is read in the panel, and in the
  // beside-the-page line's place (its Change). `current()` is the reader's
  // setting; the segment pressed is the layout the page shows
  // (`host.effective()`, the split's fit; pressedLayout), which differs while
  // side by side has no room. A click is judged by layoutClick: it writes the
  // setting, does nothing, or (`host.explain()`) answers that the setting
  // already is this one and says what would make room.
  function layoutControl(current, label, host) {
    const effective = () => (host && host.effective ? host.effective() : null);
    const choices = LAYOUTS.map(([value, text]) => {
      const b = button('btx-seg-btn', text, () => {
        const what = layoutClick({ layout: current(), effective: effective(), value });
        if (what === 'write') pickLayout(value);
        else if (what === 'explain' && host && host.explain) host.explain();
      });
      b.dataset.btxLayout = value;
      return b;
    });
    const press = () => {
      const shown = pressedLayout(current(), effective());
      for (const b of choices) setPressed(b, b.dataset.btxLayout === shown);
    };
    press();
    return { group: segmented('btx-seg', label || 'Where to show it', choices), choices, press };
  }

  // `opts` is focus()'s: { preventScroll } where the control replaces what
  // the reader pressed in place, so moving focus must not move the body.
  function focusPressedLayout(control, opts) {
    const pressed = control.choices.find((b) => b.getAttribute('aria-pressed') === 'true');
    if (pressed) pressed.focus(opts);
  }

  function buildBeside(card) {
    const parts = {};
    parts.status = el('p', 'btx-card-title');
    parts.status.setAttribute('role', 'status');
    card.node.appendChild(parts.status);
    parts.layouts = layoutControl(() => card.layout, undefined, {
      effective: () => card.effective,
      explain: () => {
        // The note is already on screen; clearing it for a frame makes the
        // status region announce it again to a reader who can't see it.
        card.nudged = true;
        card.parts.note.textContent = '';
        requestAnimationFrame(() => fillBeside(card));
      },
    });
    card.node.appendChild(parts.layouts.group);
    parts.note = el('p', 'btx-card-hint');
    parts.note.setAttribute('role', 'status');
    card.node.appendChild(parts.note);
    parts.collapse = button('btx-btn-outline btx-widen', '', () => setCollapsed(true));
    card.node.appendChild(parts.collapse);
    card.parts = parts;
  }

  function fillBeside(card) {
    const copy = besideCopy(Object.assign({}, card, { sheet: inSheet() }));
    const p = card.parts;
    p.status.textContent = copy.status;
    p.layouts.press();
    p.note.textContent = copy.note;
    p.note.hidden = !copy.note;
    p.collapse.textContent = copy.collapse || '';
    p.collapse.hidden = !copy.collapse;
  }

  // Restate the mounted beside card: the reader picked another in-page layout
  // (`layout`), or the page split fit a different one (`effective`,
  // `collapseFits` — a resize, the panel collapsing), or the window crossed
  // into or out of the bottom sheet (no change given). A no-op while no beside
  // card is on screen.
  function updateBeside(change) {
    if (!ui) return;
    const c = change || {};
    const was = beside && ui.body.contains(beside.node) ? beside : null;
    if (c.layout === 'columns' || c.layout === 'interlinear') {
      if (c.layout !== (was ? was.layout : note && note.layout)) Object.assign(splitFit, { effective: null, collapseFits: null }); // the split lays out afresh
      if (was) Object.assign(was, { layout: c.layout, nudged: false });
    }
    const before = [splitFit.effective, splitFit.collapseFits];
    if (c.effective !== undefined) splitFit.effective = c.effective;
    if (c.collapseFits !== undefined) splitFit.collapseFits = c.collapseFits;
    const moved = before[0] !== splitFit.effective || before[1] !== splitFit.collapseFits;
    refocusLayout = false; // restated in place: focus never left
    if (was) {
      Object.assign(was, splitFit);
      if (moved) was.nudged = false;
      fillBeside(was);
    }
    if (note && note.control) {
      if (moved) note.nudged = false;
      pressNote();
    }
  }

  // The setup card's language picker: a native <select> plus Add. Choosing in
  // the select only arms Add — a closed select changes its value on an arrow
  // key, so browsing the list must write nothing. Add, or Enter on the select,
  // turns the language on.
  function languagePicker(copy, langs) {
    const row = el('div', 'btx-card-row');
    const select = el('select', 'btx-card-select');
    select.setAttribute('aria-label', 'Church language to add');
    const prompt = el('option', null, copy.languages);
    prompt.value = '';
    prompt.disabled = true;
    prompt.selected = true;
    select.appendChild(prompt);
    for (const l of langs) {
      const opt = el('option', null, l.label);
      opt.value = l.code;
      select.appendChild(opt);
    }
    const add = button('btx-btn-outline btx-card-add', copy.add, () => commit());
    add.disabled = true;
    function commit() {
      if (!select.value || select.disabled) return;
      refocusLayout = row.contains(document.activeElement); // read before disabling drops it
      select.disabled = true; // one pick; the chapter re-renders with it
      add.disabled = true;
      if (cbs.onAddLanguage) cbs.onAddLanguage(select.value);
    }
    select.addEventListener('change', () => { add.disabled = !select.value; });
    select.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !select.value) return;
      e.preventDefault();
      commit();
    });
    row.appendChild(select);
    row.appendChild(add);
    return row;
  }

  function renderSetup(host, st) {
    const copy = setupCopy({ chapter: st.chapter, bible: st.bible });
    const card = el('div', 'btx-card btx-setup');
    card.appendChild(el('h2', 'btx-card-title', copy.heading));
    const langs = Array.isArray(st.languages) ? st.languages : [];
    if (langs.length) {
      const block = el('div', 'btx-card-block');
      block.appendChild(languagePicker(copy, langs));
      block.appendChild(el('p', 'btx-card-hint', copy.languagesDisclosure));
      block.appendChild(el('p', 'btx-card-hint', copy.languagesHint));
      card.appendChild(block);
    }
    if (copy.bible) {
      const block = el('div', 'btx-card-block');
      block.appendChild(el('p', 'btx-card-text', copy.bible.text));
      block.appendChild(button('btx-btn-outline', copy.bible.button, () => cbs.onGear && cbs.onGear('bible')));
      block.appendChild(el('p', 'btx-card-hint', copy.bible.disclosure));
      card.appendChild(block);
    }
    // The card goes with the mode; focus lands on the mode it switched to.
    const talks = button('btx-link', copy.talks, () => {
      const hadFocus = document.activeElement === talks;
      onModeClick('citations');
      if (hadFocus) ui.modeCitations.focus();
    });
    card.appendChild(talks);
    host.appendChild(card);
  }

  function renderError(host, st) {
    const copy = errorCopy(st);
    const wrap = stateWrap('btx-error');
    wrap.appendChild(el('p', 'btx-state-text', copy.message));
    if (copy.hint) wrap.appendChild(el('p', 'btx-state-hint', copy.hint));
    if (copy.action === 'settings') wrap.appendChild(button('btx-cta', 'Open settings', () => cbs.onGear && cbs.onGear('bible')));
    if (copy.action === 'retry') wrap.appendChild(button('btx-cta', 'Try again', () => cbs.onRetry && cbs.onRetry()));
    host.appendChild(wrap);
  }

  // Rate-limited: the orchestrator retries by itself; this only counts down to
  // it. The countdown is hidden from screen readers (a live region announcing
  // every second is noise) and stops once its view is gone.
  function renderWaiting(host, st) {
    const wrap = stateWrap('btx-loading');
    wrap.appendChild(el('div', 'btx-spinner'));
    wrap.appendChild(el('p', 'btx-state-text', 'Waiting for api.bible…'));
    const hint = el('p', 'btx-state-hint');
    hint.setAttribute('aria-hidden', 'true');
    wrap.appendChild(hint);
    host.appendChild(wrap);
    let left = Math.max(1, Math.ceil(Number(st.seconds) || 1));
    const tick = () => { hint.textContent = left > 0 ? `Trying again in ${left} s` : 'Trying again…'; };
    tick();
    const timer = setInterval(() => {
      left -= 1;
      if (!wrap.isConnected || left < 0) { clearInterval(timer); return; }
      tick();
    }, 1000);
  }

  function renderContent(host, st) {
    if (st.besideLink) {
      // Read in the panel: the same control as the beside card, to move it
      // back into the page.
      const tools = el('div', 'btx-article-tools');
      const layouts = layoutControl(() => 'panel');
      tools.appendChild(layouts.group);
      host.appendChild(tools);
      if (refocusLayout) focusPressedLayout(layouts);
    }
    refocusLayout = false;
    const article = el('div', 'btx-article');
    if (st.lang) article.lang = st.lang;
    if (st.dir) article.dir = st.dir;
    article.appendChild(SAN().renderBlocks(st.blocks));
    host.appendChild(article);
    // After the text, outside the article: it is the panel's English, not the
    // translation's language.
    if (st.copyright) host.appendChild(el('p', 'btx-copyright', st.copyright));
  }

  function showTranslation(st) {
    ensureRoot();
    const host = viewNode();
    const kind = st && st.kind;
    clearBody();
    if (kind !== 'loading' && kind !== 'beside' && kind !== 'content') refocusLayout = false;
    // Only a finished chapter is worth re-mounting; every other state must
    // render again (a spinner, an error to retry, a card that re-checks).
    keepView(views, kind === 'content');
    switch (kind) {
      case 'loading': {
        const wrap = stateWrap('btx-loading');
        wrap.appendChild(el('div', 'btx-spinner'));
        wrap.appendChild(el('p', 'btx-state-text', st.label ? `Loading ${st.label}…` : 'Loading…'));
        host.appendChild(wrap);
        return;
      }
      case 'waiting':
        renderWaiting(host, st);
        return;
      case 'setup':
        setCard('setup');
        renderSetup(host, st);
        return;
      case 'error':
        renderError(host, st);
        return;
      case 'beside': {
        setCard('beside');
        beside = {
          node: el('div', 'btx-card btx-beside'),
          name: st.name,
          layout: st.layout,
          effective: st.effective || null,
          collapseFits: st.collapseFits === undefined ? null : st.collapseFits,
        };
        Object.assign(splitFit, { effective: beside.effective, collapseFits: beside.collapseFits });
        buildBeside(beside);
        fillBeside(beside);
        host.appendChild(beside.node);
        if (refocusLayout) focusPressedLayout(beside.parts.layouts);
        refocusLayout = false;
        return;
      }
      case 'content':
        renderContent(host, st);
        // The chapter is only now measurable, so this is where the view gets
        // placed against the page. A no-op when the setting is off: syncNow
        // won't move a view that owns its scroll, and with sync off Translation
        // does — showView already put it at the top (fresh) or at the offset it
        // was left at (re-mounted). (No refreshScrollSync: none of its four
        // inputs moved — rendering content is not a state change.)
        placeSyncedView(viewNode());
    }
  }

  // The translation dropdown, from __BTX.churchText.menuFor: its groups, headed
  // or not as menuFor says. Empty, it hides — the setup card is showing. The
  // same rows again are only re-selected, not rebuilt (the background chapter
  // check restates them, perhaps while the reader has the select open).
  let menuShown = null;
  function populateTranslations(menu, selectedId) {
    ensureRoot();
    const groups = Array.isArray(menu) ? menu : [];
    const key = JSON.stringify(groups);
    if (key === menuShown && ui.select.options.length) {
      if (selectedId && ui.select.value !== selectedId) ui.select.value = selectedId;
      showSelectedTitle();
      return;
    }
    menuShown = key;
    ui.select.textContent = '';
    ui.select.hidden = !groups.some((g) => g.items && g.items.length);
    for (const g of groups) {
      let parent = ui.select;
      if (g.label) {
        parent = el('optgroup');
        parent.label = g.label;
        ui.select.appendChild(parent);
      }
      for (const item of g.items || []) {
        const opt = el('option', null, item.label);
        opt.value = item.id;
        parent.appendChild(opt);
      }
    }
    if (selectedId) ui.select.value = selectedId;
    showSelectedTitle();
  }

  function showSelectedTitle() {
    const opt = ui.select.selectedOptions && ui.select.selectedOptions[0];
    ui.select.title = opt ? opt.textContent : '';
  }

  // ---- Page reserve ----------------------------------------------------------
  // Reserve right-edge page space equal to the (expanded) panel width by adding a
  // margin to <html>, so the site's own right-docked UI (e.g. the footnote panel)
  // lays out to the LEFT of our panel instead of being hidden behind it. Our panel
  // is position:fixed, so it's unaffected by this margin.
  function updatePageReserve() {
    if (!ui) return;
    // On narrow viewports the panel is a full-width bottom sheet — never reserve
    // horizontal space there (it would push the page off-screen).
    const shown = ui.rootEl.style.display !== 'none';
    const reserve = !inSheet() && shown && !state.collapsed ? ui.rootEl.getBoundingClientRect().width : 0;
    try { document.documentElement.style.marginRight = reserve ? reserve + 'px' : ''; } catch (e) { /* ignore */ }
    pageReserve = reserve;
    updatePanelTop(); // the band just got narrower or wider: does it still fit?
  }

  // ---- The site's header band --------------------------------------------------
  // See panelTop for the rule. The band is found structurally (ADR-0005): the
  // outermost element at the top-left corner of the page, spanning most of
  // its width, less than half the window tall — found only while the page's
  // top is on screen, and kept while it stays in the document (the site keeps
  // its header across navigation). Checked where the band's width or layout
  // can move — the page reserve (show, hide, collapse, resize, the width) and
  // a while after each navigation or resize, when the site re-lays it out on
  // its own schedule — and, while the band overflows or hasn't been found, on
  // page scroll.
  const BAND_SLACK_PX = 8; // sub-pixel spill is not a header running under the panel
  const TOP_RECHECK_MS = [300, 1000, 2500];
  let pageReserve = 0;
  let topBand = null;
  let bandOverflows = false;
  let panelTopPx = 0;
  let topScrollBound = false;
  let topRaf = 0;
  let topTimers = [];

  function findTopBand() {
    if (topBand && topBand.isConnected) return topBand;
    topBand = null;
    const pageWidth = document.documentElement.clientWidth;
    let band = null;
    for (let n = document.elementFromPoint(4, 1); n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (ui.rootEl.contains(n)) return null;
      const r = n.getBoundingClientRect();
      if (r.height > 0 && r.top + window.scrollY <= 1 && r.height < window.innerHeight / 2 && r.width >= pageWidth / 2) band = n;
    }
    topBand = band;
    return band;
  }

  function updatePanelTop() {
    if (!ui) return;
    let top = 0;
    if (pageReserve > 0) {
      const band = findTopBand();
      bandOverflows = !!band && band.scrollWidth > band.clientWidth + BAND_SLACK_PX;
      if (band) top = panelTop({ reserve: pageReserve, overflows: bandOverflows, bottom: band.getBoundingClientRect().bottom });
    }
    if (top !== panelTopPx) {
      panelTopPx = top;
      if (top) ui.rootEl.style.setProperty('--btx-top', top + 'px');
      else ui.rootEl.style.removeProperty('--btx-top');
    }
    paintTopCap(top);
    watchTopScroll(pageReserve > 0);
  }

  // While the panel starts below the band, the strip above it is the bare
  // page background beside the band: an empty block (#89). The cap fills it
  // in the panel's header colour, so the panel's column reads as running to
  // the top. It sits beneath the site's header (fixed, z-index 0, outside
  // #btx-root's stacking context), so the band's controls that run over it —
  // Sign In, the account menu — stay on top and clickable. Gone with top 0.
  let topCap = null;
  function paintTopCap(top) {
    if (!top) {
      if (topCap) topCap.remove();
      topCap = null;
      return;
    }
    if (!topCap) {
      topCap = document.createElement('div');
      topCap.id = 'btx-top-cap';
      topCap.setAttribute('aria-hidden', 'true');
      topCap.style.cssText = 'position: fixed; top: 0; right: 0; z-index: 0; pointer-events: none;';
      document.body.appendChild(topCap);
    }
    topCap.style.width = pageReserve + 'px';
    topCap.style.height = top + 'px';
    topCap.style.background = getComputedStyle(ui.rootEl).getPropertyValue('--btx-header-bg').trim();
  }

  // Scrolling moves an overflowing band (and may bring an unfound one into
  // view); a band that fits can't start overflowing without a re-layout.
  function onTopScroll() {
    if (topRaf || !(bandOverflows || !topBand)) return;
    topRaf = requestAnimationFrame(() => { topRaf = 0; updatePanelTop(); });
  }

  function watchTopScroll(on) {
    if (on === topScrollBound) return;
    topScrollBound = on;
    if (on) window.addEventListener('scroll', onTopScroll, { passive: true });
    else window.removeEventListener('scroll', onTopScroll);
  }

  // The site re-lays its header out after a navigation or a resize on its own
  // schedule. (The band is found afresh too: it may have been replaced.)
  function scheduleTopChecks() {
    topBand = null;
    for (const t of topTimers) clearTimeout(t);
    topTimers = TOP_RECHECK_MS.map((ms) => setTimeout(updatePanelTop, ms));
  }

  // ---- Proportional scroll-sync with the main page ----
  // In Translation mode the page is the source of truth for where the body
  // sits, and the panel tracks it *instantly* — one write per page-scroll
  // frame, no easing — so following the page feels exactly like the browser's
  // own scrolling rather than like something chasing it.
  //
  // Easing appears in exactly one situation: the user has scrolled the panel
  // away from the page's position (`syncDetached`), and then scrolls the page
  // again. That is a real jump — the body has to travel from where the user
  // left it back to where the page now points — so it eases instead of
  // teleporting. Once it arrives, tracking is 1:1 again.
  //
  // Scrolling on through that re-alignment does not prolong it: the page's part
  // of the movement is handed to the body immediately (carryScroll) and only
  // the gap eases, on a schedule the page can't stretch.
  //   animate  force it off for placement (mounting a view, expanding the
  //            panel): the body is appearing, not moving.
  function syncNow(opts) {
    if (!ui || state.collapsed) return;
    // Only the page-synced view may be moved by the page. Without this, a sync
    // firing while Citations is still mounted (the mode toggle re-asserts the
    // sync before the orchestrator swaps the view) would scroll the citation
    // list — and poison the offset it saves on its way out.
    if (viewRestoresScroll(views.active, scrollSync)) return;
    const doc = document.scrollingElement || document.documentElement;
    const denom = doc.scrollHeight - doc.clientHeight;
    if (denom <= 0) return;
    const fraction = Math.min(1, Math.max(0, doc.scrollTop / denom));
    const panelDenom = ui.body.scrollHeight - ui.body.clientHeight;
    if (panelDenom <= 0) return;
    const placing = opts && opts.animate === false;
    setBodyScroll(fraction * panelDenom, { animate: syncDetached && !placing });
    if (placing) syncDetached = false; // a placed view starts in agreement
  }

  function onPageScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      syncNow();
    });
  }

  // Scroll-sync only ever runs for a visible, expanded Translation view whose
  // user hasn't switched it off — the one invariant, asserted after every state
  // change that could affect it (`visible`, `collapsed`, effective mode, the
  // `scrollSync` setting) and nowhere else.
  function refreshScrollSync() {
    const wanted = wantsScrollSync(state, { visible, scrollSync });
    if (wanted && !pageScrollBound) {
      pageScrollBound = true;
      window.addEventListener('scroll', onPageScroll, { passive: true });
      // Don't wait for the user's next scroll to agree with the page. This is a
      // no-op unless the synced view is already mounted (expanding from
      // collapsed); on a mode switch the view is placed when it mounts.
      syncNow({ animate: false });
    } else if (!wanted && pageScrollBound) {
      detachScrollSync();
    }
  }

  function detachScrollSync() {
    stopBodyScroll(); // scroll-sync is the only thing that eases; it stops here
    if (!pageScrollBound) return;
    pageScrollBound = false;
    window.removeEventListener('scroll', onPageScroll);
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    scrollRaf = null;
  }

  function getRootEl() {
    ensureRoot();
    return ui.rootEl;
  }

  // ---- Width: settings + drag-to-resize ----
  // Bounds come from the settings module (the one source of truth); the extra
  // viewport cap is this panel's own concern.
  function clampWidth(w) {
    const S = SETTINGS();
    const max = Math.min(S.SIDEBAR_WIDTH_MAX, Math.floor(window.innerWidth * 0.9));
    return Math.max(S.SIDEBAR_WIDTH_MIN, Math.min(max, Math.round(Number(w) || 0)));
  }

  function applyWidth(px) {
    ui.rootEl.style.setProperty('--btx-width', clampWidth(px) + 'px');
    updatePageReserve();
  }

  function widthFromEvent(e) {
    return clampWidth(window.innerWidth - e.clientX);
  }

  function onResizeMove(e) {
    applyWidth(widthFromEvent(e));
  }

  function onResizeUp(e) {
    document.removeEventListener('pointermove', onResizeMove);
    ui.rootEl.classList.remove('btx-resizing');
    const w = widthFromEvent(e);
    applyWidth(w);
    persist({ sidebarWidth: w });
  }

  function onResizeDown(e) {
    if (e.button != null && e.button !== 0) return;
    ensureRoot();
    ui.rootEl.classList.add('btx-resizing');
    document.addEventListener('pointermove', onResizeMove);
    document.addEventListener('pointerup', onResizeUp, { once: true });
    e.preventDefault();
  }

  root.__BTX = Object.assign(root.__BTX || {}, {
    panel: {
      HANDLED_KEYS: PANEL_HANDLED_KEYS.slice(),
      retryWait,
      init,
      showChapter,
      hide,
      arrange,
      arrangement: (facts) => arrangementOf(facts ? Object.assign({}, state, { facts: factsOf(facts) }) : state),
      effectiveMode: () => effectiveMode(state),
      citationView: () => state.citationView,
      toggleCollapsed: (force) => {
        ensureRoot();
        setCollapsed(force === undefined ? !state.collapsed : force === true);
      },
      showView,
      keepView: (keep) => keepView(views, keep),
      scrollIntoView,
      showTranslation,
      setNote,
      updateBeside,
      populateTranslations,
      controlNodes,
      getRootEl,
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
