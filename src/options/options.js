/*
 * Options page: an autosaving editor of the stored settings, in cards whose
 * ids are C.OPTIONS_SECTIONS, in page order — `languages` (Church languages
 * and where they show: the setup that needs no key comes first, with the
 * reader's own languages on top as "Your languages"), `bible` (api.bible key
 * and which translations the panel offers), `reading` (text size, panel width,
 * scroll sync),
 * and `about` (version, pack vintage, source lines, "Your data" — what stays
 * on this computer, what syncs, which sites, the privacy policy's address —
 * and the support link: text, plus one button, "Show the welcome again",
 * which writes the welcome-seen flag false and asks the worker to open
 * Alma 5, all or nothing: a failure of either half is said on its own line,
 * welcomeAgainError, and never joins Try again; aboutCopy).
 *
 * The form is an editor of the stored settings, not a second copy of them.
 * Every change is written as it happens, through __BTX.settings.patch (never
 * replace: the panel's own keys must survive), and a change made elsewhere —
 * the panel, another synced machine — is adopted through subscribe. A control
 * shows a value storage doesn't hold only while it is `dirty`: changed on
 * screen and not yet written (a slider mid-drag, a write waiting out its
 * debounce, a key being typed). A write that doesn't land puts its controls
 * back to what storage holds; "Try again" re-sends every failed write
 * (failedWrites) but the About button's, and any write that lands retires
 * the error.
 *
 * A Church language ticked here also leads the pick memory (the panel's
 * most-recently-used list, chrome.storage.local under C.SELECTION_KEY, not a
 * setting): church text's rememberTicked computes it, rememberTicks writes it
 * ahead of the setting, and open reader tabs adopt it through storage.onChanged.
 * The same tick also writes the language switch (`churchLanguageShown`, GLOSSARY)
 * on, in the same patch (commitPatch, given the stored languages as `before`):
 * the form has no control for the switch, and an untick never names it.
 *
 * The api.bible key is the one exception to write-as-you-go: it is connected
 * (the worker lists its versions) on paste, on change or on Connect, and
 * saved together with the translation list only when that succeeds. Connect
 * rests while the field holds the connected key — a list costs ~39 calls of
 * a monthly quota — and "Check for new translations" refetches it on demand.
 * Every explicit try (Connect, Enter, that button) visibly re-runs: it holds
 * "Checking…" for checkingWait, then its answer goes through statusChange,
 * which re-announces a repeat in the status's live region. A rejected key's
 * line links api.bible's dashboard and sign-up (keyErrorText, linked text).
 *
 * A paused api.bible month (the `rate` every LIST_BIBLES reply carries,
 * pausedUntil) never reads as a key problem. The stored key stays connected
 * with its list: "Connected." keeps its look, the paused line sits under it
 * in its own live region (#keyPause, pausedNote), and "Check for new
 * translations" rests aria-disabled until the day (keyControls
 * recheckUsable). Another key refused that month isn't saved, and its line
 * says when to try Connect again, in the calm 'note' look (keyErrorKind).
 *
 * The setup steps ("How to set up api.bible") are open on a fresh card and
 * folded when the page opens with a key stored (setupOpen); the add-later
 * line names "Check for new translations" only while that button is usable.
 *
 * On open, the page stays hidden until the first fill, which draws the stored
 * rows plus the worker's cached list (chrome.storage.local, any age); the
 * refresh that follows only moves checkmarks or adds rows at the end of
 * "more" (stableGroups). The worker's rows carry copyrights, which decide
 * "yours" vs "more"; the stored rows are slim and simply count as on. A
 * `partial` list (a copyright lookup failed) takes back the copyrights the
 * screen already had; only a row still missing one makes the grouping a
 * guess, which the page says (listGuesses).
 *
 * Deep links: the worker parks a section in chrome.storage.session under
 * C.OPTIONS_FOCUS_KEY; the page takes (reads and clears) it on load and
 * whenever it changes, and scrolls that card into view. `#bible` etc. in the
 * URL work too.
 *
 * The rules — which versions lead the list, which start checked, the default,
 * what a write may contain, what a remote change may repaint, the language
 * filter, the status copy — are the pure core below, exported for Node
 * (tools/validate-options-form.js); the DOM shell is skipped there.
 */
