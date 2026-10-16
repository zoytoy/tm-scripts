// ==UserScript==
// @name         Contest Comment Helper (Instagram + Facebook)
// @namespace    http://tampermonkey.net/
// @version      2.0.7
// @description  "Comment your answer (+ #tag)" contests on Instagram and Facebook (ONLY on posts by accounts/pages listed in POSTERS_IG / POSTERS_FB): reads the comments, finds the most common answer (only among comments using the post's hashtag IF it asks for one), and types it into the comment box. NEVER clicks Post - you review it and post it yourself.
// @match        https://www.instagram.com/*
// @match        https://www.facebook.com/*
// @noframes
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @updateURL    https://raw.githubusercontent.com/zoytoy/tm-scripts/main/contestcomment.user.js
// @downloadURL  https://raw.githubusercontent.com/zoytoy/tm-scripts/main/contestcomment.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Config ----------
  const AUTO_RUN = true;        // scan automatically when a post opens
  const AUTO_FILL = true;       // type the winning answer into the box (it never posts)
  const START_DELAY_MS = 2500;  // wait after the post opens before scanning
  const MIN_VOTES = 3;          // auto-fill only if at least this many comments agree
  const TAG_OVERRIDE = '';      // e.g. '#playfame' to force the required hashtag
  const LOG = '[Contest]';
  // The script does NOTHING on a post unless its poster is listed here.
  // Instagram: the username (no @). Facebook: the page's URL name (facebook.com/<name>).
  // These two lines are edited by the Tampermonkey menu via GitHub - keep each on one line.
  const POSTERS_IG = ['play.fame', 'hellomillions.official', 'spinblitz.official', 'mcluck.com.official', 'americanluckcasino', 'casinofanaticandy'];
  const POSTERS_FB = ['hellomillions', 'mcluckdotcom', 'spinblitz.official', 'americanluck', 'playfame.official', 'fortunewinsofficial'];
  const norm = p => String(p || '').trim().toLowerCase().replace(/^@/, '');

  // This script has no code path that clicks Post / presses Enter. Do not add one.

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = (...a) => console.log(LOG, ...a);

  async function waitFor(fn, timeout = 10000, step = 300) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  // ---------- Shared text helpers ----------
  const TAG_RE = /#[\p{L}\p{N}_]+/gu;
  const tagsIn = t => (t.match(TAG_RE) || []).map(x => x.toLowerCase());
  const stripTags = t => t.replace(TAG_RE, ' ').replace(/\s+/g, ' ').trim();
  function answerOf(t) {
    let a = t.replace(TAG_RE, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (/^[\d\s]+$/.test(a)) a = a.replace(/\s+/g, ''); // number answers: "3,4,5,7" and "3457" are the same answer
    return a;
  }

  // Reads the caption sentence like "Drop your answer in the comments + #PlayFame." and returns the hashtag(s) in it.
  const CUE_RE = /\b(comments?|commenting|answer|drop|reply|respond|type|write|include|add|use|using|tell)\b|\+/i;
  function instructionTags(text, caps) {
    const found = [];
    for (const s of text.split(/(?<=[.!?])\s*|\n+/)) {
      const tags = tagsIn(s);
      if (!tags.length || tags.length > 2 || !CUE_RE.test(s)) continue; // 3+ tags in a row = a hashtag dump, not an instruction
      for (const t of tags) if (caps.has(t) && !found.includes(t)) found.push(t);
    }
    return found;
  }

  // ===================================================================
  // ===== INSTAGRAM =====
  // ===================================================================
  const IG = (() => {
    const MAX_SCROLL_STEPS = 8;   // how many times to scroll the comment panel to load more
    const SCROLL_PAUSE_MS = 900;
    const RESERVED = new Set(['reels', 'reel', 'explore', 'direct', 'accounts', 'p', 'stories', 'tv', 'about', 'legal', 'web', 'popular', 'developer']);

    const BOX_SEL = 'textarea[aria-label*="comment" i], textarea[placeholder*="comment" i], ' +
      '[contenteditable="true"][aria-label*="comment" i], div[role="textbox"][aria-label*="comment" i]';

    function findBox() {
      const dialog = [...document.querySelectorAll('[role="dialog"]')].find(d => d.querySelector(BOX_SEL));
      const scope = dialog || document;
      return [...scope.querySelectorAll(BOX_SEL)].find(e => e.getClientRects().length) || null;
    }

    const findRoot = box => box.closest('article, [role="dialog"], main') || document.body;

    const keyOf = a => (a.getAttribute('href') || '').split('?')[0];

    function commentLinks(root) {
      return [...root.querySelectorAll('a[href*="/c/"]')].filter(a => /\/c\/\d+\/(?:r\/\d+\/?)?$/.test(keyOf(a)));
    }

    // Climb from a comment's timestamp link to the largest ancestor that still holds only that one comment.
    function rowFor(link, root) {
      let node = link;
      while (node.parentElement && node.parentElement !== root) {
        const p = node.parentElement;
        if (/^(UL|OL|MAIN|ARTICLE|BODY|FORM)$/.test(p.tagName)) break;
        if (p.querySelector('textarea, [contenteditable="true"], form')) break;
        if (new Set(commentLinks(p).map(keyOf)).size > 1) break;
        node = p;
      }
      return node;
    }

    const NOISE = new Set(['Edited', 'Pinned', 'Verified', '•', '·']);

    function rowParts(row) {
      let user = '';
      for (const a of row.querySelectorAll('a[href]')) {
        const m = (a.getAttribute('href') || '').match(/^\/([^/]+)\/$/);
        if (m && a.textContent.trim()) { user = m[1]; break; }
      }
      const skip = n => {
        for (let p = n.parentElement; p; p = p.parentElement) {
          if (p.matches('button, [role="button"], time, svg, textarea, form')) return true;
          if (p.tagName === 'A') {
            const h = p.getAttribute('href') || '';
            if (/\/c\/\d+\//.test(h) || (user && h === '/' + user + '/')) return true;
          }
          if (p === row) break;
        }
        return false;
      };
      const w = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      let text = '';
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const s = n.nodeValue;
        if (!s || skip(n) || NOISE.has(s.trim())) continue;
        if (n.parentElement.closest('a') && text && !/\s$/.test(text)) text += ' ';
        text += s;
      }
      return { user, text: text.replace(/\s+/g, ' ').trim() };
    }

    function parseComments(root) {
      const seen = new Set();
      const out = [];
      for (const a of commentLinks(root)) {
        const key = keyOf(a);
        if (/\/r\/\d+/.test(key) || seen.has(key)) continue; // top-level comments only, not replies
        seen.add(key);
        const { user, text } = rowParts(rowFor(a, root));
        out.push({ user, text, tags: tagsIn(text), answer: answerOf(text) });
      }
      return out;
    }

    function captionTags(root, rows) {
      const out = new Map();
      root.querySelectorAll('a[href^="/explore/tags/"]').forEach(a => {
        if (rows.some(r => r.contains(a))) return;
        const t = a.textContent.trim();
        if (t.startsWith('#')) out.set(t.toLowerCase(), t);
      });
      return out;
    }

    function captionText(root, rows) {
      const link = [...root.querySelectorAll('a[href^="/explore/tags/"]')]
        .find(a => !rows.some(r => r.contains(a)) && a.textContent.trim().startsWith('#'));
      if (!link) return '';
      let node = link.parentElement;
      while (node && node !== root) {
        if (rows.some(r => node.contains(r)) || node.querySelector('textarea, [contenteditable="true"], form')) return '';
        const t = node.innerText || node.textContent || '';
        if (t.replace(TAG_RE, '').trim().length >= 20) return t;
        node = node.parentElement;
      }
      return '';
    }

    function scrollParent(el) {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowY;
        if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight + 5) return p;
      }
      return null;
    }

    async function loadAll(root) {
      const first = commentLinks(root)[0];
      const sc = first && scrollParent(first);
      const y = window.scrollY;
      let last = -1, still = 0;
      for (let i = 0; i < MAX_SCROLL_STEPS; i++) {
        const n = new Set(commentLinks(root).map(keyOf)).size;
        if (n === last) { if (++still >= 2) break; } else still = 0;
        last = n;
        const more = root.querySelector('svg[aria-label="Load more comments"]');
        if (more) (more.closest('button, [role="button"]') || more).click();
        if (sc) sc.scrollTop = sc.scrollHeight; else window.scrollTo(0, document.body.scrollHeight);
        await sleep(SCROLL_PAUSE_MS);
      }
      if (sc) sc.scrollTop = 0; else window.scrollTo(0, y);
    }

    // /<user>/p/<code>/ URLs name the poster directly; otherwise take the first profile link in the post (its header).
    function posterName() {
      const m = location.pathname.match(/^\/([^/]+)\/(?:p|reel)\//);
      if (m) return m[1].toLowerCase();
      const box = findBox();
      const root = box ? findRoot(box) : document.querySelector('main');
      if (!root) return '';
      for (const a of root.querySelectorAll('a[href]')) {
        const h = (a.getAttribute('href') || '').match(/^\/([^/]+)\/$/);
        if (h && !RESERVED.has(h[1].toLowerCase()) && a.textContent.trim()) return h[1].toLowerCase();
      }
      return '';
    }

    async function gather(box) {
      const root = findRoot(box);
      if (!(await waitFor(() => commentLinks(root).length, 8000))) return { error: 'No comments yet.' };
      await loadAll(root);
      const rows = commentLinks(root).map(a => rowFor(a, root));
      return { comments: parseComments(root), caps: captionTags(root, rows), text: captionText(root, rows) };
    }

    return {
      key: 'ig',
      title: 'IG Contest Helper',
      noun: 'poster',
      listName: 'POSTERS_IG',
      builtin: POSTERS_IG,
      crowdFallback: true,       // no hashtag asked for in the caption -> use the one commenters use most
      badgeLeft: '76px',
      navKey: () => location.pathname,
      isPostView: () => /^\/(?:[^/]+\/)?(?:p|reel)\/[^/]+/.test(location.pathname),
      guardId: () => (location.pathname.match(/\/(?:p|reel)\/([^/]+)/) || [])[1] || location.pathname,
      label: p => '@' + p,
      validName: p => /^[a-z0-9._]{1,30}$/.test(p),
      badName: 'an Instagram username (letters, numbers, . and _ only)',
      promptName: 'Instagram username to add (no @):',
      findBox, posterName, gather, parseComments,
    };
  })();

  // ===================================================================
  // ===== FACEBOOK =====
  // ===================================================================
  const FB = (() => {
    const MAX_LOAD_STEPS = 10;    // how many times to click "View more comments"
    const LOAD_PAUSE_MS = 1300;
    const RESERVED = new Set(['photo', 'photos', 'watch', 'reel', 'reels', 'groups', 'hashtag', 'marketplace', 'gaming', 'events', 'pages',
      'friends', 'stories', 'login', 'help', 'policies', 'privacy', 'ads', 'bookmarks', 'notifications', 'messages', 'search', 'settings',
      'permalink.php', 'story.php', 'share', 'sharer', 'video', 'videos', 'people', 'public', 'recover', 'checkpoint', 'saved', 'memories']);

    const BOX_SEL = '[role="textbox"][aria-label*="comment" i], [contenteditable="true"][aria-label*="comment" i]';
    const findBox = () => [...document.querySelectorAll(BOX_SEL)].find(e => e.getClientRects().length) || null;

    const COMMENT_SEL = '[role="article"][aria-label^="Comment by"]';
    const rowEls = () => [...document.querySelectorAll(COMMENT_SEL)].filter(e => !e.parentElement.closest(COMMENT_SEL));

    const NOISE = new Set(['·', '•', 'Edited', 'Top fan', 'Author', 'Admin', 'Moderator', 'Verified', 'Rising fan', 'Fan', 'Pinned', 'Reply', 'Like', 'Share']);

    function commentParts(row) {
      const label = row.getAttribute('aria-label') || '';
      const user = label.replace(/^Comment by /, '').replace(/\s+\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i, '').trim();
      const skip = n => {
        for (let p = n.parentElement; p && p !== row.parentElement; p = p.parentElement) {
          if (p.matches('button, [role="button"], svg, time, form, [role="textbox"]')) return true;
          if (p.tagName === 'A' && !/\/hashtag\//.test(p.getAttribute('href') || '')) return true; // author name, timestamp
          if (p === row) break;
        }
        return false;
      };
      const w = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      let text = '';
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const s = n.nodeValue;
        if (!s || !s.trim() || skip(n) || NOISE.has(s.trim())) continue;
        text += (text ? ' ' : '') + s;
      }
      return { user, text: text.replace(/\s+/g, ' ').trim() };
    }

    function parseComments(root) {
      const seen = new Set(), out = [];
      for (const row of rowEls()) {
        if (!root.contains(row)) continue;
        const { user, text } = commentParts(row);
        const key = (row.getAttribute('aria-label') || '') + '|' + text;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ user, text, tags: tagsIn(text), answer: answerOf(text) });
      }
      return out;
    }

    function profileSlug(a) {
      let u;
      try { u = new URL(a.getAttribute('href') || '', location.origin); } catch (e) { return ''; }
      if (!/(^|\.)facebook\.com$/.test(u.hostname)) return '';
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length !== 1) return '';
      if (parts[0] === 'profile.php') { const id = u.searchParams.get('id'); return id ? 'profile.php?id=' + id : ''; }
      const s = parts[0].toLowerCase();
      return RESERVED.has(s) ? '' : s;
    }

    function headerSlug(node) {
      for (const a of node.querySelectorAll('a[href]')) {
        if (a.closest(COMMENT_SEL)) continue;
        if (!(a.textContent.trim() || a.getAttribute('aria-label'))) continue;
        const s = profileSlug(a);
        if (s) return s;
      }
      return '';
    }

    // Climb from the first comment (or the comment box) to the smallest container that also holds the post header.
    function postRootFrom(start) {
      let node = start;
      for (let i = 0; node && node !== document.body && i < 40; i++, node = node.parentElement) {
        const slug = headerSlug(node);
        if (slug) return { root: node, slug };
      }
      return null;
    }

    const posterName = () => {
      const s = rowEls()[0] || findBox();
      const pr = s && postRootFrom(s);
      return pr ? pr.slug : '';
    };

    const captionTagLinks = root =>
      [...root.querySelectorAll('a[href*="/hashtag/"]')].filter(a => !a.closest(COMMENT_SEL) && a.textContent.trim().startsWith('#'));

    function captionTags(root) {
      const out = new Map();
      captionTagLinks(root).forEach(a => { const t = a.textContent.trim(); out.set(t.toLowerCase(), t); });
      return out;
    }

    function captionText(root) {
      const link = captionTagLinks(root)[0];
      if (!link) return '';
      let node = link.parentElement;
      while (node && node !== root.parentElement) {
        if (node.querySelector(COMMENT_SEL)) return '';
        const t = node.innerText || node.textContent || '';
        if (t.replace(TAG_RE, '').trim().length >= 20) return t;
        node = node.parentElement;
      }
      return '';
    }

    async function loadAll() {
      let last = -1, still = 0;
      for (let i = 0; i < MAX_LOAD_STEPS; i++) {
        const n = rowEls().length;
        if (n === last) { if (++still >= 2) break; } else still = 0;
        last = n;
        const more = [...document.querySelectorAll('[role="button"]')]
          .find(b => /^(view|see) (\d+ )?(more|previous) comments?$/i.test(b.textContent.trim()));
        if (more) more.click();
        else break;
        await sleep(LOAD_PAUSE_MS);
      }
    }

    async function gather(box) {
      if (!(await waitFor(() => rowEls().length, 8000))) return { error: 'No comments yet.' };
      await loadAll();
      const pr = postRootFrom(rowEls()[0] || box);
      const root = pr ? pr.root : document.body;
      return { comments: parseComments(root), caps: captionTags(root), text: captionText(root) };
    }

    return {
      key: 'fb',
      title: 'FB Contest Helper',
      noun: 'page',
      listName: 'POSTERS_FB',
      builtin: POSTERS_FB,
      crowdFallback: false,      // a hashtag is required ONLY when the caption's instruction asks for one
      badgeLeft: '16px',
      navKey: () => location.pathname + location.search,
      isPostView: () => /^\/photo(\.php)?\/?$/.test(location.pathname) || /\/(posts|videos|permalink|reel)\//.test(location.pathname) ||
        /^\/(watch|story\.php|permalink\.php)/.test(location.pathname),
      guardId: () => location.pathname + location.search,
      label: p => p,
      validName: p => /^[a-z0-9._-]{1,80}$/.test(p) || /^profile\.php\?id=\d+$/.test(p),
      badName: 'a Facebook page name (the part after facebook.com/ - letters, numbers, . _ - only)',
      promptName: 'Facebook page name to add (the part after facebook.com/):',
      findBox, posterName, gather, parseComments,
    };
  })();

  const P = /(^|\.)instagram\.com$/.test(location.hostname) ? IG : FB;
  const BUILTIN = new Set(P.builtin.map(norm)); // the shared list; the Tampermonkey menu adds to it via GitHub

  // ---------- Filling the box (never submits) ----------
  const boxText = b => ('value' in b ? b.value : b.textContent) || '';

  // Did the text land? The site may re-render the box, so check the original, a freshly found one and the focused element.
  const landed = (box, text) => {
    const a = document.activeElement;
    const focusedEditor = a && (a.isContentEditable || a.tagName === 'TEXTAREA') ? a : null; // never body: it contains the whole page's text
    return [box, P.findBox(), focusedEditor].some(e => e && boxText(e).includes(text));
  };

  async function waitLanded(box, text, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (landed(box, text)) return true;
      await sleep(100);
    }
    return landed(box, text);
  }

  // Focus the box and put the selection inside it (a bare selectAll can select the whole page if focus didn't take).
  function focusBox(box) {
    box.focus();
    if (!box.contains(document.activeElement)) { box.click(); box.focus(); }
    const sel = window.getSelection(), r = document.createRange();
    r.selectNodeContents(box);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  async function fillBox(box, text) {
    if (box.tagName === 'TEXTAREA' || box.tagName === 'INPUT') {
      box.focus();
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'value').set.call(box, text);
      box.dispatchEvent(new Event('input', { bubbles: true }));
      return waitLanded(box, text, 1500);
    }
    // Rich-text editors (Facebook's Lexical) differ in what they accept, so try several ways until one sticks.
    const methods = {
      execCommand: () => document.execCommand('insertText', false, text),
      paste: b => {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        b.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      },
      beforeinput: b => b.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true })),
    };
    for (const [name, run] of Object.entries(methods)) {
      const b = box.isConnected ? box : (P.findBox() || box); // the box may have been re-rendered since the scan
      try { focusBox(b); run(b); } catch (e) { log('fill method failed:', name, e); continue; }
      if (await waitLanded(b, text, 1500)) { log('typed via', name); return true; }
      log('fill method had no effect:', name);
    }
    return false;
  }

  const guardKey = () => 'ch_filled_' + P.key + '_' + P.guardId();
  const wasFilled = () => { try { return !!sessionStorage.getItem(guardKey()); } catch (e) { return false; } };
  const markFilled = () => { try { sessionStorage.setItem(guardKey(), '1'); } catch (e) { /* ignore */ } };

  // When the caption doesn't say which hashtag to use, still find the casino's own tag so the comment reads "Answer #Casino":
  // 1) a caption hashtag matching the page/account name (spinblitz.official -> #SpinBlitz), 2) the caption hashtag commenters
  // use most, 3) the only hashtag in the caption.
  function fallbackTag(caps, comments, poster) {
    const key = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const pk = key(poster);
    if (pk.length >= 4) {
      for (const t of caps.keys()) {
        const tk = key(t);
        if (tk.length >= 4 && (pk.includes(tk) || tk.includes(pk))) return { tag: t, from: 'matches page name' };
      }
    }
    let crowd = '', best = 0;
    for (const t of caps.keys()) {
      const n = comments.filter(c => c.tags.includes(t)).length;
      if (n > best) { best = n; crowd = t; }
    }
    if (crowd) return { tag: crowd, from: 'most used by commenters' };
    if (caps.size === 1) return { tag: [...caps.keys()][0], from: 'only caption hashtag' };
    return null;
  }

  // ---------- Scan ----------
  let busy = false;

  async function scan(opts = {}) {
    const res = { status: '', tag: '', tagFrom: '', note: '', tally: [], pick: '', filled: false, total: 0, tagged: 0 };
    if (busy) { res.status = 'Already scanning...'; return res; }
    busy = true;
    try {
      const box = await waitFor(P.findBox, 10000);
      if (!box) { res.status = 'No comment box found.'; return res; }
      const g = await P.gather(box);
      if (g.error) { res.status = g.error; return res; }
      const { comments, caps } = g;
      res.total = comments.length;

      const useCount = t => comments.filter(c => c.tags.includes(t)).length;
      let reqTag = TAG_OVERRIDE.toLowerCase();
      // 1) the hashtag the caption's instruction names ("...comments + #PlayFame")
      const asked = reqTag ? [] : instructionTags(g.text, caps);
      if (!reqTag && asked.length) reqTag = asked.slice().sort((a, b) => useCount(b) - useCount(a))[0];
      res.tagFrom = !reqTag ? 'none required' : TAG_OVERRIDE ? 'override' : 'caption instruction';

      if (P.crowdFallback) {
        // 2) otherwise the caption hashtag commenters used most
        let crowdTag = '', best = 0;
        for (const t of caps.keys()) { const n = useCount(t); if (n > best) { best = n; crowdTag = t; } }
        if (!reqTag) { reqTag = crowdTag; res.tagFrom = 'most used by commenters'; }
        if (!reqTag) {
          res.status = caps.size ? 'No comment uses a caption hashtag yet.' : 'No hashtag found in the caption.';
          return res;
        }
        if (asked.length && crowdTag && crowdTag !== reqTag) {
          res.note = 'Commenters mostly used ' + (caps.get(crowdTag) || crowdTag) + ' - the post asks for ' + (caps.get(reqTag) || reqTag) + '.';
        }
      }
      // The comment we type is always "Answer #Casino". If the caption didn't name a hashtag, still find the casino's own tag.
      let outTag = reqTag;
      if (!outTag) {
        const fb = fallbackTag(caps, comments, P.posterName());
        if (fb) { outTag = fb.tag; res.tagFrom = fb.from; }
        else res.note = 'No casino hashtag found in the caption - typed without one.';
      }
      res.tag = outTag ? (caps.get(outTag) || outTag) : '';

      const pool = reqTag ? comments.filter(c => c.tags.includes(reqTag) && c.answer) : comments.filter(c => c.answer);
      res.tagged = pool.length;
      const groups = new Map();
      for (const c of pool) {
        const grp = groups.get(c.answer) || { count: 0, raws: new Map() };
        grp.count++;
        const raw = stripTags(c.text) || c.text; // the answer itself; the tag is added back below in a fixed position
        grp.raws.set(raw, (grp.raws.get(raw) || 0) + 1);
        groups.set(c.answer, grp);
      }
      const sorted = [...groups.entries()].sort((a, b) => b[1].count - a[1].count);
      res.tally = sorted.slice(0, 6).map(([ans, grp]) => [ans, grp.count]);
      if (!sorted.length) { res.status = reqTag ? 'No comment uses ' + res.tag + ' yet.' : 'No answers yet.'; return res; }

      const [, top] = sorted[0];
      const tie = sorted[1] && sorted[1][1].count === top.count;
      const answer = [...top.raws.entries()].sort((a, b) => b[1] - a[1])[0][0]; // most common wording of the winning answer
      res.pick = res.tag ? answer + ' ' + res.tag : answer;                     // "Response #Casino"

      const fillIt = opts.fill ?? AUTO_FILL;
      if (!fillIt) { res.status = 'Scan only (fill off).'; return res; }
      if (!opts.force) {
        if (top.count < MIN_VOTES) { res.status = 'Only ' + top.count + ' vote(s) so far - not filled.'; return res; }
        if (wasFilled()) { res.status = 'Already filled once for this post.'; return res; }
      }
      if (boxText(box).trim()) { res.status = 'Comment box already has text - left alone.'; return res; }
      if (await fillBox(box, res.pick)) {
        markFilled();
        res.filled = true;
        res.status = tie ? 'TIE for first place - typed one of them. Check it and edit if needed, then click Post yourself.' : 'Typed into the box. Review it, then click Post yourself.';
      } else {
        res.status = 'Could not type into the box.';
      }
      return res;
    } finally {
      busy = false;
    }
  }

  // ---------- Badge ----------
  const BADGE_ID = 'ch-badge';
  const removeBadge = () => { const b = document.getElementById(BADGE_ID); if (b) b.remove(); };

  function el(tag, text, css) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (css) e.style.cssText = css;
    return e;
  }

  function render(res) {
    removeBadge();
    const b = el('div', null,
      'position:fixed;bottom:16px;left:' + P.badgeLeft + ';z-index:2147483647;width:250px;padding:10px 12px;' +
      'background:rgba(20,20,24,.94);color:#f1f1f1;font:12px/1.4 system-ui,sans-serif;' +
      'border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.4)');
    b.id = BADGE_ID;
    const head = el('div', null, 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px');
    head.appendChild(el('b', P.title));
    const x = el('span', '×', 'cursor:pointer;font-size:16px;padding:0 4px');
    x.onclick = removeBadge;
    head.appendChild(x);
    b.appendChild(head);

    if (res.tag || (res.total && !P.crowdFallback)) {
      b.appendChild(el('div', 'Tag: ' + (res.tag ? res.tag + ' (' + res.tagFrom + ')' : 'none required') + ' · ' + res.tagged + ' of ' + res.total + ' comments'));
    }
    if (res.note) b.appendChild(el('div', res.note, 'margin-top:4px;color:#f0c36d'));
    if (res.tally.length) b.appendChild(el('div', 'Votes: ' + res.tally.map(([a, n]) => (a || '?').toUpperCase() + ' ' + n).join(' · ')));
    if (res.pick) b.appendChild(el('div', 'Pick: ' + res.pick, 'margin-top:4px;font-weight:600'));
    b.appendChild(el('div', res.status, 'margin-top:4px;color:' + (res.filled ? '#7dd87d' : '#f0c36d')));

    const row = el('div', null, 'display:flex;gap:6px;margin-top:8px');
    const btn = (label, fn) => {
      const e = el('button', label, 'flex:1;padding:4px 6px;border:0;border-radius:6px;background:#3b3b46;color:#fff;cursor:pointer;font:inherit');
      e.onclick = async () => { e.disabled = true; render(await fn()); };
      return e;
    };
    row.appendChild(btn('Rescan', () => scan({ fill: false })));
    row.appendChild(btn('Fill now', () => scan({ force: true })));
    b.appendChild(row);
    document.body.appendChild(b);
  }

  // ---------- Navigation (both sites are single-page apps) ----------
  let lastPath = '';

  async function onNav() {
    if (P.navKey() === lastPath) return;
    lastPath = P.navKey();
    removeBadge();
    if (!P.isPostView() || !AUTO_RUN) return;
    await sleep(START_DELAY_MS);
    if (P.navKey() !== lastPath) return;
    const poster = await waitFor(P.posterName, 10000);
    if (P.navKey() !== lastPath) return;
    if (!poster || !isAllowed(poster)) { log('skipped - ' + P.noun + ' not in list:', poster || '(unknown)'); return; }
    const res = await scan();
    log(res);
    if (P.navKey() === lastPath) render(res);
  }

  // ---------- Poster list: this browser + GitHub (Tampermonkey menu) ----------
  const REPO = 'zoytoy/tm-scripts', REPO_FILE = 'contestcomment.user.js', REPO_BRANCH = 'main';
  const TOKEN_KEY = 'contestGhToken', LOCAL_KEY = 'contestLocalPosters_' + P.key;
  const gv = (k, d) => { try { return GM_getValue(k, d); } catch (e) { return d; } };
  const sv = (k, v) => { try { GM_setValue(k, v); } catch (e) { /* ignore */ } };
  const localPosters = () => { const r = gv(LOCAL_KEY, []); return Array.isArray(r) ? r.map(norm).filter(Boolean) : []; };
  const isAllowed = p => BUILTIN.has(p) || localPosters().includes(p);
  // Once an update that contains a local entry is installed, the local copy is redundant - drop it.
  (function prune() {
    const u = localPosters(), keep = u.filter(p => !BUILTIN.has(p));
    if (keep.length !== u.length) sv(LOCAL_KEY, keep);
  })();

  function ghReq(method, body) {
    const token = gv(TOKEN_KEY, '');
    return new Promise((resolve, reject) => {
      if (!token) { reject(Object.assign(new Error('No GitHub token set'), { status: 0 })); return; }
      GM_xmlhttpRequest({
        method, anonymous: true,
        url: 'https://api.github.com/repos/' + REPO + '/contents/' + REPO_FILE + (method === 'GET' ? '?ref=' + REPO_BRANCH + '&t=' + Date.now() : ''),
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        data: body ? JSON.stringify(body) : undefined,
        onload: r => {
          let j = null; try { j = JSON.parse(r.responseText); } catch (e) { /* ignore */ }
          if (r.status >= 200 && r.status < 300) resolve(j);
          else reject(Object.assign(new Error('HTTP ' + r.status + (j && j.message ? ': ' + j.message : '')), { status: r.status }));
        },
        onerror: r => reject(Object.assign(new Error('Network error' + (r && (r.error || r.statusText) ? ' (' + (r.error || r.statusText) + ')' : '')), { status: -1 })),
        ontimeout: () => reject(Object.assign(new Error('GitHub timed out'), { status: -1 })),
        timeout: 20000,
      });
    });
  }
  const decodeFile = f => decodeURIComponent(escape(atob(String(f.content).replace(/\s/g, '')))).replace(/\r\n/g, '\n');
  const ghErr = e => e.status === 401 ? 'GitHub rejected the token - ' + e.message + '. (wrong, expired or revoked; use "Set GitHub token" again)'
    : (e.status === 403 || e.status === 404) ? 'The token has no write access to ' + REPO + ' (needs Contents: Read and write), or ' + REPO_FILE + ' is not in the repo yet. ' + e.message
    : e.message;

  // mutate(text) -> { text, summary } or { nochange: 'why' }. Re-reads and retries if someone else pushed in between.
  async function editRepo(mutate) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const f = await ghReq('GET');
      const res = mutate(decodeFile(f));
      if (res.nochange) return res;
      const out = res.text.replace(/(\/\/ @version\s+)(\d+)\.(\d+)\.(\d+)/, (m, a, x, y, z) => a + x + '.' + y + '.' + (+z + 1));
      const v = (out.match(/\/\/ @version\s+(\S+)/) || [])[1];
      try {
        await ghReq('PUT', { message: 'Contest Comment Helper v' + v + ': ' + res.summary, content: btoa(unescape(encodeURIComponent(out))), sha: f.sha, branch: REPO_BRANCH });
        return { version: v, summary: res.summary };
      } catch (e) { if (e.status === 409 || e.status === 422) continue; throw e; }
    }
    throw new Error('GitHub kept changing while saving - try again.');
  }

  // Edits only this site's "const POSTERS_xx = [...]" line of the GitHub copy.
  const LIST_RE = new RegExp('^([ \\t]*const ' + P.listName + ' = )\\[([^\\]]*)\\];', 'm');
  const listOf = t => {
    const m = t.match(LIST_RE);
    if (!m) throw new Error(P.listName + ' list not found in the GitHub copy');
    return (m[2].match(/'([^']*)'/g) || []).map(s => norm(s.slice(1, -1)));
  };
  const withList = (t, arr) => t.replace(LIST_RE, (m, a) => a + '[' + arr.map(p => "'" + p + "'").join(', ') + '];');
  const addMutator = names0 => t => {
    const names = names0.map(norm), have = listOf(t), add = names.filter((n, i) => !have.includes(n) && names.indexOf(n) === i);
    if (!add.length) return { nochange: 'already on GitHub' };
    return { text: withList(t, have.concat(add)), summary: 'add ' + add.join(', ') + ' (' + P.key + ')' };
  };
  const removeMutator = name => t => {
    const have = listOf(t);
    if (!have.includes(name)) return { nochange: 'not in the GitHub list' };
    return { text: withList(t, have.filter(p => p !== name)), summary: 'remove ' + name + ' (' + P.key + ')' };
  };
  const doneMsg = res => res.nochange ? 'Nothing to push: ' + res.nochange + '.'
    : 'Pushed to GitHub as v' + res.version + ' (' + res.summary + ').\nOther owners get it at their next Tampermonkey update check.';

  function rescanNow() { lastPath = ''; onNav(); }

  function addPoster(raw) {
    const name = norm(raw), head = P.label(name) + ': ';
    if (!P.validName(name)) { alert('"' + raw + '" does not look like ' + P.badName + '.'); return; }
    if (!BUILTIN.has(name) && !localPosters().includes(name)) sv(LOCAL_KEY, localPosters().concat(name));
    rescanNow();
    if (!gv(TOKEN_KEY, '')) { alert(head + 'added in this browser only (no GitHub token set - menu: "Set GitHub token").'); return; }
    editRepo(addMutator([name]))
      .then(res => alert(head + 'works now in this browser.\n' + doneMsg(res)))
      .catch(e => alert(head + 'works in this browser, but the GitHub push FAILED: ' + ghErr(e)));
  }
  function addByTyping() {
    const t = prompt(P.promptName, '');
    if (t && t.trim()) addPoster(t);
  }
  function addCurrent() {
    const p = P.isPostView() ? P.posterName() : '';
    if (!p) { addByTyping(); return; }
    if (isAllowed(p)) { alert(P.label(p) + ' is already on the list.'); return; }
    if (confirm('Add ' + P.label(p) + ' (the ' + P.noun + ' of this post)?')) addPoster(p);
  }
  function showPosters() {
    const l = localPosters().filter(p => !BUILTIN.has(p));
    alert('Shared list (GitHub copy, ' + P.listName + '):\n' + ([...BUILTIN].join(', ') || '(none)') + '\n\nOnly in this browser (not pushed yet):\n' + (l.join(', ') || '(none)'));
  }
  function removePoster() {
    const all = [...new Set([...BUILTIN, ...localPosters()])];
    if (!all.length) { alert('Nothing on the list.'); return; }
    const n = prompt('Type a number to REMOVE a ' + P.noun + ' (blank = cancel). Shared ones are removed on GitHub for everyone:\n' +
      all.map((p, i) => (i + 1) + '. ' + p + (BUILTIN.has(p) ? '' : ' (this browser only)')).join('\n'), '');
    const p = all[(parseInt(n, 10) || 0) - 1];
    if (!p) return;
    sv(LOCAL_KEY, localPosters().filter(x => x !== p));
    if (!BUILTIN.has(p)) { alert('Removed ' + P.label(p) + ' from this browser.'); return; }
    if (!gv(TOKEN_KEY, '')) { alert('Not removed on GitHub (no token set). It stays on the shared list.'); return; }
    editRepo(removeMutator(p))
      .then(res => alert(res.nochange ? 'Nothing to remove: ' + res.nochange + '.' : 'Removed ' + P.label(p) + ' on GitHub as v' + res.version + '.\nThis browser keeps using it until the update installs.'))
      .catch(e => alert('GitHub FAILED: ' + ghErr(e)));
  }
  function pushLocal() {
    const l = localPosters().filter(p => !BUILTIN.has(p));
    if (!l.length) { alert('No local-only entries to push.'); return; }
    if (!gv(TOKEN_KEY, '')) { alert('No GitHub token set (menu: "Set GitHub token").'); return; }
    editRepo(addMutator(l)).then(res => alert(doneMsg(res))).catch(e => alert('GitHub FAILED: ' + ghErr(e)));
  }
  function setToken() {
    const t = prompt('Paste the GitHub token (fine-grained, ' + REPO + ', Contents: Read and write). Blank = remove it:', '');
    if (t === null) return;
    if (t.trim() && !/^[A-Za-z0-9_]{20,255}$/.test(t.trim())) { alert('That does not look like a GitHub token (a token is one unbroken word of letters/numbers/underscores, starting github_pat_). Nothing was saved.'); return; }
    sv(TOKEN_KEY, t.trim());
    if (!t.trim()) { alert('Token removed from this browser.'); return; }
    ghReq('GET').then(() => alert('Token works.')).catch(e => alert('Saved, but the test failed: ' + ghErr(e)));
  }

  try {
    GM_registerMenuCommand("➕ Add this post's " + P.noun, addCurrent);
    GM_registerMenuCommand('➕ Add ' + P.noun + ' by typing…', addByTyping);
    GM_registerMenuCommand('📋 Show ' + P.noun + 's', showPosters);
    GM_registerMenuCommand('🗑 Remove a ' + P.noun, removePoster);
    GM_registerMenuCommand('⬆ Push my local ' + P.noun + 's to GitHub', pushLocal);
    GM_registerMenuCommand('🔑 Set GitHub token (also tests it)', setToken);
  } catch (e) { /* menu not available */ }

  window.__contest = { scan, parseComments: P.parseComments, findBox: P.findBox, posterName: P.posterName };
  setInterval(onNav, 1000);
  onNav();
})();
