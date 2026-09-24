/*
 * The side panel — a deep module that owns everything panel-shaped: its DOM,
 * its state (mode, citation layout, collapsed, width, translatable, the
 * visit's Translation override), the persistence of that state through
 * __BTX.settings, scroll-sync, and drag-to-resize. It is also the *view
 * host*: callers ask for a named view and the panel decides whether to
 * rebuild it or re-mount the one it cached, and it is the only writer of the
 * body's scroll position. The orchestrator supplies chapter context and
 * content; it never sequences panel setters, persists panel state, or holds
 * panel DOM.
 *
 * Interface:
 *   init(handlers)                 build the DOM, adopt persisted state, wire
 *                                  controls; must be awaited before use
 *   showChapter({ key, translatable })  make the panel visible for a
 *                                  chapter. `key` names the chapter;
 *                                  `translatable` is false when no text
 *                                  offers it. Another chapter invalidates
 *                                  every cached view; the same one again (a
 *                                  settings change) keeps Citations and the
 *                                  talk and the visit's Translation override,
 *                                  and persists panelMode 'translation' once
 *                                  it becomes translatable under the override
 *   hide()
 *   toggleCollapsed(force)         collapse to the edge tab or expand — flip,
 *                                  or `force` true/false like classList.toggle
 *                                  (the toolbar icon); persisted like the
 *                                  header's Collapse button
 *   effectiveMode()                'translation' | 'citations' — see the pure
 *                                  effectiveMode for the rule
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
 *   updateBeside({ layout, effective, collapseFits })  restate a mounted beside card in place
 *                                  (no-op otherwise): the reader picked another
 *                                  in-page layout, or the split fit another
 *   populateTranslations(menu, selectedId)  the dropdown, from
 *                                  __BTX.churchText.menuFor; hidden when empty
 *   retryWait(error, attempts)     pure: whether a rate-limited load retries by
 *                                  itself (ms to wait) or shows the error card
 *                                  (null)
 *   getRootEl()
 *
 * handlers: { renderMode(mode), onTranslationChange(id), onGear(section),
 *   onRetry, onAddLanguage(code), onLayoutChange(layout) }.
 *   `renderMode` fires whenever the panel invalidated its own body content
 *   (mode toggle, citation-layout toggle, a synced change from another
 *   context); the orchestrator answers by rendering that mode's content.
 *   After showChapter() the orchestrator renders the current effectiveMode()
 *   itself — showChapter never fires events. `onGear(section)` opens the
 *   options page, at a card when `section` names one ('bible' from the setup
 *   card and the key errors; none from the header's Settings button).
 *   `onAddLanguage` and `onLayoutChange` are the cards' picks; the panel
 *   writes no setting for them, the orchestrator does.
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
 * The panel's top: 0, except while the site's header band, laid out for the
 * full window while the panel was away, runs under the open panel — then the
 * panel starts below the band until it fits again (panelTop, --btx-top).
 *
 * IIFE -> __BTX.panel (ADR-0002). The pure state core below is also exported
 * for Node (tools/validate-panel-state.js); the DOM shell is skipped there.
 */
