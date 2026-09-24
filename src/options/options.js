/*
 * Options page: an autosaving editor of the stored settings, in three cards
 * whose ids are C.OPTIONS_SECTIONS — `bible` (api.bible key and which
 * translations the panel offers), `languages` (Church languages and where
 * they show), `reading` (text size, panel width, scroll sync, pages in other
 * languages).
 *
 * The form is an editor of the stored settings, not a second copy of them.
 * Every change is written as it happens, through __BTX.settings.patch (never
 * replace: the panel's own keys must survive), and a change made elsewhere —
 * the panel, another synced machine — is adopted through subscribe. A control
 * shows a value storage doesn't hold only while it is `dirty`: changed on
 * screen and not yet written (a slider mid-drag, a write waiting out its
 * debounce, a key being typed).
 *
 * The api.bible key is the one exception to write-as-you-go: it is connected
 * (the worker lists its versions) on paste, on change or on Connect, and
 * saved together with the translation list only when that succeeds. On open,
 * the stored list shows at once and is refreshed from the worker's cache.
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

  // ---- Pure form core (Node-testable) ------------------------------------

  const LIST_KEYS = ['enabledTranslations', 'defaultTranslationId'];

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // A version the reader added to their key. api.bible's copyrighted versions
  // all say "All rights reserved"; the free versions every key gets never do.
  function isAdded(row) {
    return /all rights reserved/i.test((row && row.copyright) || '');
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
  function versionGroups(list, onIds) {
    const on = new Set(onIds || []);
    const yours = [];
    const more = [];
    for (const r of dedupeVersions(list, onIds)) (isAdded(r) || on.has(r.id) ? yours : more).push(r);
    return { yours, more };
  }

  // A list from the worker's cache can predate a version the reader turned on
  // elsewhere; the stored rows ride along so the form still shows them on.
  function withStored(list, stored) {
    const ids = new Set((list || []).map((t) => t.id));
    return (list || []).concat((stored || []).filter((t) => t && t.id && !ids.has(t.id)));
  }

  // Which versions start checked when a key connects. The stored selection
  // decides, empty or not (the reader may have turned everything off). The one
  // exception is a `fresh` key — not the stored one — whose list shares nothing
  // with that selection: it starts with the versions the reader added to it.
  function initialChecks(list, stored, fresh) {
    const want = new Set((stored || []).map((t) => t && t.id));
    const kept = (list || []).filter((t) => want.has(t.id)).map((t) => t.id);
    if (kept.length || !fresh) return kept;
    return (list || []).filter(isAdded).map((t) => t.id);
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
  // translationPatch (`list` is its input).
  function commitPatch({ keys, values, list }) {
    const partial = {};
    let withList = false;
    for (const k of keys || []) {
      if (LIST_KEYS.indexOf(k) >= 0) withList = true;
      else if (values && Object.prototype.hasOwnProperty.call(values, k)) partial[k] = values[k];
    }
    if (withList) Object.assign(partial, translationPatch(list || {}));
    return partial;
  }

  // Did a patch land? settings.patch resolves with the previous settings when
  // the write fails (sync quota), so compare what came back with what was asked.
  function patchLanded(result, partial, normalize) {
    const want = normalize(Object.assign({}, result, partial));
    return Object.keys(partial || {}).every((k) =>
      !Object.prototype.hasOwnProperty.call(want, k) || JSON.stringify(want[k]) === JSON.stringify(result[k]));
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

  function moreLabel(n) {
    return `${plural(n, 'more free translation', 'more free translations')}`;
  }

  // The key's status line once connected, from the versions turned on.
  function connectedText(on) {
    const list = on || [];
    if (!list.length) return 'Connected. Choose the translations to show in the panel.';
    return `Connected — ${plural(list.length, 'translation', 'translations')}: ${list.map((t) => t.abbr || t.name).join(', ')}`;
  }

  // A failed connect, in words that say what to do. api.bible answers a
  // wrong key with 403, which the worker reports as INVALID_KEY.
  function keyErrorText(error) {
    const code = error && error.code;
    if (code === C.ERR.INVALID_KEY || code === C.ERR.FORBIDDEN) {
      return "api.bible didn't accept that key. Check that you copied all of it.";
    }
    if (code === C.ERR.NETWORK) return "Couldn't reach api.bible. Check your connection and try again.";
    if (code === C.ERR.RATE_LIMITED) return 'api.bible is busy. Try again in a minute.';
    const detail = (error && error.message && error.message !== code ? error.message : code) || 'no answer';
    return `Couldn't check the key (${detail}). Try again.`;
  }

  // ---- Church languages ----

  // The checklist's languages: the table minus English, which is the page's
  // own language (the reader runs on English pages unless told otherwise).
  function offeredLanguages(table) {
    return (table || []).filter((l) => l.code !== 'eng');
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
  function groupSummary(group) {
    return `${group.label} · ${plural(group.langs.length, 'language', 'languages')}`;
  }

  // The language search: case-, accent- and apostrophe-insensitive, over the
  // language's own name, its English name and its code.
  const fold = (s) => String(s || '').normalize('NFD')
    .replace(/[̀-ͯʹ-ʿ'’`]/g, '').toLowerCase();
  function matchesLanguage(lang, q) {
    const needle = fold(q).trim();
    if (!needle) return true;
    return [lang.name, lang.english, lang.code].some((f) => fold(f).indexOf(needle) >= 0);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      isAdded, dedupeVersions, versionGroups, withStored, initialChecks, pickDefaultId,
      translationPatch, commitPatch, patchLanded, fillPlan,
      versionLabel, moreLabel, connectedText, keyErrorText,
      offeredLanguages, languageGroups, groupSummary, matchesLanguage,
    };
  }
  if (typeof document === 'undefined') return; // Node: the pure core only.

  // ---- DOM shell ---------------------------------------------------------

  const SETTINGS = root.__BTX.settings;
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
    versions: $('versions'),
    yoursEmpty: $('yoursEmpty'),
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
    showOnOtherLanguages: $('showOnOtherLanguages'),
  };

  let settings = SETTINGS.defaults();
  let available = []; // the versions the list is drawn from: [{ id, name, abbr, description, copyright, provider }]
  let versionsLoaded = false; // is the list on screen a faithful view (loaded, or the stored rows)?
  let keyState = 'none'; // 'none' | 'checking' | 'connected' | 'error'
  let connectSeq = 0; // the newest list request owns the status line
  let lastTried = ''; // the key a paste/change last tried, so a blur doesn't retry it
  let connectTimer = 0;

  // Keys changed on screen and not yet written. They outrank a change
  // arriving from elsewhere, so those controls are left alone.
  const dirty = new Set();

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

  // ---- Autosave ----

  const queued = new Set();
  let flushTimer = 0;
  let failedKeys = null;
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
    return write(commitPatch({ keys, values, list: listState() }), keys);
  }

  // The one path to storage. `quiet` skips the "Saved" flash.
  async function write(partial, keys, quiet) {
    let ok = true;
    if (Object.keys(partial).length) {
      let result;
      try { result = await SETTINGS.patch(partial); } catch (e) { result = settings; }
      ok = patchLanded(result, partial, SETTINGS.normalize);
      settings = result;
    }
    for (const k of keys) if (!queued.has(k)) dirty.delete(k);
    if (ok) {
      failedKeys = null;
      if (!quiet && Object.keys(partial).length) showSaved();
    } else {
      failedKeys = keys;
      showSaveError();
    }
    return ok;
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
    s.textContent = "Couldn't save. ";
    const retry = el('button', 'retry', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', () => {
      const keys = failedKeys || [];
      failedKeys = null;
      s.className = 'save-status';
      queueCommit(keys);
      flush();
    });
    s.appendChild(retry);
    s.className = 'save-status show error';
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
  function renderTranslations(onIds, wanted) {
    const { yours, more } = versionGroups(available, onIds);
    const on = new Set(onIds || []);
    els.yoursRows.textContent = '';
    els.moreRows.textContent = '';
    for (const t of yours) els.yoursRows.appendChild(versionRow(t, on.has(t.id)));
    for (const t of more) els.moreRows.appendChild(versionRow(t, on.has(t.id)));
    els.versions.hidden = !available.length;
    els.yoursEmpty.hidden = yours.length > 0;
    els.moreVersions.hidden = !more.length;
    els.moreSummary.textContent = moreLabel(more.length);
    refreshDefaultOptions(wanted);
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

  function setKeyStatus(text, kind) {
    els.keyStatus.textContent = text;
    els.keyStatus.className = 'status' + (kind ? ' ' + kind : '');
  }

  function showKeyState() {
    if (keyState === 'connected') setKeyStatus(connectedText(checkedTranslations()), 'ok');
    else if (keyState === 'checking') setKeyStatus('Checking…', 'busy');
    else if (keyState === 'none') setKeyStatus('', '');
    updateConnect();
  }

  function updateConnect() {
    els.connectKey.disabled = !els.apiKey.value.trim() || keyState === 'checking';
  }

  // The stored list, as the form's first picture of it: shown at once, with
  // no wait on the key and no jump when the refreshed list lands.
  function showStoredList() {
    const stored = settings.apiKey ? settings.enabledTranslations : [];
    available = stored.slice();
    versionsLoaded = stored.length > 0;
    keyState = !settings.apiKey ? 'none' : stored.length ? 'connected' : 'checking';
  }

  // Re-read the stored key's versions (the worker's cache when it has them) and
  // redraw the list around what is on screen. Nothing is written: a cached list
  // can be a day old, so it only ever adds rows.
  async function refreshList() {
    if (!settings.apiKey) return;
    const seq = ++connectSeq;
    if (!available.length) { keyState = 'checking'; showKeyState(); }
    const res = await send({ type: C.MSG.LIST_BIBLES });
    if (seq !== connectSeq) return;
    if (res.error) {
      keyState = 'error';
      setKeyStatus(keyErrorText(res.error), 'error');
      updateConnect();
      return;
    }
    const onIds = versionsLoaded ? checkedTranslations().map((t) => t.id) : settings.enabledTranslations.map((t) => t.id);
    const wanted = versionsLoaded ? els.defaultTranslation.value : settings.defaultTranslationId;
    available = withStored(res.bibles || [], settings.enabledTranslations);
    versionsLoaded = true;
    keyState = 'connected';
    renderTranslations(onIds, wanted);
    showKeyState();
  }

  // Try the key in the field; on success save it with the list it unlocks.
  // `explicit` (Connect, Enter) fetches afresh — the reader may have just added
  // a version at api.bible — where an automatic try takes the cache.
  async function connect(explicit) {
    clearTimeout(connectTimer);
    const key = els.apiKey.value.trim();
    if (!key) return;
    lastTried = key;
    const seq = ++connectSeq;
    keyState = 'checking';
    showKeyState();
    const res = await send({ type: C.MSG.LIST_BIBLES, key, refresh: !!explicit });
    if (seq !== connectSeq) return;
    const stored = key === settings.apiKey;

    if (res.error) {
      keyState = 'error';
      // A rejected key, or a key that isn't the stored one: the list on screen
      // no longer belongs to anything. A stored key that merely couldn't be
      // reached keeps its list.
      const rejected = res.error.code === C.ERR.INVALID_KEY || res.error.code === C.ERR.FORBIDDEN;
      if (rejected || !stored) {
        available = [];
        versionsLoaded = false;
        renderTranslations([], '');
      }
      setKeyStatus(keyErrorText(res.error), 'error');
      updateConnect();
      return;
    }

    available = res.bibles || [];
    versionsLoaded = true;
    keyState = 'connected';
    renderTranslations(initialChecks(available, settings.enabledTranslations, !stored), settings.defaultTranslationId);
    showKeyState();
    const partial = Object.assign({ apiKey: key }, translationPatch(listState()));
    if (SETTINGS.diff(settings, Object.assign({}, settings, partial)).length) await write(partial, ['apiKey'].concat(LIST_KEYS));
    else dirty.delete('apiKey');
  }

  function scheduleConnect() {
    clearTimeout(connectTimer);
    connectTimer = setTimeout(() => {
      const key = els.apiKey.value.trim();
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
    keyState = 'none';
    renderTranslations([], '');
    showKeyState();
    if (settings.apiKey) write({ apiKey: '' }, ['apiKey']);
    else dirty.delete('apiKey');
  }

  // ---- Church languages ----

  const langRows = []; // { lang, label, group }
  const langGroups = []; // <details>

  function buildLanguageList() {
    languageGroups(offeredLanguages(C.CHURCH_LANGUAGES)).forEach((group, i) => {
      const details = el('details', 'lang-group');
      details.open = i === 0;
      const summary = el('summary', '', groupSummary(group));
      const grid = el('div', 'checklist-grid');
      grid.setAttribute('role', 'group');
      grid.setAttribute('aria-label', group.label);
      for (const lang of group.langs) {
        const label = el('label', 'check');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.value = lang.code;
        const text = el('span', 'lang-name');
        text.appendChild(nativeName(lang));
        if (lang.name !== lang.english) text.appendChild(el('span', 'lang-en', ` — ${lang.english}`));
        label.appendChild(cb);
        label.appendChild(text);
        grid.appendChild(label);
        langRows.push({ lang, label, group: details });
      }
      details.appendChild(summary);
      details.appendChild(grid);
      els.churchLanguages.appendChild(details);
      langGroups.push(details);
    });
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
    // A group holding a chosen language opens, so the choice is in view.
    for (const row of langRows) if (want.has(row.lang.code)) row.group.open = true;
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

  function applyLanguageFilter() {
    const q = els.langFilter.value;
    const filtering = !!q.trim();
    let shown = 0;
    for (const details of langGroups) {
      let n = 0;
      for (const row of langRows) {
        if (row.group !== details) continue;
        const hit = matchesLanguage(row.lang, q);
        row.label.hidden = !hit;
        if (hit) n++;
      }
      details.hidden = n === 0;
      // Every group opens while searching; clearing the search puts back
      // what the reader had open.
      if (filtering) {
        if (!('wasOpen' in details.dataset)) details.dataset.wasOpen = details.open ? '1' : '';
        details.open = true;
      } else if ('wasOpen' in details.dataset) {
        details.open = details.dataset.wasOpen === '1' || details.querySelector('input:checked') != null;
        delete details.dataset.wasOpen;
      }
      shown += n;
    }
    els.langNoMatch.hidden = shown > 0;
    els.langNoMatch.textContent = shown ? '' : `No language matches “${q.trim()}”.`;
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

  // The single-value settings this form edits, each paired with the control
  // that shows it. One table, so the autosave and the live refresh can't
  // disagree about which control holds which setting. `live` sliders mark
  // dirty on every step of a drag and write on release. The translation list
  // is not here — it is built from the key, not from one control — but it
  // goes through the same dirty flag, the same write and the same fill plan.
  const FIELDS = [
    { key: 'apiKey', node: els.apiKey, read: () => els.apiKey.value.trim(), write: (v) => { els.apiKey.value = v; } },
    // A group of checkboxes, but one setting: its change events bubble to the
    // container, which is what writes it.
    { key: 'churchLanguages', node: els.churchLanguages, read: checkedLanguages, write: checkLanguages },
    { key: 'churchLanguageLayout', node: els.layout, read: readLayout, write: writeLayout },
    {
      key: 'fontScale',
      node: els.fontScale,
      live: (v) => { els.fontScaleOut.textContent = pct(v); },
      // Stored as a multiplier, shown as a percentage — the slider walks the
      // multiplier so the module's clamp/step is the only rule about it.
      read: () => els.fontScale.value,
      write: (v) => { els.fontScale.value = String(v); els.fontScaleOut.textContent = pct(v); },
    },
    {
      key: 'sidebarWidth',
      node: els.sidebarWidth,
      live: (v) => { els.sidebarWidthOut.textContent = px(v); },
      read: () => els.sidebarWidth.value,
      write: (v) => { els.sidebarWidth.value = String(v); els.sidebarWidthOut.textContent = px(v); },
    },
    { key: 'scrollSync', node: els.scrollSync, read: () => els.scrollSync.checked, write: (v) => { els.scrollSync.checked = v; } },
    // Stored as "English pages only"; asked the other way round.
    {
      key: 'actOnNonEngOnly',
      node: els.showOnOtherLanguages,
      read: () => !els.showOnOtherLanguages.checked,
      write: (v) => { els.showOnOtherLanguages.checked = !v; },
    },
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

  // ---- Deep links ----

  function focusSection(section) {
    if (C.OPTIONS_SECTIONS.indexOf(section) < 0) return;
    const card = $(section);
    card.scrollIntoView({ block: 'start' });
    card.classList.remove('flash');
    void card.offsetWidth; // restart the highlight
    card.classList.add('flash');
    let target = els.fontScale;
    if (section === 'languages') target = els.langFilter;
    if (section === 'bible') {
      const first = keyState === 'connected' && versionInputs().find((c) => !c.closest('[hidden]') && !c.closest('details:not([open])'));
      target = first || els.apiKey;
    }
    target.focus({ preventScroll: true });
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

  async function init() {
    settings = await SETTINGS.get();

    // Slider ranges come from the settings module, so the bounds live in one place.
    els.sidebarWidth.min = String(SETTINGS.SIDEBAR_WIDTH_MIN);
    els.sidebarWidth.max = String(SETTINGS.SIDEBAR_WIDTH_MAX);
    els.fontScale.min = String(SETTINGS.FONT_SCALE_MIN);
    els.fontScale.max = String(SETTINGS.FONT_SCALE_MAX);
    els.fontScale.step = String(SETTINGS.FONT_SCALE_STEP);
    buildLanguageList();
    showStoredList();
    fillForm();

    for (const f of FIELDS) {
      if (f.key === 'apiKey') continue;
      f.node.addEventListener('input', () => {
        dirty.add(f.key);
        if (f.live) f.live(f.node.value);
      });
      f.node.addEventListener('change', () => {
        if (f.key === 'churchLanguages') showLanguageSummary();
        queueCommit([f.key]);
      });
    }
    els.defaultTranslation.addEventListener('change', () => queueCommit(LIST_KEYS));

    els.apiKey.addEventListener('input', () => { dirty.add('apiKey'); updateConnect(); });
    els.apiKey.addEventListener('paste', () => setTimeout(scheduleConnect, 0));
    els.apiKey.addEventListener('change', () => {
      if (!els.apiKey.value.trim()) clearKey();
      else scheduleConnect();
    });
    els.apiKey.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); connect(true); }
    });
    els.connectKey.addEventListener('click', () => connect(true));
    els.toggleKey.addEventListener('click', () => {
      const show = els.apiKey.type === 'password';
      els.apiKey.type = show ? 'text' : 'password';
      els.toggleKey.setAttribute('aria-pressed', String(show));
    });

    // Outside #churchLanguages on purpose: typing a search is not a change to
    // the language setting.
    els.langFilter.addEventListener('input', applyLanguageFilter);

    // Another context (the panel, another synced machine) changed a setting ->
    // adopt it into the form. `own` writes are this page's, already on screen.
    SETTINGS.subscribe(({ next, changed, own }) => {
      if (own) return;
      settings = next;
      if (changed.indexOf('apiKey') >= 0 && !dirty.has('apiKey')) {
        connectSeq++;
        showStoredList();
        fillForm(changed.concat(LIST_KEYS));
        refreshList();
        return;
      }
      fillForm(changed);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      const c = area === 'session' && changes[C.OPTIONS_FOCUS_KEY];
      if (c && c.newValue) takeFocusRequest();
    });

    // A write waiting out its debounce still lands if the tab closes.
    window.addEventListener('pagehide', flush);

    showKeyState();
    refreshList();
    const fromHash = () => focusSection(location.hash.slice(1));
    window.addEventListener('hashchange', fromHash);
    fromHash();
    takeFocusRequest();
  }

  init();
})(typeof globalThis !== 'undefined' ? globalThis : this);