(function (root) {
  'use strict';

  const C = (root.__BTX && root.__BTX.const)
    || (typeof require === 'function' ? require('../shared/constants.js') : null);
  // The citation view-model, for the pack vintage's wording (vintageLine).
  const VM = (root.__BTX && root.__BTX.citVM)
    || (typeof require === 'function' ? require('../citations/cit-view-model.js') : null);
  // The monthly-limit line, in the panel's words (pausedLine).
  const RATE_COPY = (root.__BTX && root.__BTX.rateCopy)
    || (typeof require === 'function' ? require('../shared/rate-copy.js') : null);

  // ---- Pure form core (Node-testable) ------------------------------------

  const LIST_KEYS = ['enabledTranslations', 'defaultTranslationId'];

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // A version the reader added to their key. api.bible's copyrighted versions
  // all say "All rights reserved"; the free versions every key gets never do.
  // A `partial` list (the worker couldn't look every copyright up) leaves
  // rows with none; those count as added when their abbreviation is one a
  // reader adds (C.DEFAULT_ABBRS, NIrV) — a guess the page owns up to.
  const LIKELY_ADDED = C.DEFAULT_ABBRS.concat(['NIRV']);
  function isAdded(row, partial) {
    const copyright = (row && row.copyright) || '';
    if (copyright) return /all rights reserved/i.test(copyright);
    return !!partial && LIKELY_ADDED.indexOf(String((row && row.abbr) || '').toUpperCase()) >= 0;
  }

  // One row per abbreviation + name: api.bible lists some Bibles once per
  // edition (WEBU Ecumenical / Protestant / Catholic) under the same label.
  // The row kept is one the reader has on, then the Protestant edition (the
  // 66-book canon of the Latter-day Saint Bible), then the first listed.
  function dedupeVersions(list, onIds) {
    const on = new Set(onIds || []);
    const rank = (r) => (on.has(r.id) ? 2 : 0) + (/\bprotestant\b/i.test(r.description || '') ? 1 : 0);
    const out = [];
    const at = new Map();
    for (const r of list || []) {
      const k = `${r.abbr || ''}\u0000${r.name || ''}`;
      if (!at.has(k)) { at.set(k, out.length); out.push(r); continue; }
      if (rank(r) > rank(out[at.get(k)])) out[at.get(k)] = r;
    }
    return out;
  }

  // The checklist and what waits under "more": versions the reader added to
  // the key lead, and so does anything they have on, so every translation the
  // panel offers is in view. The rest are the key's free versions.
  function versionGroups(list, onIds, partial) {
    const on = new Set(onIds || []);
    const yours = [];
    const more = [];
    for (const r of dedupeVersions(list, onIds)) (isAdded(r, partial) || on.has(r.id) ? yours : more).push(r);
    return { yours, more };
  }

  // A list landing on the one already on screen (`shown`: the ids in each
  // group, in order) changes checkmarks and grows "more", nothing else: every
  // row keeps its group and place, and rows the screen hasn't shown join the
  // end of "more". Nothing on screen yet: versionGroups decides.
  function stableGroups(shown, list, onIds, partial) {
    const prev = shown || { yours: [], more: [] };
    if (!prev.yours.length && !prev.more.length) return versionGroups(list, onIds, partial);
    const byId = new Map(dedupeVersions(list, onIds).map((r) => [r.id, r]));
    const keep = (ids) => ids.filter((id) => byId.has(id)).map((id) => byId.get(id));
    const yours = keep(prev.yours);
    const more = keep(prev.more);
    const placed = new Set(prev.yours.concat(prev.more));
    for (const [id, r] of byId) if (!placed.has(id)) more.push(r);
    return { yours, more };
  }

  // A refreshed list, keeping what the screen already knew: a row whose
  // copyright the refresh couldn't look up keeps the one the shown row had.
  function mergeVersions(prev, fresh) {
    const known = new Map((prev || []).filter((r) => r && r.copyright).map((r) => [r.id, r.copyright]));
    return (fresh || []).map((r) => (!r.copyright && known.has(r.id) ? Object.assign({}, r, { copyright: known.get(r.id) }) : r));
  }

  // Does grouping this list have to guess? Only a `partial` answer can, and
  // only for a row still missing its copyright once mergeVersions has put
  // back the ones the screen knew.
  function listGuesses(list, partial) {
    return !!partial && (list || []).some((r) => r && !r.copyright);
  }

  // A list from the worker's cache can predate a version the reader turned on
  // elsewhere; the stored rows ride along so the form still shows them on.
  // The bundled World English Bible is not one of the key's versions (the
  // settings module keeps its row on), so it never joins the checklist.
  function withStored(list, stored) {
    const ids = new Set((list || []).map((t) => t.id));
    return (list || []).concat((stored || []).filter((t) => t && t.id && !ids.has(t.id) && t.provider !== C.PROVIDER_BUNDLED));
  }

  // Which versions start checked when a key connects. The stored selection
  // decides, empty or not (the reader may have turned everything off). The one
  // exception is a `fresh` key — not the stored one — whose list shares nothing
  // with that selection: it starts with the versions the reader added to it.
  function initialChecks(list, stored, fresh, partial) {
    const want = new Set((stored || []).map((t) => t && t.id));
    const kept = (list || []).filter((t) => want.has(t.id)).map((t) => t.id);
    if (kept.length || !fresh) return kept;
    return (list || []).filter((t) => isAdded(t, partial)).map((t) => t.id);
  }

  // The default has to be one of the enabled versions: the wanted one if it
  // is, else the first of C.DEFAULT_ABBRS the reader has on, else the first.
  function pickDefaultId(enabled, wanted) {
    const list = enabled || [];
    if (list.some((t) => t.id === wanted)) return wanted;
    for (const abbr of C.DEFAULT_ABBRS) {
      const hit = list.find((t) => String(t.abbr || '').toUpperCase() === abbr);
      if (hit) return hit.id;
    }
    return list.length ? list[0].id : '';
  }

  // What a write may say about the translation list. Until a version list is
  // on screen (loaded from the key, or the stored one), the checkboxes say
  // nothing about the stored list — writing them would wipe it.
  function translationPatch({ versionsLoaded, enabled, defaultId }) {
    if (!versionsLoaded) return {};
    return {
      enabledTranslations: enabled,
      defaultTranslationId: pickDefaultId(enabled, defaultId),
    };
  }

  // What one autosave writes for `keys`: each single-value field as the form
  // shows it (`values`), and the translation list only through
  // translationPatch (`list` is its input). A write of the languages that
  // turns one on (`before` is the stored list) also writes the language
  // switch on, so the tick shows at once; an untick never names the switch.
  function commitPatch({ keys, values, list, before }) {
    const partial = {};
    let withList = false;
    for (const k of keys || []) {
      if (LIST_KEYS.indexOf(k) >= 0) withList = true;
      else if (values && Object.prototype.hasOwnProperty.call(values, k)) partial[k] = values[k];
    }
    if (withList) Object.assign(partial, translationPatch(list || {}));
    if (Object.prototype.hasOwnProperty.call(partial, 'churchLanguages') && Array.isArray(before)
        && partial.churchLanguages.some((code) => before.indexOf(code) < 0)) {
      partial.churchLanguageShown = true;
    }
    return partial;
  }

  // Did a patch land? settings.patch resolves with the previous settings when
  // the write fails (sync quota), so compare what came back with what was asked.
  function patchLanded(result, partial, normalize) {
    const want = normalize(Object.assign({}, result, partial));
    return Object.keys(partial || {}).every((k) =>
      !Object.prototype.hasOwnProperty.call(want, k) || JSON.stringify(want[k]) === JSON.stringify(result[k]));
  }

  // Writes that didn't land, merged: every key any of them named, each with
  // the value last asked for. "Try again" sends exactly this.
  function failedWrites(prev, partial, keys) {
    const p = prev || { partial: {}, keys: [] };
    const union = p.keys.slice();
    for (const k of keys || []) if (union.indexOf(k) < 0) union.push(k);
    return { partial: Object.assign({}, p.partial, partial), keys: union };
  }

  // The key in the field, as if pasted cleanly: spaces, line breaks and the
  // invisible characters a web page copies along are dropped from both ends.
  const KEY_EDGE = /^[\s\u200b-\u200d\u2060\ufeff]+|[\s\u200b-\u200d\u2060\ufeff]+$/g;
  function keyFromField(value) {
    return String(value == null ? '' : value).replace(KEY_EDGE, '');
  }

  // The key row's two buttons. Connect tries the key in the field; it rests
  // while the field holds the key already connected (a refresh costs ~39
  // api.bible calls) unless that key's list came back `partial`, which the
  // page asks the reader to retry. "Check for new translations" is the
  // deliberate refresh of a connected key, and stays put while that key's
  // listed versions (`listed`) are rechecked, so the focus on it isn't lost.
  // In a `paused` month it stays in view but rests (`recheckUsable` false:
  // aria-disabled, so it keeps focus and its reason, the paused line); a
  // refresh would only be refused again.
  function keyControls({ field, storedKey, keyState, partial, listed, paused }) {
    const storedField = !!field && field === storedKey;
    const connected = storedField && keyState === 'connected';
    const recheck = connected || (storedField && keyState === 'checking' && !!listed);
    return {
      connect: !!field && keyState !== 'checking' && !(connected && !partial),
      recheck,
      recheckUsable: recheck && !paused,
    };
  }

  // The setup steps ("How to set up api.bible") are open on a fresh card and
  // folded once a key is stored, so the connected state leads. Decided when
  // the page opens only: folding them under a reader who just connected would
  // move the key row.
  function setupOpen(storedKey) {
    return !storedKey;
  }

  // Every explicit Connect visibly re-runs, the same key included: it shows
  // "Checking…" for at least CHECKING_MIN_MS, so an answer api.bible gives in
  // a few milliseconds (a wrong key's 403) can't make the click look ignored,
  // and the line changes ("Checking…", then the answer) for a screen reader
  // to announce. This is how long the answer still waits. An automatic try
  // (paste, change) shows its answer at once.
  const CHECKING_MIN_MS = 600;
  function checkingWait({ explicit, since, now }) {
    return explicit ? Math.max(0, CHECKING_MIN_MS - (now - since)) : 0;
  }

  // What writing `text` to a status line does, given the line `shown`. A live
  // region is announced only when its text changes, so a line asked to be
  // announced (`announce`) that matches what is shown is cleared, and set
  // again once the clear has been rendered (REANNOUNCE_MS: past a frame, so
  // Chrome's accessibility tree sees the empty line; one animation frame is
  // not enough). An unasked repeat writes nothing, so it is never announced
  // twice. 'set' | 'reannounce' | 'keep'.
  const REANNOUNCE_MS = 150;
  function statusChange({ shown, text, announce }) {
    if (text !== shown) return 'set';
    return announce && text ? 'reannounce' : 'keep';
  }

  // What an incoming settings change is allowed to repaint. `changed` is the
  // list of keys that actually moved (omit it for the initial fill, which
  // predates any edit); `dirty` is the Set of keys changed on screen and not
  // yet written. Those outrank the change: the reader's pending edit is not
  // overwritten. Rebuilding the checkbox list rebuilds the default <select>
  // with it, so a relist waits on a dirty default too, and never asks for a
  // separate reselect.
  function fillPlan({ fieldKeys, changed, dirty }) {
    const initial = !changed;
    const dirtyKey = (k) => !initial && !!dirty && dirty.has(k);
    const inScope = (k) => initial || changed.indexOf(k) >= 0;
    const wants = (k) => inScope(k) && !dirtyKey(k);

    const relist = wants('enabledTranslations') && !dirtyKey('defaultTranslationId');
    return {
      fields: (fieldKeys || []).filter(wants),
      relist,
      reselect: !relist && wants('defaultTranslationId'),
    };
  }

  // ---- Copy ----

  function versionLabel(t) {
    return t.abbr && t.abbr !== t.name ? `${t.abbr} — ${t.name}` : (t.name || t.abbr || t.id);
  }

  // The free versions' summary says what they are: on a key with none added
  // there is nothing above it to be "more" than.
  function moreLabel(n) {
    return n === 1 ? '1 free translation that comes with every key' : `${n} free translations that come with every key`;
  }

  // The key's status line once connected, from the versions turned on: their
  // abbreviations while they fit on a line, else just how many.
  const STATUS_ABBRS_MAX = 5;
  function connectedText(on) {
    const list = on || [];
    if (!list.length) return 'Connected. Choose the translations to show in the panel.';
    const count = `Connected — ${plural(list.length, 'translation', 'translations')}`;
    if (list.length > STATUS_ABBRS_MAX) return count;
    return `${count}: ${list.map((t) => t.abbr || t.name).join(', ')}`;
  }

  // The note under "Your translations", as linked text (strings, and
  // { text, href } for a link; [] is no note): a list the worker couldn't
  // fully check is a guess, and says so; an empty group links the api.bible
  // dashboard that fills it, and says what the free plan allows. In a paused
  // month (`pausedUntil`, 'YYYY-MM-DD') "Check for new translations" rests,
  // so the note sends the reader to it from that day.
  function yoursNote({ partial, yours, pausedUntil }) {
    if (partial) return ['Couldn’t check which translations are yours. Try Connect again later.'];
    if (!yours) {
      const day = pausedUntil ? RATE_COPY.monthDay(pausedUntil) : '';
      const then = day ? `Then, from ${day}, choose Check for new translations.` : 'Then choose Check for new translations.';
      return [
        'No translations are added to this key yet. On the free plan you can add up to 3, such as NIV and NKJV, in your ',
        { text: 'api.bible dashboard', href: C.API_BIBLE_PAGES.dashboard },
        ` (${C.API_BIBLE_ADD_BIBLES}). ${then} Or turn on one of the free translations below.`,
      ];
    }
    return [];
  }

  // The day a reply's month comes back, 'YYYY-MM-DD', when the month's state
  // the worker attached to it (`rate`) is paused, else ''. A reply of any
  // kind: a cached list on open says so as well as a refused Connect.
  function pausedUntil(res) {
    const rate = res && res.rate;
    return rate && rate.state === 'paused' ? String(rate.until || '') : '';
  }

  // The connected key's second line in a paused month, under "Connected."
  // (which keeps its look: nothing is wrong with the key): the panel's
  // paused sentence, then why "Check for new translations" rests. [] when
  // the month isn't paused.
  function pausedNote(rate) {
    if (!rate || rate.state !== 'paused') return [];
    return [`${RATE_COPY.pausedLine(rate.until)} Your key is still connected, and the World English Bible still works.`
      + ' You can use Check for new translations again on that day.'];
  }

  // A failed connect, as linked text, in words that say what to do. api.bible
  // answers a wrong key with 403, which the worker reports as INVALID_KEY; a
  // rejected key names both fixes — a miscopy, or no account yet — and links
  // each to its api.bible page ("dashboard": the card's one name for that
  // page). `rate` is the month's state the worker attaches to the reply: a
  // 429 in a paused month is the monthly limit, said in the panel's words
  // with the day it comes back (rate-copy pausedLine), then when to try this
  // key again. Such a key isn't saved: api.bible listed nothing, so it is
  // unchecked, and saving it would replace the connected key's translations
  // with none. (The connected key's own refusal is pausedNote instead.)
  const keyRejected = (error) => !!error && (error.code === C.ERR.INVALID_KEY || error.code === C.ERR.FORBIDDEN);
  const isPausedRefusal = (error, rate) => !!error && error.code === C.ERR.RATE_LIMITED && !!rate && rate.state === 'paused';
  function keyErrorText(error, rate) {
    const code = error && error.code;
    if (keyRejected(error)) {
      return [
        'api.bible didn’t accept that key. Copy it again from ',
        { text: 'your api.bible dashboard', href: C.API_BIBLE_PAGES.dashboard },
        ', or ',
        { text: 'create a free account', href: C.API_BIBLE_PAGES.signUp },
        ' first.',
      ];
    }
    if (code === C.ERR.NETWORK) return ['Couldn’t reach api.bible. Check your connection and try again.'];
    if (isPausedRefusal(error, rate)) {
      const day = RATE_COPY.monthDay(rate.until);
      return [`${RATE_COPY.pausedLine(rate.until)} Try Connect again ${day ? `on ${day}` : 'next month'}. The World English Bible still works.`];
    }
    if (code === C.ERR.RATE_LIMITED) return ['api.bible is busy. Try again in a minute.'];
    const detail = (error && error.message && error.message !== code ? error.message : code) || 'no answer';
    return [`Couldn’t check the key (${detail}). Try again.`];
  }

  // The status line's look for keyErrorText: a paused month is a calm notice
  // ('note': the body colour, like the panel's paused card), never the red
  // of a key problem; everything else is 'error'.
  function keyErrorKind(error, rate) {
    return isPausedRefusal(error, rate) ? 'note' : 'error';
  }

  // Linked text as the words it reads (and a live region announces).
  function plainText(parts) {
    return (parts || []).map((part) => (typeof part === 'string' ? part : part.text)).join('');
  }

  // ---- Church languages ----

  // The checklist's languages: the table minus English, which is the page's
  // own language.
  function offeredLanguages(table) {
    return (table || []).filter((l) => l.code !== C.ENGLISH_LANG);
  }

  // Grouped by what each language publishes, so a reader can see before
  // checking it whether it covers the book they read. Groups keep the table's
  // order (widest coverage first); `label` names the collections in reading
  // order.
  const VOLUME_NAMES = {
    ot: 'Old Testament', nt: 'New Testament', bofm: 'Book of Mormon',
    'dc-testament': 'Doctrine and Covenants', pgp: 'Pearl of Great Price',
  };
  function volumesLabel(vols) {
    const v = vols || [];
    if (v.length === 5) return 'All standard works';
    const names = [];
    if (v.indexOf('ot') >= 0 && v.indexOf('nt') >= 0) names.push('Bible');
    for (const k of ['ot', 'nt', 'bofm', 'dc-testament', 'pgp']) {
      if ((k === 'ot' || k === 'nt') && names[0] === 'Bible') continue;
      if (v.indexOf(k) >= 0) names.push(VOLUME_NAMES[k]);
    }
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] || '');
  }
  function languageGroups(langs) {
    const groups = [];
    for (const l of langs || []) {
      const label = volumesLabel(l.vols);
      let g = groups.find((x) => x.label === label);
      if (!g) groups.push(g = { label, langs: [] });
      g.langs.push(l);
    }
    return groups;
  }
  // The list the reader sees: "Your languages" first (exactly the enabled
  // languages, in table order; absent when none is enabled), then the coverage
  // groups without them. Unticking a language therefore sends it back to its
  // own group. There is no "common" or "popular" group on purpose: no language
  // is set above another. Each row carries its match against the search, which
  // runs over both parts; `shown` is how many rows of a section it leaves.
  const YOURS_LABEL = 'Your languages';
  function languageList(langs, enabled, q) {
    const on = new Set(enabled || []);
    const table = langs || [];
    const mine = table.filter((l) => on.has(l.code));
    const sections = [];
    if (mine.length) sections.push({ yours: true, label: YOURS_LABEL, langs: mine });
    for (const g of languageGroups(table.filter((l) => !on.has(l.code)))) {
      sections.push({ yours: false, label: g.label, langs: g.langs });
    }
    for (const section of sections) {
      section.rows = section.langs.map((lang) => ({ lang, hit: matchesLanguage(lang, q) }));
      section.shown = section.rows.filter((r) => r.hit).length;
    }
    return sections;
  }
  // What a tick (or untick) in the checklist does to the search and the focus.
  // A change to the enabled set clears the search, so the reader sees where the
  // row went, and names the language (`focus`), its new place in the list
  // (`place`, as a section's `yours` and `label`) and the coverage group to
  // open when it went back to one (`openGroup`: a closed group would take the
  // focus off the checkbox; "Your languages" is always open). A change that
  // leaves the set as it was, or touches only codes the table lacks, keeps the
  // search and moves nothing.
  function languageTick(langs, before, after, q) {
    const was = new Set(before || []);
    const now = new Set(after || []);
    const moved = (langs || []).find((l) => was.has(l.code) !== now.has(l.code));
    if (!moved) return { search: q, focus: null, place: null, openGroup: null };
    const section = languageList(langs, after, '').find((s) => s.langs.indexOf(moved) >= 0);
    return {
      search: '',
      focus: moved.code,
      place: { yours: section.yours, label: section.label },
      openGroup: section.yours ? null : section.label,
    };
  }
  // A group's summary reads "{label} · {count}"; this is the count. `shown`
  // is how many of the group's languages a search leaves in view.
  function groupCount(group, shown) {
    const n = group.langs.length;
    if (shown == null || shown === n) return plural(n, 'language', 'languages');
    return `${shown} of ${n} languages`;
  }

  // The language search: case-, accent- and apostrophe-insensitive, over the
  // language's own name, its English name and its code.
  const fold = (s) => String(s || '').normalize('NFD')
    .replace(/[\u0300-\u036f\u02b9-\u02bf'\u2019`]/g, '').toLowerCase();
  function matchesLanguage(lang, q) {
    const needle = fold(q).trim();
    if (!needle) return true;
    return [lang.name, lang.english, lang.code].some((f) => fold(f).indexOf(needle) >= 0);
  }

  // ---- About ----

  // The About card, all text: the manifest version, the pack vintage as the
  // Citations footer words it (null when no pack or no readable vintage), the
  // source lines, "Your data" and the support link. It has no control, so
  // nothing here reaches the autosave.
  //
  // "Your data" is C.ABOUT.yourData's three lists, every line as
  // { text, hosts } (a plain line has no hosts), then the privacy policy,
  // whose link text is its address without the scheme.
  function aboutCopy({ version, pack }) {
    const D = C.ABOUT.yourData;
    const list = (l) => ({
      head: l.head,
      items: l.items.map((i) => (typeof i === 'string' ? { text: i, hosts: [] } : { text: i.text, hosts: i.hosts.slice() })),
    });
    return {
      version: `Version ${version}`,
      vintage: VM.vintageLine(pack),
      sources: [C.ABOUT.citationSource, C.ABOUT.jodSource, C.BUNDLED_BIBLE.copyright],
      yourData: {
        title: 'Your data',
        lists: [D.local, D.synced, D.sites].map(list),
        policy: { label: 'Privacy policy:', text: C.ABOUT.privacyUrl.replace(/^https:\/\//, ''), href: C.ABOUT.privacyUrl },
      },
      links: [{ label: 'Support', href: C.ABOUT.supportUrl }],
    };
  }

  // The About card's one control. Its write is the synced welcome-seen flag
  // false (GLOSSARY: Welcome); the panel's ordinary due rule then shows the
  // welcome on the Alma 5 tab the worker opens. Not part of aboutCopy: that
  // stays text.
  const WELCOME_AGAIN = { label: 'Show the welcome again', patch: { welcomeSeen: false } };

  // The button's own line, after a press: the flag didn't save (no tab was
  // asked for), or it saved and the worker didn't open the tab (its reply
  // isn't { ok: true }). Null when both halves worked. Pressing the button
  // again is the retry, both halves in order.
  function welcomeAgainError(o) {
    const c = o || {};
    if (!c.saved) return 'Couldn’t show the welcome. Try again.';
    return c.reply && c.reply.ok === true ? null : 'Couldn’t open the welcome tab. Try again.';
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      WELCOME_AGAIN, welcomeAgainError, aboutCopy, isAdded, dedupeVersions, versionGroups, stableGroups, mergeVersions, listGuesses, withStored, initialChecks, pickDefaultId,
      translationPatch, commitPatch, patchLanded, failedWrites, fillPlan, keyFromField, keyControls, setupOpen,
      CHECKING_MIN_MS, checkingWait, REANNOUNCE_MS, statusChange,
      versionLabel, moreLabel, connectedText, yoursNote, keyErrorText, keyErrorKind, pausedUntil, pausedNote, plainText,
      offeredLanguages, languageGroups, languageList, languageTick, groupCount, matchesLanguage,
    };
  }
  if (typeof document === 'undefined') return; // Node: the pure core only.

  // ---- DOM shell ---------------------------------------------------------

  const SETTINGS = root.__BTX.settings;
  const CHURCH = root.__BTX.churchText; // rememberTicked: the pick memory's one rule
  const CACHE = root.__BTX.cache; // the worker's version-list cache, read for the first paint
  const COMMIT_DELAY_MS = 250; // coalesces a burst of clicks or arrow-key steps into one write
  const CONNECT_DELAY_MS = 400; // after a paste or change, before the key is tried
  const SAVED_MS = 1500;

  const $ = (id) => document.getElementById(id);
  const els = {
    saveStatus: $('saveStatus'),
    apiKey: $('apiKey'),
    toggleKey: $('toggleKey'),
    connectKey: $('connectKey'),
    keyStatus: $('keyStatus'),
    keyPause: $('keyPause'),
    recheckKey: $('recheckKey'),
    setupSteps: $('setupSteps'),
    addLaterCheck: $('addLaterCheck'),
    versions: $('versions'),
    yoursNote: $('yoursNote'),
    yoursRows: $('yoursRows'),
    moreVersions: $('moreVersions'),
    moreSummary: $('moreSummary'),
    moreRows: $('moreRows'),
    defaultRow: $('defaultRow'),
    defaultTranslation: $('defaultTranslation'),
    languageSummary: $('languageSummary'),
    langFilter: $('langFilter'),
    churchLanguages: $('churchLanguages'),
    langNoMatch: $('langNoMatch'),
    layout: $('churchLanguageLayout'),
    fontScale: $('fontScale'),
    fontScaleOut: $('fontScaleOut'),
    sidebarWidth: $('sidebarWidth'),
    sidebarWidthOut: $('sidebarWidthOut'),
    scrollSync: $('scrollSync'),
    aboutVersion: $('aboutVersion'),
    aboutVintage: $('aboutVintage'),
    aboutSources: $('aboutSources'),
    aboutData: $('aboutData'),
    aboutDataHead: $('aboutDataHead'),
    aboutLinks: $('aboutLinks'),
    addBiblesPath: $('addBiblesPath'),
    welcomeAgain: $('welcomeAgain'),
    welcomeAgainStatus: $('welcomeAgainStatus'),
  };

  let settings = SETTINGS.defaults();
  let available = []; // the versions the list is drawn from: [{ id, name, abbr, description, copyright, provider }]
  let versionsLoaded = false; // is the list on screen a faithful view (loaded, or the stored rows)?
  let listPartial = false; // did the grouping on screen have to guess (a `partial` list)?
  let shown = null; // { yours: [ids], more: [ids] } as last drawn; null = draw from scratch
  let keyState = 'none'; // 'none' | 'checking' | 'connected' | 'error'
  let paused = null; // the month's rate state from the newest reply, while api.bible's month is paused; else null
  let connectSeq = 0; // the newest list request owns the status line
  let lastTried = ''; // the key a paste/change last tried, so a blur doesn't retry it
  let connectTimer = 0;
  let statusShown = ''; // the key's status line as written (statusChange compares against it)
  let statusTimer = 0; // a re-announce waiting out its clear
  let listRefresh = Promise.resolve(); // the newest refreshList, settled once its result is on screen

  // Keys changed on screen and not yet written. They outrank a change
  // arriving from elsewhere, so those controls are left alone.
  const dirty = new Set();

  const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

  function send(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) resolve({ error: { code: C.ERR.NETWORK, message: chrome.runtime.lastError.message } });
        else resolve(res || { error: { code: C.ERR.UNKNOWN } });
      });
    });
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // Fills `node` with linked text from the pure core: a string is a text
  // node, a { text, href } part a link that opens in a new tab. The page's
  // one link builder.
  function linkedText(node, parts) {
    node.replaceChildren(...parts.map((part) => {
      if (typeof part === 'string') return document.createTextNode(part);
      const a = el('a', null, part.text);
      a.href = part.href;
      a.target = '_blank';
      a.rel = 'noopener';
      return a;
    }));
    return node;
  }

  // ---- Autosave ----

  const queued = new Set();
  let flushTimer = 0;
  let failed = null; // failedWrites(): what "Try again" sends
  let picks = []; // the pick memory (chrome.storage.local, C.SELECTION_KEY), as last read or written here
  let savedTimer = 0;

  function queueCommit(keys) {
    for (const k of keys) { queued.add(k); dirty.add(k); }
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, COMMIT_DELAY_MS);
  }

  function flush() {
    clearTimeout(flushTimer);
    if (!queued.size) return Promise.resolve(true);
    const keys = Array.from(queued);
    queued.clear();
    const values = {};
    for (const f of FIELDS) if (keys.indexOf(f.key) >= 0) values[f.key] = f.read();
    if (keys.indexOf('churchLanguages') >= 0) rememberTicks(settings.churchLanguages, values.churchLanguages);
    return write(commitPatch({ keys, values, list: listState(), before: settings.churchLanguages }), keys);
  }

  // A language ticked becomes the one shown: it leads the pick memory, which
  // the reader's tabs adopt. Written before the setting, so a tab has the new
  // order by the time the setting re-renders it; with no tab open, the next
  // chapter opened reads it. The rule is church text's (the panel's setup card
  // writes the same list through it).
  function rememberTicks(before, after) {
    const next = CHURCH.rememberTicked(picks, before, after);
    if (JSON.stringify(next) === JSON.stringify(picks)) return;
    picks = next;
    try { chrome.storage.local.set({ [C.SELECTION_KEY]: picks }); } catch (e) { /* the tick still saves */ }
  }

  function readPicks() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(C.SELECTION_KEY, (d) => {
          picks = CHURCH.mruFrom(d && d[C.SELECTION_KEY]);
          resolve();
        });
      } catch (e) { resolve(); }
    });
  }

  // The one path to storage. `quiet` skips the "Saved" flash. A write that
  // doesn't land puts its controls back to what storage holds and joins
  // `failed`; any write that lands (or a change adopted from elsewhere)
  // retires the error. An `alone` write (an action that says its own failure,
  // "Show the welcome again") never joins `failed`: Try again would re-send
  // half of it.
  async function write(partial, keys, quiet, alone) {
    let ok = true;
    if (Object.keys(partial).length) {
      let result;
      try { result = await SETTINGS.patch(partial); } catch (e) { result = settings; }
      ok = patchLanded(result, partial, SETTINGS.normalize);
      settings = result;
    }
    for (const k of keys) if (!queued.has(k)) dirty.delete(k);
    if (ok) {
      if (failed) { failed = null; hideSaveError(); }
      if (!quiet && Object.keys(partial).length) showSaved();
    } else if (!alone) {
      failed = failedWrites(failed, partial, keys);
      showSaveError();
      adopt(keys);
    }
    return ok;
  }

  // Paint settings that moved (`changed`, setting keys) from storage. A new
  // stored key brings its own list: its cached versions, then a refresh.
  function adopt(changed) {
    if (changed.indexOf('apiKey') >= 0 && !dirty.has('apiKey')) {
      adoptStoredKey(changed);
      return;
    }
    fillForm(changed);
  }

  async function adoptStoredKey(changed) {
    const seq = ++connectSeq;
    const cached = await cachedList();
    if (seq !== connectSeq) return;
    showStoredList(cached);
    fillForm(changed.concat(LIST_KEYS));
    listRefresh = refreshList();
  }

  function showSaved() {
    clearTimeout(savedTimer);
    const s = els.saveStatus;
    s.textContent = 'Saved';
    s.className = 'save-status show';
    savedTimer = setTimeout(() => {
      s.classList.remove('show');
      savedTimer = setTimeout(() => { if (!s.classList.contains('show')) s.textContent = ''; }, 300);
    }, SAVED_MS);
  }

  function showSaveError() {
    clearTimeout(savedTimer);
    const s = els.saveStatus;
    s.textContent = 'Couldn’t save. ';
    const retry = el('button', 'retry', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', async () => {
      const f = failed;
      if (!f) return;
      failed = null;
      s.className = 'save-status';
      // The controls show storage again, so the retry sends what was asked
      // for, and paints it once it lands.
      if (await write(f.partial, f.keys)) adopt(f.keys);
    });
    s.appendChild(retry);
    s.className = 'save-status show error';
  }

  function hideSaveError() {
    const s = els.saveStatus;
    if (!s.classList.contains('error')) return;
    s.className = 'save-status';
    s.textContent = '';
  }

  // ---- Bible translations ----

  function listState() {
    return { versionsLoaded, enabled: checkedTranslations(), defaultId: els.defaultTranslation.value };
  }

  function versionInputs() {
    return Array.from(els.versions.querySelectorAll('input[type="checkbox"]'));
  }

  function checkedTranslations() {
    const ids = new Set(versionInputs().filter((c) => c.checked).map((c) => c.value));
    return available.filter((t) => ids.has(t.id));
  }

  function versionRow(t, checked) {
    const label = el('label', 'check');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.value = t.id;
    cb.checked = checked;
    cb.addEventListener('change', onVersionToggle);
    label.appendChild(cb);
    label.appendChild(el('span', '', versionLabel(t)));
    return label;
  }

  // `onIds` are the versions to show checked and `wanted` the default to
  // preselect — both passed in, never read back off the controls this rebuilds.
  // Rows keep the group and place they were drawn in (stableGroups) until
  // `shown` is reset for a new list.
  function renderTranslations(onIds, wanted) {
    const focused = versionInputs().find((c) => c === document.activeElement);
    const { yours, more } = stableGroups(shown, available, onIds, listPartial);
    shown = { yours: yours.map((t) => t.id), more: more.map((t) => t.id) };
    const on = new Set(onIds || []);
    els.yoursRows.textContent = '';
    els.moreRows.textContent = '';
    for (const t of yours) els.yoursRows.appendChild(versionRow(t, on.has(t.id)));
    for (const t of more) els.moreRows.appendChild(versionRow(t, on.has(t.id)));
    els.versions.hidden = !available.length;
    showYoursNote();
    els.moreVersions.hidden = !more.length;
    els.moreSummary.textContent = moreLabel(more.length);
    refreshDefaultOptions(wanted);
    // A keyboard reader on a row keeps their place when the rows are rebuilt.
    const again = focused && versionInputs().find((c) => c.value === focused.value);
    if (again) again.focus({ preventScroll: true });
  }

  // The note under "Your translations", for the rows as last drawn; redrawn
  // on its own when only the month's state moved.
  function showYoursNote() {
    const note = yoursNote({ partial: listPartial, yours: shown ? shown.yours.length : 0, pausedUntil: paused ? paused.until : '' });
    linkedText(els.yoursNote, note);
    els.yoursNote.hidden = !note.length;
    els.yoursNote.classList.toggle('warn', listPartial);
  }

  // `wanted` is the id to preselect — passed in, never read back off the
  // control this rebuilds (a populated <select> always has a value, which
  // would otherwise beat the stored setting every time).
  function refreshDefaultOptions(wanted) {
    const checked = checkedTranslations();
    els.defaultTranslation.textContent = '';
    for (const t of checked) {
      const opt = el('option', '', versionLabel(t));
      opt.value = t.id;
      els.defaultTranslation.appendChild(opt);
    }
    els.defaultTranslation.value = pickDefaultId(checked, wanted);
    // One translation needs no default; the panel simply opens on it.
    els.defaultRow.hidden = checked.length < 2;
  }

  function onVersionToggle() {
    refreshDefaultOptions(els.defaultTranslation.value);
    showKeyState();
    queueCommit(LIST_KEYS);
  }

  // The key's status line, its one writer. `content` is a string or linked
  // text (keyErrorText), rendered through linkedText; statusChange decides
  // whether the live region is written at all, and re-announces a repeat
  // asked to be announced (`announce`: the answer to an explicit Connect).
  function setKeyStatus(content, kind, opts) {
    const o = opts || {};
    const parts = typeof content === 'string' ? (content ? [content] : []) : content;
    const node = els.keyStatus;
    node.className = 'status' + (kind ? ' ' + kind : '');
    clearTimeout(statusTimer); // a write supersedes a re-announce still waiting
    node.style.minHeight = '';
    node.style.marginTop = '';
    const change = statusChange({ shown: statusShown, text: plainText(parts), announce: !!o.announce });
    if (change === 'keep') return;
    if (change === 'set') { writeKeyStatus(parts); return; }
    // Cleared for a rendered frame, then set again; the line keeps its room
    // meanwhile, so nothing below it moves.
    node.style.minHeight = `${node.offsetHeight}px`;
    node.style.marginTop = getComputedStyle(node).marginTop;
    writeKeyStatus([]);
    statusTimer = setTimeout(() => {
      writeKeyStatus(parts);
      node.style.minHeight = '';
      node.style.marginTop = '';
    }, REANNOUNCE_MS);
  }

  function writeKeyStatus(parts) {
    linkedText(els.keyStatus, parts);
    statusShown = plainText(parts);
  }

  function showKeyState(opts) {
    if (keyState === 'connected') setKeyStatus(connectedText(checkedTranslations()), 'ok', opts);
    else if (keyState === 'checking') setKeyStatus('Checking…', 'busy');
    else if (keyState === 'none') setKeyStatus('', '');
    showKeyPause();
    updateConnect();
  }

  // The connected key's paused line (pausedNote), under "Connected.": its own
  // live region, written only when its words change, so it is heard once.
  function showKeyPause() {
    const parts = keyState === 'connected' ? pausedNote(paused) : [];
    if (plainText(parts) === els.keyPause.textContent) return;
    linkedText(els.keyPause, parts);
  }

  function updateConnect() {
    const c = keyControls({
      field: keyFromField(els.apiKey.value), storedKey: settings.apiKey, keyState, partial: listPartial, listed: versionsLoaded, paused: !!paused,
    });
    els.connectKey.disabled = !c.connect;
    els.recheckKey.hidden = !c.recheck;
    if (c.recheckUsable) els.recheckKey.removeAttribute('aria-disabled');
    else els.recheckKey.setAttribute('aria-disabled', 'true');
    els.addLaterCheck.hidden = !(c.recheck && c.recheckUsable);
  }

  // The worker's cached version list for the stored key, however old — the
  // first picture of the list. [] when there is none.
  async function cachedList() {
    if (!settings.apiKey || !CACHE) return [];
    try { return (await CACHE.getBibles(settings.apiKey, { anyAge: true })) || []; } catch (e) { return []; }
  }

  // The stored rows plus the cached list, as the form's first picture of the
  // list: shown at once, with no wait on the worker, so the refresh that
  // follows only moves checkmarks or adds rows at the end.
  function showStoredList(cached) {
    const stored = settings.apiKey ? settings.enabledTranslations : [];
    available = settings.apiKey ? withStored(cached || [], stored) : [];
    versionsLoaded = available.length > 0;
    listPartial = false;
    shown = null;
    keyState = !settings.apiKey ? 'none' : available.length ? 'connected' : 'checking';
  }

  // Re-read the stored key's versions (the worker's cache when it has them) and
  // redraw the list around what is on screen. Nothing is written: a cached list
  // can be a week old, so it only ever adds rows.
  async function refreshList() {
    if (!settings.apiKey) return;
    const seq = ++connectSeq;
    if (!available.length) { keyState = 'checking'; showKeyState(); }
    const res = await send({ type: C.MSG.LIST_BIBLES });
    if (seq !== connectSeq) return;
    paused = pausedUntil(res) ? res.rate : null;
    if (res.error && paused && available.length) {
      // The stored key in a paused month: still connected, with its list;
      // the paused line says why nothing refreshes.
      keyState = 'connected';
      showYoursNote();
      showKeyState();
      return;
    }
    if (res.error) {
      keyState = 'error';
      setKeyStatus(keyErrorText(res.error, res.rate), keyErrorKind(res.error, res.rate));
      showKeyPause();
      updateConnect();
      return;
    }
    const onIds = versionsLoaded ? checkedTranslations().map((t) => t.id) : settings.enabledTranslations.map((t) => t.id);
    const wanted = versionsLoaded ? els.defaultTranslation.value : settings.defaultTranslationId;
    // Rows already drawn keep their groups; only a list drawn from scratch
    // is grouped from this answer, and only then can its guesses show.
    const merged = mergeVersions(available, res.bibles);
    if (!shown || !(shown.yours.length + shown.more.length)) listPartial = listGuesses(merged, res.partial);
    available = withStored(merged, settings.enabledTranslations);
    versionsLoaded = true;
    keyState = 'connected';
    renderTranslations(onIds, wanted);
    showKeyState();
  }

  // Try the key in the field; on success save it with the list it unlocks.
  // `explicit` (Connect, Enter, "Check for new translations") fetches afresh —
  // the reader may have just added a version at api.bible — where an automatic
  // try takes the cache. An explicit try visibly re-runs: "Checking…" holds
  // for checkingWait, then the answer is announced (`announce`).
  async function connect(explicit) {
    clearTimeout(connectTimer);
    const key = keyFromField(els.apiKey.value);
    if (!key) return;
    const from = document.activeElement;
    lastTried = key;
    const seq = ++connectSeq;
    keyState = 'checking';
    showKeyState();
    const since = Date.now();
    const res = await send({ type: C.MSG.LIST_BIBLES, key, refresh: !!explicit });
    if (seq !== connectSeq) return;
    await sleep(checkingWait({ explicit, since, now: Date.now() }));
    if (seq !== connectSeq) return;
    const stored = key === settings.apiKey;
    const announce = !!explicit;
    paused = pausedUntil(res) ? res.rate : null;

    if (res.error && stored && paused && available.length) {
      // The connected key's refresh, refused in a paused month: it stays
      // connected with its list ("Connected." keeps its look), the paused
      // line under it, and "Check for new translations" rests until the day.
      keyState = 'connected';
      showYoursNote();
      showKeyState({ announce });
      settleKeyFocus(from);
      return;
    }
    if (res.error) {
      keyState = 'error';
      // A rejected key, or a key that isn't the stored one: the list on screen
      // no longer belongs to anything. A stored key that merely couldn't be
      // reached keeps its list.
      if (keyRejected(res.error) || !stored) {
        available = [];
        versionsLoaded = false;
        shown = null;
        renderTranslations([], '');
      }
      setKeyStatus(keyErrorText(res.error, res.rate), keyErrorKind(res.error, res.rate), { announce });
      showKeyPause();
      updateConnect();
      settleKeyFocus(from);
      return;
    }

    // The stored key's list keeps the copyrights already on screen, so a
    // recheck whose lookups fail doesn't turn known rows into guesses (and
    // move them). A new key's list is all it has.
    available = stored ? mergeVersions(available, res.bibles) : (res.bibles || []);
    versionsLoaded = true;
    listPartial = listGuesses(available, res.partial);
    shown = null; // a new list, or one the reader asked for: grouped afresh
    keyState = 'connected';
    renderTranslations(initialChecks(available, settings.enabledTranslations, !stored, listPartial), settings.defaultTranslationId);
    showKeyState({ announce });
    const partial = Object.assign({ apiKey: key }, translationPatch(listState()));
    if (SETTINGS.diff(settings, Object.assign({}, settings, partial)).length) await write(partial, ['apiKey'].concat(LIST_KEYS));
    else dirty.delete('apiKey');
    updateConnect(); // the key is the stored one now: Connect rests
    settleKeyFocus(from);
  }

  // Connect rests while a list is fetched and once its key is connected, and
  // a disabled button drops focus to the page. A keyboard reader who pressed
  // Connect or "Check for new translations" lands back on it, else on
  // whichever of the two can take focus, else the key field; focus they
  // moved elsewhere meanwhile stays theirs.
  function settleKeyFocus(from) {
    if (from !== els.connectKey && from !== els.recheckKey) return;
    const now = document.activeElement;
    if (now && now !== document.body && now !== from) return;
    const usable = (b) => !b.disabled && !b.hidden;
    const to = [from, els.connectKey, els.recheckKey].find(usable) || els.apiKey;
    if (to !== now) to.focus();
  }

  function scheduleConnect() {
    clearTimeout(connectTimer);
    connectTimer = setTimeout(() => {
      const key = keyFromField(els.apiKey.value);
      if (key && key !== lastTried && !(keyState === 'connected' && key === settings.apiKey)) connect(false);
    }, CONNECT_DELAY_MS);
  }

  // An emptied field saves "no key". The stored translation list stays, so
  // connecting the same key again brings the same choices back.
  function clearKey() {
    clearTimeout(connectTimer);
    connectSeq++;
    lastTried = '';
    available = [];
    versionsLoaded = false;
    listPartial = false;
    shown = null;
    keyState = 'none';
    renderTranslations([], '');
    showKeyState();
    if (settings.apiKey) write({ apiKey: '' }, ['apiKey']);
    else dirty.delete('apiKey');
  }

  // ---- Church languages ----

  // One row (label + checkbox) per language, built once; renderLanguageList
  // moves them between sections, so a tick keeps its checkbox, its state and
  // its focus.
  const langRows = new Map(); // code -> { lang, label, input }
  const openLabels = new Set(); // sections the reader has open (not while searching)

  function buildLanguageList() {
    for (const lang of offeredLanguages(C.CHURCH_LANGUAGES)) {
      const label = el('label', 'check');
      const input = el('input');
      input.type = 'checkbox';
      input.value = lang.code;
      const text = el('span', 'lang-name');
      text.appendChild(nativeName(lang));
      if (lang.name !== lang.english) text.appendChild(el('span', 'lang-en', ` — ${lang.english}`));
      label.appendChild(input);
      label.appendChild(text);
      langRows.set(lang.code, { lang, label, input });
    }
    // Only the reader's own open and close are remembered: a search opens
    // every section, and clearing it puts back what they had open.
    els.churchLanguages.addEventListener('toggle', (e) => {
      const label = e.target.dataset && e.target.dataset.label;
      if (!label || els.langFilter.value.trim()) return;
      if (e.target.open) openLabels.add(label); else openLabels.delete(label);
    }, true);
    renderLanguageList();
  }

  // Lay the list out from the pure languageList (`code` names the language to
  // keep the focus on, else the focused checkbox keeps it): "Your languages" (the ticked
  // rows) above the coverage groups, each section a <details> named by its
  // summary ("Bible · 1 language"). A long label wraps; its count stays on one
  // line with its dot, and the label's last word goes with them (a no-break
  // space), so no line starts with the dot. Run on every tick, adopted
  // setting and search; the checkboxes themselves are the source of the
  // ticked set, so a tick not yet written shows where it will be.
  function renderLanguageList(code) {
    const q = els.langFilter.value;
    const filtering = !!q.trim();
    const focused = document.activeElement;
    const focusCode = code || (focused && focused.matches && focused.matches('input[type="checkbox"]') && els.churchLanguages.contains(focused)
      ? focused.value : null);
    const sections = languageList(offeredLanguages(C.CHURCH_LANGUAGES), checkedLanguages(), q);
    if (!openLabels.size && !els.churchLanguages.firstChild && sections.length) openLabels.add(sections[0].label);
    els.churchLanguages.textContent = '';
    let shown = 0;
    sections.forEach((section, i) => {
      const details = el('details', 'lang-group');
      details.dataset.label = section.label;
      if (section.yours) details.classList.add('yours');
      details.open = filtering || section.yours || openLabels.has(section.label);
      const summary = el('summary');
      summary.id = `langGroup${i}`;
      details.setAttribute('aria-labelledby', summary.id);
      const text = el('span', 'summary-text', `${section.label}\u00a0`);
      text.appendChild(el('span', 'summary-count', `· ${groupCount(section, filtering ? section.shown : null)}`));
      summary.appendChild(text);
      const grid = el('div', 'checklist-grid');
      for (const r of section.rows) {
        const row = langRows.get(r.lang.code);
        row.label.hidden = !r.hit;
        grid.appendChild(row.label);
      }
      details.hidden = section.shown === 0;
      details.appendChild(summary);
      details.appendChild(grid);
      els.churchLanguages.appendChild(details);
      shown += section.shown;
    });
    els.langNoMatch.hidden = shown > 0;
    els.langNoMatch.textContent = shown ? '' : `No language matches “${q.trim()}”.`;
    if (focusCode && langRows.has(focusCode)) {
      // A row that moved into a closed group would lose the focus with it:
      // the group's summary takes it, so the reader hears where the row went.
      const { input } = langRows.get(focusCode);
      const group = input.closest('details');
      (group && group.open ? input : group.querySelector('summary')).focus();
    }
  }

  // A language's own name, tagged so CJK glyphs and screen-reader voices
  // follow the language, and right-to-left names lay out right to left.
  function nativeName(lang) {
    const span = el('span', '', lang.name);
    if (lang.tag) span.lang = lang.tag;
    span.dir = 'auto';
    return span;
  }

  function languageInputs() {
    return Array.from(els.churchLanguages.querySelectorAll('input[type="checkbox"]'));
  }

  function checkedLanguages() {
    return languageInputs().filter((c) => c.checked).map((c) => c.value);
  }

  function checkLanguages(codes) {
    const want = new Set(codes || []);
    for (const cb of languageInputs()) cb.checked = want.has(cb.value);
    ticked = checkedLanguages();
    renderLanguageList(); // the ticked ones move under "Your languages"
    showLanguageSummary();
  }

  // A tick or untick by the reader: the search clears and the focus follows
  // the language to its new place (the pure languageTick decides). `ticked`
  // is the set the list was last laid out for, since the checkbox has already
  // changed when its event arrives.
  let ticked = [];
  function onLanguageTick() {
    const now = checkedLanguages();
    const tick = languageTick(offeredLanguages(C.CHURCH_LANGUAGES), ticked, now, els.langFilter.value);
    ticked = now;
    els.langFilter.value = tick.search;
    if (tick.openGroup) openLabels.add(tick.openGroup);
    renderLanguageList(tick.focus);
    showLanguageSummary();
  }

  function showLanguageSummary() {
    const on = new Set(checkedLanguages());
    const langs = C.CHURCH_LANGUAGES.filter((l) => on.has(l.code));
    const s = els.languageSummary;
    s.textContent = '';
    s.classList.toggle('none', !langs.length);
    if (!langs.length) { s.textContent = 'None chosen yet'; return; }
    s.appendChild(document.createTextNode('Showing: '));
    langs.forEach((l, i) => {
      if (i) s.appendChild(document.createTextNode(', '));
      s.appendChild(nativeName(l));
    });
  }

  function readLayout() {
    const r = els.layout.querySelector('input[name="churchLanguageLayout"]:checked');
    return r ? r.value : settings.churchLanguageLayout;
  }
  function writeLayout(v) {
    for (const r of els.layout.querySelectorAll('input[name="churchLanguageLayout"]')) r.checked = r.value === v;
  }

  // ---- Reading ----

  const pct = (v) => Math.round(Number(v) * 100) + '%';
  const px = (v) => `${v}px`;

  // A slider's value as the page shows it, on screen and to a screen reader.
  function showFontScale(v) {
    els.fontScaleOut.textContent = pct(v);
    els.fontScale.setAttribute('aria-valuetext', pct(v));
  }
  function showWidth(v) {
    els.sidebarWidthOut.textContent = px(v);
    els.sidebarWidth.setAttribute('aria-valuetext', `${v} pixels`);
  }

  // The single-value settings this form edits, each paired with the control
  // that shows it. One table, so the autosave and the live refresh can't
  // disagree about which control holds which setting. `live` sliders mark
  // dirty on every step of a drag and write on release. The translation list
  // is not here — it is built from the key, not from one control — but it
  // goes through the same dirty flag, the same write and the same fill plan.
  const FIELDS = [
    { key: 'apiKey', node: els.apiKey, read: () => keyFromField(els.apiKey.value), write: (v) => { els.apiKey.value = v; } },
    // A group of checkboxes, but one setting: its change events bubble to the
    // container, which is what writes it.
    { key: 'churchLanguages', node: els.churchLanguages, read: checkedLanguages, write: checkLanguages },
    { key: 'churchLanguageLayout', node: els.layout, read: readLayout, write: writeLayout },
    {
      key: 'fontScale',
      node: els.fontScale,
      live: showFontScale,
      // Stored as a multiplier, shown as a percentage — the slider walks the
      // multiplier so the module's clamp/step is the only rule about it.
      read: () => els.fontScale.value,
      write: (v) => { els.fontScale.value = String(v); showFontScale(v); },
    },
    {
      key: 'sidebarWidth',
      node: els.sidebarWidth,
      live: showWidth,
      read: () => els.sidebarWidth.value,
      write: (v) => { els.sidebarWidth.value = String(v); showWidth(v); },
    },
    { key: 'scrollSync', node: els.scrollSync, read: () => els.scrollSync.checked, write: (v) => { els.scrollSync.checked = v; } },
  ];
  const FIELD_KEYS = FIELDS.map((f) => f.key);

  // Paint the stored settings onto the form. `changed` limits it to the
  // settings that actually moved (a live change from another context); omit it
  // for the whole form.
  function fillForm(changed) {
    const plan = fillPlan({ fieldKeys: FIELD_KEYS, changed, dirty });
    for (const f of FIELDS) {
      if (plan.fields.indexOf(f.key) >= 0) f.write(settings[f.key]);
    }
    if (plan.relist) {
      if (versionsLoaded || settings.enabledTranslations.length) {
        available = withStored(available, settings.apiKey ? settings.enabledTranslations : []);
        versionsLoaded = versionsLoaded || available.length > 0;
      }
      renderTranslations(settings.enabledTranslations.map((t) => t.id), settings.defaultTranslationId);
      showKeyState();
    } else if (plan.reselect) {
      refreshDefaultOptions(settings.defaultTranslationId);
    }
  }

  // ---- About ----

  // Text only (aboutCopy): the running version, the vintage of the pack the
  // reader would load (personal first, then public), the source lines, "Your
  // data" (each list under its own heading; a site's hostnames on a muted line
  // under what it is for), links.
  async function renderAbout() {
    let pack = null;
    try { pack = (await root.__BTX.citData.loadPack()).descriptor; } catch (e) { /* no pack: no vintage line */ }
    const copy = aboutCopy({ version: chrome.runtime.getManifest().version, pack });
    els.aboutVersion.textContent = copy.version;
    els.aboutVintage.textContent = copy.vintage || '';
    els.aboutVintage.hidden = !copy.vintage;
    els.aboutSources.replaceChildren(...copy.sources.map((line) => el('li', null, line)));
    const data = copy.yourData;
    els.aboutDataHead.textContent = data.title;
    const parts = [els.aboutDataHead];
    for (const l of data.lists) {
      const ul = el('ul', 'about-data-list');
      for (const item of l.items) {
        const li = ul.appendChild(el('li', null, item.text));
        if (item.hosts.length) li.appendChild(el('span', 'about-host', item.hosts.join(', ')));
      }
      parts.push(el('h4', 'about-data-head', l.head), ul);
    }
    parts.push(linkedText(el('p', 'about-policy'), [`${data.policy.label} `, { text: data.policy.text, href: data.policy.href }]));
    els.aboutData.replaceChildren(...parts);
    linkedText(els.aboutLinks, copy.links.map((l) => ({ text: l.label, href: l.href })));
  }

  // "Show the welcome again": the flag first, so the tab the worker opens finds
  // the welcome due. All or nothing: a write that doesn't land opens nothing,
  // and either failure is said on the button's own line (welcomeAgainError);
  // pressing again redoes both halves.
  async function showWelcomeAgain() {
    els.welcomeAgainStatus.textContent = '';
    const saved = await write(WELCOME_AGAIN.patch, [], true, true);
    const reply = saved ? await send({ type: C.MSG.OPEN_WELCOME }) : null;
    els.welcomeAgainStatus.textContent = welcomeAgainError({ saved, reply }) || '';
  }

  // ---- Deep links ----

  function focusSection(section) {
    if (C.OPTIONS_SECTIONS.indexOf(section) < 0) return;
    const card = $(section);
    card.scrollIntoView({ block: 'start' });
    card.classList.remove('flash');
    void card.offsetWidth; // restart the highlight
    card.classList.add('flash');
    if (section === 'about') return; // text only: nothing to focus
    if (section !== 'bible') {
      (section === 'languages' ? els.langFilter : els.fontScale).focus({ preventScroll: true });
      return;
    }
    // Where to land depends on whether the key still works, which the list
    // refresh in flight decides. Focus the reader moves meanwhile stays theirs.
    const before = document.activeElement;
    listRefresh.then(() => {
      const now = document.activeElement;
      if (now === before || now === document.body || !now) bibleTarget().focus({ preventScroll: true });
    });
  }

  // A connected key: the first translation turned on (else the first shown).
  // Anything else: the key field.
  function bibleTarget() {
    if (keyState !== 'connected') return els.apiKey;
    const shown = versionInputs().filter((c) => !c.closest('[hidden]') && !c.closest('details:not([open])'));
    return shown.find((c) => c.checked) || shown[0] || els.apiKey;
  }

  async function takeFocusRequest() {
    let section = '';
    try {
      const got = await chrome.storage.session.get(C.OPTIONS_FOCUS_KEY);
      section = got && got[C.OPTIONS_FOCUS_KEY];
      if (section) await chrome.storage.session.remove(C.OPTIONS_FOCUS_KEY);
    } catch (e) { /* no session storage: the page opens at the top */ }
    if (section) focusSection(section);
  }

  // ---- Init ----

  // The key field as typed. Emptied with no key stored, it clears whatever
  // the last try said; back at the stored key, it is no longer a pending
  // change (and the stored key's list and status come back). Anything else
  // is a pending change, which a key adopted from elsewhere won't overwrite.
  function onKeyInput() {
    const v = keyFromField(els.apiKey.value);
    if (!v && !settings.apiKey) { clearKey(); return; }
    if (v && v === settings.apiKey) {
      clearTimeout(connectTimer);
      lastTried = '';
      dirty.delete('apiKey');
      if (keyState === 'connected') showKeyState();
      else adoptStoredKey([]);
      return;
    }
    dirty.add('apiKey');
    if (!v && keyState === 'error') { keyState = 'none'; setKeyStatus('', ''); }
    updateConnect();
  }

  async function init() {
    settings = await SETTINGS.get();
    await readPicks();
    const cached = await cachedList();

    // Slider ranges come from the settings module, so the bounds live in one place.
    els.sidebarWidth.min = String(SETTINGS.SIDEBAR_WIDTH_MIN);
    els.sidebarWidth.max = String(SETTINGS.SIDEBAR_WIDTH_MAX);
    els.fontScale.min = String(SETTINGS.FONT_SCALE_MIN);
    els.fontScale.max = String(SETTINGS.FONT_SCALE_MAX);
    els.fontScale.step = String(SETTINGS.FONT_SCALE_STEP);
    els.addBiblesPath.textContent = C.API_BIBLE_ADD_BIBLES;
    els.setupSteps.open = setupOpen(settings.apiKey);
    buildLanguageList();
    showStoredList(cached);
    fillForm();
    renderAbout();
    els.welcomeAgain.addEventListener('click', showWelcomeAgain);

    for (const f of FIELDS) {
      if (f.key === 'apiKey') continue;
      f.node.addEventListener('input', () => {
        dirty.add(f.key);
        if (f.live) f.live(f.node.value);
      });
      f.node.addEventListener('change', () => {
        if (f.key === 'churchLanguages') onLanguageTick();
        queueCommit([f.key]);
      });
    }
    els.defaultTranslation.addEventListener('change', () => queueCommit(LIST_KEYS));

    els.apiKey.addEventListener('input', onKeyInput);
    els.apiKey.addEventListener('paste', () => setTimeout(scheduleConnect, 0));
    els.apiKey.addEventListener('change', () => {
      if (!keyFromField(els.apiKey.value)) clearKey();
      else scheduleConnect();
    });
    // Enter is Connect, and rests with it (the connected key refetches only
    // through "Check for new translations").
    els.apiKey.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (!els.connectKey.disabled) connect(true);
    });
    els.connectKey.addEventListener('click', () => connect(true));
    // Shown (so it keeps focus) while its own recheck runs: a second press
    // waits. In a paused month it rests (aria-disabled; the paused line says why).
    els.recheckKey.addEventListener('click', () => { if (keyState !== 'checking' && !paused) connect(true); });
    els.toggleKey.addEventListener('click', () => {
      const show = els.apiKey.type === 'password';
      els.apiKey.type = show ? 'text' : 'password';
      els.toggleKey.setAttribute('aria-pressed', String(show));
    });

    // Outside #churchLanguages on purpose: typing a search is not a change to
    // the language setting.
    els.langFilter.addEventListener('input', () => renderLanguageList());

    // Another context (the panel, another synced machine) changed a setting ->
    // adopt it into the form. `own` writes are this page's, already on screen.
    SETTINGS.subscribe(({ next, changed, own }) => {
      if (own) return;
      settings = next;
      if (failed) { failed = null; hideSaveError(); }
      adopt(changed);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[C.SELECTION_KEY]) picks = CHURCH.mruFrom(changes[C.SELECTION_KEY].newValue);
      const c = area === 'session' && changes[C.OPTIONS_FOCUS_KEY];
      if (c && c.newValue) takeFocusRequest();
    });

    // A write waiting out its debounce still lands if the tab closes.
    window.addEventListener('pagehide', flush);

    showKeyState();
    reveal(); // the first paint is the filled form
    listRefresh = refreshList();
    const fromHash = () => focusSection(location.hash.slice(1));
    window.addEventListener('hashchange', fromHash);
    fromHash();
    takeFocusRequest();
  }

  // The page stays hidden (options.css) until the first fill, so the empty
  // skeleton never paints. Revealed even if init fails part way.
  function reveal() { document.body.setAttribute('data-ready', ''); }

  init().finally(reveal);
})(typeof globalThis !== 'undefined' ? globalThis : this);