(function (root) {
  'use strict';

  // ---- Pure state core (Node-testable) -----------------------------------
  // The panel's state machine, free of DOM: which mode is effective and what
  // each user action means. Values arrive already normalized by
  // __BTX.settings; the guards here only defend against garbage clicks.

  function createState(init) {
    return {
      mode: init.mode === 'citations' ? 'citations' : 'translation',
      citationView: init.citationView === 'verse' ? 'verse' : 'source',
      collapsed: init.collapsed === true,
      translatable: true,
      override: false,
      chapter: null,
    };
  }

  // `mode` is the stored preference; what shows is the effective mode. A
  // chapter with no text to show beside it (no api.bible translation or Church
  // language offers it) shows citations and leaves the preference untouched
  // for the next chapter that has one. `override` is the reader asking for
  // Translation anyway on this visit — the setup card — and it outranks the
  // rest until the chapter changes or Citations is clicked.
  function effectiveMode(s) {
    if (s.override) return 'translation';
    return s.translatable ? s.mode : 'citations';
  }

  // A mode-segment click. True when the effective mode changed (content must
  // re-render). On a translatable chapter a click is the preference; on one
  // that isn't, Translation sets the override instead, so the stored
  // preference is never rewritten by a visit. Citations always clears it.
  function selectMode(s, m) {
    if (m !== 'citations' && m !== 'translation') return false;
    const before = effectiveMode(s);
    if (m === before) return false;
    if (m === 'citations') s.override = false;
    if (s.translatable) s.mode = m;
    else if (m === 'translation') s.override = true;
    return effectiveMode(s) !== before;
  }

  // A citation-layout click. Only acts while citations are showing.
  function selectCitationView(s, v) {
    if (v !== 'source' && v !== 'verse') return false;
    if (v === s.citationView) return false;
    if (effectiveMode(s) !== 'citations') return false;
    s.citationView = v;
    return true;
  }

  // A chapter was shown: a new one, or the same one again after a settings
  // change (`key` tells them apart). A new chapter drops the override. The
  // same one keeps it — and once that chapter becomes translatable under it (a
  // language added from the setup card, Bible translations connected in
  // settings), the reader's request for Translation is answered, so it
  // becomes the preference: mode 'translation', override cleared. The caller
  // persists `mode` when it moved. True when the effective mode flipped.
  function setChapter(s, chapter) {
    const c = chapter || {};
    const before = effectiveMode(s);
    const key = c.key == null ? null : String(c.key);
    if (key === null || key !== s.chapter) s.override = false;
    s.chapter = key;
    s.translatable = c.translatable !== false;
    if (s.override && s.translatable) {
      s.mode = 'translation';
      s.override = false;
    }
    return effectiveMode(s) !== before;
  }

  // Whether showing `chapter` leaves every cached view valid: the same chapter
  // again (a settings change re-renders it) with the same translatability. The
  // talk and the citation list then keep their filter, open groups and scroll.
  function sameChapter(s, chapter) {
    const c = chapter || {};
    return c.key != null && String(c.key) === s.chapter && (c.translatable !== false) === s.translatable;
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

  // ---- Pure translation-state copy (Node-testable) ------------------------
  // What each Translation-mode card and error says, and which action it
  // offers. `chapter` is the chapter as the reader names it ("Psalm 23"),
  // `name` the text as a sentence names it ("NIV", "Spanish").

  // The setup card, for a chapter no enabled text offers. `bible` is null off
  // the Bible, else what the api.bible path is missing: 'nokey' (no key yet)
  // or 'noversions' (none turned on).
  function setupCopy(o) {
    const chapter = (o && o.chapter) || 'this chapter';
    const bible = o && o.bible;
    return {
      heading: `Read ${chapter} in another ${bible ? 'translation or language' : 'language'}`,
      languages: 'Choose a Church language…',
      add: 'Add',
      languagesHint: 'Published by the Church. No key needed.',
      bible: !bible ? null : bible === 'noversions'
        ? { text: 'No Bible translations are turned on yet.', button: 'Choose Bible translations' }
        : { text: 'Bible translations such as NIV and NKJV need a free api.bible key.', button: 'Set up Bible translations' },
      talks: `See the talks that cite ${chapter}`,
    };
  }

  // Where a Church language shows, named the same on the options page:
  // [churchLanguageLayout value, label].
  const LAYOUTS = [['columns', 'Side by side'], ['interlinear', 'Under each verse'], ['panel', 'In the panel']];

  // The card shown while a Church language is split into the page. `layout` is
  // the reader's setting ('columns' | 'interlinear'); `effective` is what the
  // page split could actually lay out (null until it has mounted), and
  // `collapseFits` whether collapsing the panel would give columns room.
  // `collapse` is the label of the card's collapse button, null when it isn't
  // offered. Beside the page, collapsing is offered only where it delivers
  // columns: it widens columns already there, or makes room for them. In the
  // narrow window's bottom sheet (`sheet`) nothing can make room for columns,
  // so there is no room note, and the sheet covering the page is what
  // collapsing fixes: it is always offered, as "Hide panel".
  function besideCopy(o) {
    const c = o || {};
    const name = c.name || 'The translation';
    const layout = c.layout === 'interlinear' ? 'interlinear' : 'columns';
    const shown = c.effective === 'columns' || c.effective === 'interlinear' ? c.effective : layout;
    const status = shown === 'columns' ? `${name} is shown side by side.` : `${name} is shown under each verse.`;
    if (c.sheet === true) return { status, note: '', collapse: 'Hide panel' };
    return {
      status,
      note: layout === 'columns' && shown === 'interlinear' ? 'Not enough room for side by side.' : '',
      collapse: layout === 'columns' && (shown === 'columns' || c.collapseFits === true) ? 'Collapse panel for wider columns' : null,
    };
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
      createState, effectiveMode, selectMode, selectCitationView, setChapter, sameChapter,
      stepFontScale, setupCopy, besideCopy, errorCopy, retryWait, LAYOUTS, RETRY_MAX_WAIT_MS, RETRY_MAX,
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
  const PANEL_HANDLED_KEYS = ['sidebarWidth', 'fontScale', 'citationView', 'panelMode', 'panelCollapsed', 'scrollSync'];

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

    ui = { rootEl, panel, header, toolbar, select, smaller, larger, modes, modeTranslation, modeCitations, citModes, citViewSource, citViewVerse, body, tab, collapse, resize };
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

  // A click that only sets the visit's override leaves the stored preference
  // as it was, so it writes nothing.
  function onModeClick(m) {
    const preferred = state.mode;
    if (!selectMode(state, m)) return;
    applyModeUI();
    if (state.mode !== preferred) persist({ panelMode: state.mode });
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
    applyCollapsedUI();
    if (hadFocus) (c ? ui.tab : ui.collapse).focus();
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
    state = createState({ mode: s.panelMode, citationView: s.citationView, collapsed: s.panelCollapsed });
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
    const preferred = state.mode;
    setChapter(state, ctx);
    applyModeUI();
    // The setup card's request for Translation, answered: now the preference.
    if (state.mode !== preferred) persist({ panelMode: state.mode });
    updatePageReserve();
    scheduleTopChecks(); // the site may re-lay its header out after navigating
  }

  function hide() {
    if (!ui) return;
    visible = false;
    ui.rootEl.style.display = 'none';
    refreshScrollSync(); // `visible` just moved — one of the predicate's inputs
    updatePageReserve();
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
    ++placement; // this reveal is where the view goes, not a pending placement
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

  function pickLayout(value) {
    refocusLayout = !!ui && ui.rootEl.contains(document.activeElement);
    if (cbs.onLayoutChange) cbs.onLayoutChange(value);
  }

  // Where a Church language shows (LAYOUTS), as one segmented control: on the
  // beside card, and above the text when it is read in the panel. `current()`
  // is the layout showing; picking it again does nothing.
  function layoutControl(current) {
    const choices = LAYOUTS.map(([value, text]) => {
      const b = button('btx-seg-btn', text, () => { if (value !== current()) pickLayout(value); });
      b.dataset.btxLayout = value;
      return b;
    });
    const press = () => { for (const b of choices) setPressed(b, b.dataset.btxLayout === current()); };
    press();
    return { group: segmented('btx-seg', 'Where to show it', choices), choices, press };
  }

  function focusPressedLayout(control) {
    const pressed = control.choices.find((b) => b.getAttribute('aria-pressed') === 'true');
    if (pressed) pressed.focus();
  }

  function buildBeside(card) {
    const parts = {};
    parts.status = el('p', 'btx-card-title');
    parts.status.setAttribute('role', 'status');
    card.node.appendChild(parts.status);
    parts.layouts = layoutControl(() => card.layout);
    card.node.appendChild(parts.layouts.group);
    parts.note = el('p', 'btx-card-hint');
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
    if (!ui || !beside || !ui.body.contains(beside.node)) return;
    const c = change || {};
    if (c.layout === 'columns' || c.layout === 'interlinear') {
      if (c.layout !== beside.layout) Object.assign(beside, { effective: null, collapseFits: null }); // the split lays out afresh
      beside.layout = c.layout;
    }
    if (c.effective !== undefined) beside.effective = c.effective;
    if (c.collapseFits !== undefined) beside.collapseFits = c.collapseFits;
    refocusLayout = false; // restated in place: focus never left
    fillBeside(beside);
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
      block.appendChild(el('p', 'btx-card-hint', copy.languagesHint));
      card.appendChild(block);
    }
    if (copy.bible) {
      const block = el('div', 'btx-card-block');
      block.appendChild(el('p', 'btx-card-text', copy.bible.text));
      block.appendChild(button('btx-btn-outline', copy.bible.button, () => cbs.onGear && cbs.onGear('bible')));
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

  // The translation dropdown, from __BTX.churchText.menuFor: headed groups when
  // both kinds are on offer. Empty, it hides — the setup card is showing.
  function populateTranslations(menu, selectedId) {
    ensureRoot();
    ui.select.textContent = '';
    const groups = Array.isArray(menu) ? menu : [];
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
    watchTopScroll(pageReserve > 0);
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
      updateBeside,
      populateTranslations,
      getRootEl,
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
