// ==UserScript==
// @name        Auto Login to Casinos (Unified, Improved Google Button Detection)
// @namespace   Violentmonkey Scripts
// @match       https://*/*
// @updateURL   https://raw.githubusercontent.com/zoytoy/tm-scripts/main/auto-login.user.js
// @downloadURL https://raw.githubusercontent.com/zoytoy/tm-scripts/main/auto-login.user.js
// @connect     api.github.com
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_deleteValue
// @grant       GM_registerMenuCommand
// @grant       GM_xmlhttpRequest
// @noframes
// @version     4.0.2
// @description Waits for captcha to solve, then auto-logs in to each casino using the method (Google, or email/password) each user chooses per site. The choice is asked once per site and stored on that computer, never overwritten by updates. The list of sites is shared through GitHub.
// ==/UserScript==
(function() {
    'use strict';

    // ===== SHARED SITE LIST (this browser + GitHub) =====
    // Domains this script is active on. Edited by the Tampermonkey menu ("Add this site")
    // via GitHub - keep it on one line. The script is installed on every https page but does
    // nothing on a domain that isn't listed here (or added locally).
    const SITES = ['sportzino.com', 'zulacasino.com', 'fortunecoins.com', 'yaycasino.com', 'americanluck.com', 'winbonanza.com', 'fortunewins.com', 'luckparty.com', 'lonestarcasino.com', 'realprize.com'];

    const HOST = location.hostname.toLowerCase();
    const REPO = 'zoytoy/tm-scripts', REPO_FILE = 'auto-login.user.js', REPO_BRANCH = 'main';
    const TOKEN_KEY = 'autoLoginGhToken', LOCAL_SITES_KEY = 'autoLoginLocalSites';
    const gv = (k, d) => { try { return GM_getValue(k, d); } catch (e) { return d; } };
    const sv = (k, v) => { try { GM_setValue(k, v); } catch (e) { /* ignore */ } };
    const normDomain = h => String(h || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[\/?#].*$/, '').replace(/^www\./, '');
    const validDomain = d => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d);
    const localSites = () => { const r = gv(LOCAL_SITES_KEY, []); return Array.isArray(r) ? r.map(normDomain).filter(Boolean) : []; };
    const hostMatches = (host, d) => host === d || host.endsWith('.' + d);
    // The listed domain this page belongs to (www.fortunewins.com -> fortunewins.com), or null.
    const siteFor = host => [...SITES, ...localSites()].find(d => hostMatches(host, d)) || null;
    // Once an update that contains a locally-added site is installed, the local copy is redundant - drop it.
    (function pruneLocalSites() {
        const all = localSites(), keep = all.filter(d => !SITES.includes(d));
        if (keep.length !== all.length) sv(LOCAL_SITES_KEY, keep);
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
        : (e.status === 403 || e.status === 404) ? 'The token has no write access to ' + REPO + ' (needs Contents: Read and write), or ' + REPO_FILE + ' is not in the repo. ' + e.message
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
                await ghReq('PUT', { message: 'Auto Login v' + v + ': ' + res.summary, content: btoa(unescape(encodeURIComponent(out))), sha: f.sha, branch: REPO_BRANCH });
                return { version: v, summary: res.summary };
            } catch (e) { if (e.status === 409 || e.status === 422) continue; throw e; }
        }
        throw new Error('GitHub kept changing while saving - try again.');
    }

    // Edits only the "const SITES = [...]" line of the GitHub copy.
    const SITES_RE = /^([ \t]*const SITES = )\[([^\]]*)\];/m;
    const sitesOf = t => {
        const m = t.match(SITES_RE);
        if (!m) throw new Error('SITES list not found in the GitHub copy');
        return (m[2].match(/'([^']*)'/g) || []).map(s => s.slice(1, -1));
    };
    const withSites = (t, arr) => t.replace(SITES_RE, (m, a) => a + '[' + arr.map(s => "'" + s + "'").join(', ') + '];');
    const addSiteMutator = d => t => {
        const have = sitesOf(t);
        if (have.includes(d)) return { nochange: 'already on GitHub' };
        return { text: withSites(t, have.concat(d)), summary: 'add ' + d };
    };
    const removeSiteMutator = d => t => {
        const have = sitesOf(t);
        if (!have.includes(d)) return { nochange: 'not in the GitHub list' };
        return { text: withSites(t, have.filter(x => x !== d)), summary: 'remove ' + d };
    };
    const doneMsg = res => res.nochange ? 'Nothing to push: ' + res.nochange + '.'
        : 'Pushed to GitHub as v' + res.version + ' (' + res.summary + ').\nOther computers get it at their next Tampermonkey update check.';

    async function addSite(raw) {
        const d = normDomain(raw);
        if (!validDomain(d)) { alert('"' + raw + '" does not look like a site name.'); return; }
        if (!SITES.includes(d) && !localSites().includes(d)) sv(LOCAL_SITES_KEY, localSites().concat(d));
        let msg;
        if (!gv(TOKEN_KEY, '')) {
            msg = d + ' added in this browser only (no GitHub token set - menu: "Set GitHub token").';
        } else {
            try { msg = d + ' added.\n' + doneMsg(await editRepo(addSiteMutator(d))); }
            catch (e) { msg = d + ' added in this browser, but the GitHub push FAILED: ' + ghErr(e); }
        }
        const here = hostMatches(HOST, d);
        alert(msg + '\n\nThe script asks how you log in the first time you open its login page.' + (here ? '\nThe page will reload so it can start.' : ''));
        if (here) location.reload();
    }

    async function removeSite(d) {
        sv(LOCAL_SITES_KEY, localSites().filter(x => x !== d));
        if (!SITES.includes(d)) { alert('Removed ' + d + ' from this browser.'); return; }
        if (!gv(TOKEN_KEY, '')) { alert('Not removed on GitHub (no token set). It stays on the shared list.'); return; }
        try {
            const res = await editRepo(removeSiteMutator(d));
            alert(res.nochange ? 'Nothing to remove: ' + res.nochange + '.' : 'Removed ' + d + ' on GitHub as v' + res.version + '.\nThis browser keeps using it until the update installs.');
        } catch (e) { alert('GitHub FAILED: ' + ghErr(e)); }
    }

    function setToken() {
        const t = prompt('Paste the GitHub token (fine-grained, ' + REPO + ', Contents: Read and write). Blank = remove it:', '');
        if (t === null) return;
        if (t.trim() && !/^[A-Za-z0-9_]{20,255}$/.test(t.trim())) { alert('That does not look like a GitHub token (one unbroken word of letters/numbers/underscores, starting github_pat_). Nothing was saved.'); return; }
        sv(TOKEN_KEY, t.trim());
        if (!t.trim()) { alert('Token removed from this browser.'); return; }
        ghReq('GET').then(() => alert('Token works.')).catch(e => alert('Saved, but the test failed: ' + ghErr(e)));
    }

    // Small "add this site" button on unlisted pages that look like a login page - shown only where a
    // GitHub token is set (i.e. the admin's computer).
    function showAddSiteButton() {
        const mount = () => {
            const looksLikeLogin = /log-?in|sign-?in/i.test(location.pathname) || !!document.querySelector('input[type="password"]');
            if (!looksLikeLogin || !document.body || document.getElementById('auto-login-add-site')) return;
            const box = document.createElement('div');
            box.id = 'auto-login-add-site';
            Object.assign(box.style, { position: 'fixed', bottom: '48px', right: '10px', zIndex: '2147483647', display: 'flex', gap: '4px', opacity: '0.85' });
            const add = document.createElement('button');
            add.textContent = '➕ Add ' + normDomain(HOST) + ' to Auto Login';
            Object.assign(add.style, { padding: '6px 10px', background: '#00897b', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', font: '12px Arial, sans-serif' });
            add.onclick = () => { add.disabled = true; addSite(HOST).finally(() => { add.disabled = false; }); };
            const x = document.createElement('button');
            x.textContent = 'X';
            Object.assign(x.style, { padding: '6px 8px', background: '#9e9e9e', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', font: '12px Arial, sans-serif' });
            x.onclick = () => box.remove();
            box.appendChild(add); box.appendChild(x);
            document.body.appendChild(box);
        };
        const later = () => setTimeout(mount, 2000); // give a JS-rendered login form time to appear
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', later); else later();
    }
    // ===== END SHARED SITE LIST =====

    // ===== TIMING =====
    const CLICK_DELAY_AFTER_SOLVE_MS = 3000;  // pause between "captcha solved" and the login click
    const NO_CAPTCHA_GRACE_MS        = 6000;  // if no captcha widget has appeared by now, just log in
    const CAPTCHA_TIMEOUT_MS         = 45000; // give up waiting and try to log in anyway
    const FLOW_TIMEOUT_MS            = 30000; // FORM_FLOW_SITES: stop looking for the login UI after this
    const FLOW_RECLICK_COOLDOWN_MS   = 2500;  // don't re-click an "open login" button faster than this

    // ===== LOGIN METHOD (per user, per site) =====
    // Each computer picks "Google" or "Email & password" for each site the first time it opens that
    // site's login page. The choice is kept in Tampermonkey's local storage, so script updates never
    // touch it, and every user can choose differently. Change it later from the Tampermonkey menu.
    //
    //   Google            -> clicks the site's "Sign in with Google" button.
    //   Email & password  -> sites in FORM_FLOW_SITES get the typed-in popup flow below; sites in
    //                        CUSTOM_SITES click their login button (your browser/password manager
    //                        fills the fields); any other site falls back to a generic login button.
    //
    // Sites not listed in either map below default to Google in the chooser's "suggested" hint.
    const methodKey = domain => 'method:' + domain;
    const PASSWORD_SUGGESTED = ['yaycasino.com', 'winbonanza.com', 'reelzappy.com', 'lonestarcasino.com', 'realprize.com'];

    // Sites with their own login form/button. `selectors` is tried in order, most specific first -
    // list a couple of fallbacks so a renamed class or wrapper doesn't take the site offline.
    // If none match, findGenericLoginButton() below is tried as a last resort.
    const CUSTOM_SITES = {
        "yaycasino.com": {
            selectors: [
                'button[data-sentry-component="YayButton"][type="submit"]',
                'button.loginFormButtton[type="submit"]'
            ],
            clickMode: "click" // React/Next.js form — use real pointer events, not form submit
        },
        "winbonanza.com": {
            selectors: [
                'button[data-testid="login-submit-button"]'
            ]
        },
        "reelzappy.com": {
            selectors: [
                'button[data-testid="login-submit-button"]'
            ]
        }
    };

    // ===== LOGIN DETAILS FOR FORM_FLOW_SITES =====
    // Chrome won't hand its saved (autofilled) email/password to a script until
    // you physically click the page, so the script types them in itself.
    // The first time a site needs logging in, a box pops up asking for them;
    // they're saved in Tampermonkey's own storage (the casino site can't read
    // it). To change them: Tampermonkey icon → "Change saved login for <site>";
    // to remove them: "Clear saved login for <site>".

    // Sites where login is a popup on the normal page (no /login URL). The flow:
    //   1. click an `open` button (e.g. header "LOGIN") if the form isn't showing
    //   2. click a `chooser` button (e.g. "Login with Email") if one is showing
    //   3. click the email field and type the email, then the same for the password
    //   4. wait for captcha (if any), then click `submit`
    // Each step is skipped if it isn't needed, so a page already showing the form
    // goes straight to step 3. Nothing happens when already logged in, because
    // none of the `open` buttons are visible then.
    const FORM_FLOW_SITES = {
        "lonestarcasino.com": {
            open:     ['a[data-test="landing-login-button"]', 'a[href="#!login"]'],
            chooser:  [],
            email:    ['input[name="email"][type="email"]'],
            password: ['input[name="password"][type="password"]'],
            submit:   ['form button[type="submit"]']
        },
        // Redesigned 2026-10 onto the same platform as Lonestar; the old
        // #poplogin_* selectors are kept as fallbacks in case it reverts.
        "realprize.com": {
            open:     ['a[data-test="landing-login-button"]', 'a[href="#!login"]'],
            chooser:  ['#logemailnbtn', 'button[data-test="login-email-button"]'],
            email:    ['form input[name="email"][type="email"]', '#poplogin_email', 'input[data-test="login-email-input"]'],
            password: ['form input[name="password"][type="password"]', '#poplogin_password', 'input[data-test="login-password-input"]'],
            submit:   ['form button[type="submit"]', '#poploginbtn', 'button[data-test="login-submit-button"]']
        }
    };

    // Set at boot: the listed domain for this page and the method this user chose for it.
    let ACTIVE_DOMAIN = null;
    let ACTIVE_METHOD = null;

    function normalizeText(s) {
        return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
    }

    function getSiteConfig() {
        if (ACTIVE_METHOD === "google") return { type: "google" };
        if (FORM_FLOW_SITES[ACTIVE_DOMAIN]) return { type: "flow", domain: ACTIVE_DOMAIN, ...FORM_FLOW_SITES[ACTIVE_DOMAIN] };
        // Email & password on a site with its own button config - or, for a site added later
        // with no config at all, an empty config that relies on findGenericLoginButton().
        return { type: "custom", ...(CUSTOM_SITES[ACTIVE_DOMAIN] || {}) };
    }

    function findGoogleButton() {
        // FortuneWins-style (2026 redesign): <button class="primary-button--google"> with alt="" icon
        const byModifierClass = document.querySelector('button.primary-button--google');
        if (byModifierClass) return byModifierClass;

        // LuckParty-style: <button class="google"><img alt="Google" ...></button>
        const byGoogleClass = document.querySelector('button.google img[alt="Google"]')?.closest('button') ||
                               document.querySelector('.social-login button.google');
        if (byGoogleClass) return byGoogleClass;

        // Generic fallback: any button containing a Google-alt image, or a google.*.svg icon
        const byIcon = document.querySelector('button.sso-button img[alt="Google"]')?.closest('button') ||
                        document.querySelector('button img[alt="Google"]')?.closest('button') ||
                        document.querySelector('button img[src*="google"]')?.closest('button');
        if (byIcon) return byIcon;

        const buttons = document.querySelectorAll("button.sso-button");
        for (const btn of buttons) {
            const textSpan = btn.querySelector(".button-text");
            if (!textSpan) continue;
            if (normalizeText(textSpan.textContent).includes("google")) return btn;
        }

        // Last resort: a button whose visible text is just "Google" / "Sign in with Google"
        for (const btn of document.querySelectorAll("button")) {
            const text = normalizeText(btn.innerText || btn.textContent);
            if (/^(sign in with |continue with |log ?in with )?google$/.test(text)) return btn;
        }
        return null;
    }

    // Last-resort fallback for custom sites: any submit button inside a form
    // that has a password field, whose text reads like a login button. Keeps
    // the script working even if a site renames its data-testid/class.
    function findGenericLoginButton() {
        const forms = document.querySelectorAll("form");
        for (const form of forms) {
            if (!form.querySelector('input[type="password"]')) continue;
            const candidates = form.querySelectorAll('button[type="submit"], button:not([type])');
            for (const btn of candidates) {
                const text = normalizeText(btn.innerText || btn.textContent);
                if (/log ?in|sign ?in/.test(text)) return btn;
            }
        }
        return null;
    }

    function findCustomButton(config) {
        for (const sel of (config.selectors || [])) {
            const btn = document.querySelector(sel);
            if (btn) return btn;
        }
        return findGenericLoginButton();
    }

    function humanClick(el) {
        if (!el || el.disabled) return false;

        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2 + (Math.random() * 3 - 1.5);
        const y = rect.top + rect.height / 2 + (Math.random() * 3 - 1.5);

        // No `view: window` — with GM_* grants Tampermonkey runs us in a sandbox
        // where `window` is a proxy, and the event constructors reject it.
        const base = {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            screenX: x + (window.screenX || 0),
            screenY: y + (window.screenY || 0),
            button: 0,
            buttons: 1,
            detail: 1
        };

        // Focus first
        el.focus();

        // Pointer + mouse sequence (many anti-bot systems watch these)
        el.dispatchEvent(new PointerEvent('pointerover', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new MouseEvent('mouseover', base));
        el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new MouseEvent('mousedown', base));
        el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new MouseEvent('mouseup', base));
        el.dispatchEvent(new MouseEvent('click', base));

        return true;
    }

    function submitViaForm(btn) {
        const form = btn.closest('form');
        if (form && typeof form.requestSubmit === 'function') {
            form.requestSubmit(btn);
            console.log(`requestSubmit used for ${location.hostname}`);
            return true;
        } else if (form) {
            form.submit();
            console.log(`form.submit() used for ${location.hostname}`);
            return true;
        }
        return false;
    }

    let lastGoogleOpenClick = 0;

    function clickLoginButton(retryUntil = Date.now() + 8000) {
        const config = getSiteConfig();
        if (!config) {
            console.log("No site config found.");
            return;
        }

        if (config.type === "custom") {
            const btn = findCustomButton(config);

            if (btn) {
                console.log(`Custom button found for ${location.hostname} — disabled=${btn.disabled}, text="${(btn.innerText || btn.textContent || '').trim()}"`);
            }

            if (btn && !btn.disabled) {
                if (config.clickMode === "click") {
                    // React/Next.js sites: dispatch real pointer events on the button.
                    humanClick(btn);
                    console.log(`humanClick used for ${location.hostname}`);
                    // Belt-and-suspenders: if still on the login page shortly after, try native submit.
                    setTimeout(() => {
                        if (/\/login/.test(location.pathname)) {
                            console.log("Still on login page after humanClick — trying form submit as backup");
                            submitViaForm(btn);
                        }
                    }, 800);
                } else if (!submitViaForm(btn)) {
                    // No form — fall back to simulated human click
                    humanClick(btn);
                    console.log(`humanClick used for ${location.hostname}`);
                }
                return;
            }

            if (Date.now() < retryUntil) {
                console.log("Custom button not ready yet, retrying...");
                setTimeout(() => clickLoginButton(retryUntil), 300);
            } else {
                console.log("Custom login button not found/ready after retries.");
            }
        } else {
            const btn = findGoogleButton();
            if (btn) {
                humanClick(btn);
                console.log("Clicked Google login button");
            } else {
                // Popup-login sites (no /login page): open the login popup first so its Google button appears.
                const flow = FORM_FLOW_SITES[ACTIVE_DOMAIN];
                if (flow && Date.now() - lastGoogleOpenClick > FLOW_RECLICK_COOLDOWN_MS) {
                    const opener = findVisible(flow.open) || findVisibleOpenLoginButton();
                    if (opener) {
                        lastGoogleOpenClick = Date.now();
                        humanClick(opener);
                        console.log("Clicked header login button to reveal the Google button");
                    }
                }
                if (Date.now() < retryUntil) {
                    console.log("Google button not ready yet, retrying...");
                    setTimeout(() => clickLoginButton(retryUntil), 300);
                } else {
                    console.log("Google login button not found after retries.");
                }
            }
        }
    }

    // ===== FORM FLOW (popup login with prefilled email/password) =====
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const jitter = (min, max) => min + Math.random() * (max - min);

    function isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = getComputedStyle(el);
        return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
    }

    function findVisible(selectors) {
        for (const sel of (selectors || [])) {
            for (const el of document.querySelectorAll(sel)) {
                if (isVisible(el)) return el;
            }
        }
        return null;
    }

    // Header "Login" / "Log in" / "Sign in" button — used when a site has no
    // `open` selectors, or they stop matching. Skips anything inside a form so
    // it never grabs the submit button.
    function findVisibleOpenLoginButton() {
        for (const el of document.querySelectorAll('a, button')) {
            if (el.closest('form') || !isVisible(el)) continue;
            const text = normalizeText(el.innerText || el.textContent);
            if (/^(log ?in|sign ?in)$/.test(text)) return el;
        }
        return null;
    }

    // Make the site's JS (React, jQuery validators, etc.) notice a prefilled value,
    // the same way it would after the user typed it.
    function announceValue(input) {
        const value = input.value;
        const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        // React skips onChange if its tracker thinks the value didn't change — reset it first.
        if (input._valueTracker) input._valueTracker.setValue('');
        setter.call(input, value);
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'End' }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function setNativeValue(input, value) {
        const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
    }

    // Type text one character at a time with the key/input events a real
    // keyboard produces, so React/jQuery forms see it as user input.
    async function typeInto(input, text) {
        // Clear whatever is there (including Chrome's autofill preview).
        setNativeValue(input, '');
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
        await sleep(jitter(80, 160));

        const chars = [...text];
        for (let i = 0; i < chars.length; i++) {
            const ch = chars[i];
            const keyInit = { bubbles: true, cancelable: true, key: ch, code: ch.length === 1 && /[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : '' };
            input.dispatchEvent(new KeyboardEvent('keydown', keyInit));
            input.dispatchEvent(new KeyboardEvent('keypress', keyInit));
            input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: ch }));
            // Set the whole prefix rather than appending to input.value, so anything
            // else touching the field mid-typing (autofill, a stray click, a second
            // copy of this script) can't leave garbage behind.
            setNativeValue(input, chars.slice(0, i + 1).join(''));
            input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
            input.dispatchEvent(new KeyboardEvent('keyup', keyInit));
            await sleep(jitter(60, 170));
        }

        if (input.value !== text) {
            console.log("[flow] Field didn't end up with the expected text — correcting it");
            setNativeValue(input, text);
            if (input._valueTracker) input._valueTracker.setValue('');
            input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        }
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async function clickIntoField(input, label, text) {
        humanClick(input);
        await sleep(jitter(150, 350));
        if (text) {
            await typeInto(input, text);
        } else {
            if (!input.value) {
                // Chrome holds back autofilled values from page scripts until the user
                // interacts with the page; give a password manager a moment to fill.
                await sleep(1000);
            }
            announceValue(input);
        }
        console.log(`[flow] ${text ? "Typed into" : "Clicked"} ${label} field (${input.value ? input.value.length + " chars" : "EMPTY"})`);
        return !!input.value;
    }

    // ===== SAVED CREDENTIALS =====
    function credKey(domain) { return "creds:" + domain; }

    function getSavedCredentials(domain) {
        const c = GM_getValue(credKey(domain), null);
        return c && c.email && c.password ? c : null;
    }

    // Masked login box, drawn in a closed shadow root so the casino's CSS can't
    // restyle it and its scripts can't reach into it. Resolves to the saved
    // {email, password}, or null if cancelled.
    function askForCredentials(domain) {
        return new Promise(resolve => {
            const existing = GM_getValue(credKey(domain), null) || {};
            const host = document.createElement("div");
            host.style.cssText = "position:fixed;inset:0;z-index:2147483647;";
            const root = host.attachShadow({ mode: "closed" });
            root.innerHTML = `
                <style>
                    .backdrop { position:fixed; inset:0; background:rgba(0,0,0,.6); display:flex;
                                align-items:center; justify-content:center; font:14px/1.4 system-ui, sans-serif; }
                    .box { background:#1e1e24; color:#eee; padding:20px 22px; border-radius:10px; width:320px;
                           max-width:calc(100vw - 32px); box-shadow:0 8px 30px rgba(0,0,0,.5); }
                    h2 { margin:0 0 4px; font-size:16px; }
                    p { margin:0 0 14px; color:#aaa; font-size:12px; }
                    label { display:block; margin:10px 0 4px; font-size:12px; color:#ccc; }
                    .row { display:flex; gap:6px; }
                    input { flex:1; width:100%; box-sizing:border-box; padding:8px 10px; border-radius:6px;
                            border:1px solid #444; background:#111; color:#fff; font-size:14px; }
                    button { padding:8px 14px; border-radius:6px; border:0; cursor:pointer; font-size:13px; }
                    .show { background:#333; color:#ccc; padding:8px 10px; }
                    .actions { display:flex; justify-content:flex-end; gap:8px; margin-top:16px; }
                    .save { background:#2e7d32; color:#fff; }
                    .cancel { background:#444; color:#ddd; }
                    .err { color:#ff8a80; font-size:12px; min-height:16px; margin-top:8px; }
                </style>
                <div class="backdrop">
                    <form class="box" autocomplete="off">
                        <h2>Auto Login — ${domain}</h2>
                        <p>Saved in Tampermonkey on this PC and typed in for you when you're logged out.</p>
                        <label>Email / username</label>
                        <div class="row"><input class="email" type="text" autocomplete="off" spellcheck="false"></div>
                        <label>Password</label>
                        <div class="row">
                            <input class="password" type="password" autocomplete="new-password">
                            <button type="button" class="show">Show</button>
                        </div>
                        <div class="err"></div>
                        <div class="actions">
                            <button type="button" class="cancel">Not now</button>
                            <button type="submit" class="save">Save &amp; log in</button>
                        </div>
                    </form>
                </div>`;

            const form = root.querySelector("form");
            const email = root.querySelector(".email");
            const password = root.querySelector(".password");
            const showBtn = root.querySelector(".show");
            const err = root.querySelector(".err");
            email.value = existing.email || "";

            // Keep the casino's own popup (focus traps, key handlers) from
            // stealing focus or keystrokes while this box is open.
            for (const type of ["focusin", "focusout", "keydown", "keyup", "keypress", "mousedown", "click", "input"]) {
                host.addEventListener(type, e => e.stopPropagation());
            }

            showBtn.addEventListener("click", () => {
                const hidden = password.type === "password";
                password.type = hidden ? "text" : "password";
                showBtn.textContent = hidden ? "Hide" : "Show";
            });

            function close(result) {
                host.remove();
                resolve(result);
            }

            root.querySelector(".cancel").addEventListener("click", () => close(null));
            form.addEventListener("submit", e => {
                e.preventDefault();
                const creds = { email: email.value.trim(), password: password.value };
                if (!creds.email || !creds.password) {
                    err.textContent = "Enter both an email and a password.";
                    return;
                }
                GM_setValue(credKey(domain), creds);
                console.log(`[flow] Saved login for ${domain}`);
                close(creds);
            });

            document.documentElement.appendChild(host);
            setTimeout(() => (email.value ? password : email).focus(), 50);
        });
    }

    // Chooser box: how does THIS user log in to this site? Resolves to "google", "password", or null if cancelled.
    // Same closed-shadow-root approach as the credentials box.
    function askLoginMethod(domain, current) {
        return new Promise(resolve => {
            const suggested = current || (PASSWORD_SUGGESTED.includes(domain) ? "password" : "google");
            const host = document.createElement("div");
            host.style.cssText = "position:fixed;inset:0;z-index:2147483647;";
            const root = host.attachShadow({ mode: "closed" });
            root.innerHTML = `
                <style>
                    .backdrop { position:fixed; inset:0; background:rgba(0,0,0,.6); display:flex;
                                align-items:center; justify-content:center; font:14px/1.4 system-ui, sans-serif; }
                    .box { background:#1e1e24; color:#eee; padding:20px 22px; border-radius:10px; width:330px;
                           max-width:calc(100vw - 32px); box-shadow:0 8px 30px rgba(0,0,0,.5); }
                    h2 { margin:0 0 4px; font-size:16px; }
                    p { margin:0 0 14px; color:#aaa; font-size:12px; }
                    button { width:100%; padding:10px 14px; border-radius:6px; border:1px solid #444; cursor:pointer;
                             font-size:14px; background:#2a2a32; color:#eee; margin-bottom:8px; text-align:left; }
                    button.suggested { border-color:#4caf50; background:#1f3a22; }
                    small { color:#9bd39e; font-size:11px; margin-left:6px; }
                    .cancel { background:transparent; border:0; color:#aaa; text-align:center; font-size:12px; margin:4px 0 0; }
                </style>
                <div class="backdrop">
                    <div class="box">
                        <h2>Auto Login — ${domain}</h2>
                        <p>How do you log in to this site? It's remembered on this computer. You can change it later from the Tampermonkey menu.</p>
                        <button class="google">Sign in with Google${suggested === "google" ? "<small>" + (current ? "current" : "suggested") + "</small>" : ""}</button>
                        <button class="password">Email &amp; password${suggested === "password" ? "<small>" + (current ? "current" : "suggested") + "</small>" : ""}</button>
                        <button class="cancel">Not now</button>
                    </div>
                </div>`;
            root.querySelector("." + suggested).classList.add("suggested");

            for (const type of ["focusin", "focusout", "keydown", "keyup", "keypress", "mousedown", "click", "input"]) {
                host.addEventListener(type, e => e.stopPropagation());
            }
            const close = result => { host.remove(); resolve(result); };
            root.querySelector(".google").addEventListener("click", () => close("google"));
            root.querySelector(".password").addEventListener("click", () => close("password"));
            root.querySelector(".cancel").addEventListener("click", () => close(null));
            document.documentElement.appendChild(host);
        });
    }

    async function fillAndSubmit(config, emailInput, passwordInput) {
        const creds = getSavedCredentials(config.domain) || {};
        await sleep(jitter(400, 800));
        const hasEmail = await clickIntoField(emailInput, "email", creds.email);
        await sleep(jitter(400, 900));
        const hasPassword = await clickIntoField(passwordInput, "password", creds.password);
        passwordInput.blur();

        if (!hasEmail || !hasPassword) {
            console.log("[flow] Email or password is empty — not submitting. Use Tampermonkey menu → \"Change saved login\" to set them.");
            return;
        }

        // Some sites keep the button disabled until they've validated the
        // fields — give it a few seconds to enable before giving up.
        waitForCaptchaSolved(async () => {
            const giveUpAt = Date.now() + 5000;
            let btn = null;
            while (Date.now() < giveUpAt) {
                btn = findVisible(config.submit) || findGenericLoginButton();
                if (btn && !btn.disabled) break;
                await sleep(250);
            }
            if (!btn) {
                console.log("[flow] Login submit button not found.");
                return;
            }
            if (btn.disabled) {
                console.log("[flow] Login submit button is still disabled — the site didn't accept the typed email/password.");
                return;
            }
            humanClick(btn);
            console.log(`[flow] Clicked login submit on ${location.hostname}`);
        });
    }

    function runFormFlow(config) {
        // Only one copy may drive the login per page load — e.g. if this script is
        // installed twice in Tampermonkey, two copies typing at once scramble the text.
        const root = document.documentElement;
        if (root.dataset.scAutoLogin) {
            console.log("[flow] Another copy of this script is already handling login — skipping. (Is it installed twice in Tampermonkey?)");
            return;
        }
        root.dataset.scAutoLogin = "running";

        GM_registerMenuCommand(`Change saved login for ${config.domain}`, async () => {
            if (await askForCredentials(config.domain)) location.reload();
        });
        GM_registerMenuCommand(`Clear saved login for ${config.domain}`, () => {
            GM_deleteValue(credKey(config.domain));
            console.log(`[flow] Cleared saved login for ${config.domain}`);
            alert(`Saved login for ${config.domain} cleared. You'll be asked again next time you're logged out.`);
        });

        flowLoop(config);
    }

    function flowLoop(config) {
        const startedAt = Date.now();
        let lastOpenClick = 0;
        let lastChooserClick = 0;

        const timer = setInterval(async () => {
            if (Date.now() - startedAt > FLOW_TIMEOUT_MS) {
                clearInterval(timer);
                console.log("[flow] Login form never appeared (probably already logged in).");
                return;
            }

            const emailInput = findVisible(config.email);
            const passwordInput = findVisible(config.password);

            // First run on this site: we're logged out (some login UI is showing)
            // but have no saved login yet — ask for it, then start over.
            if (!getSavedCredentials(config.domain)) {
                const loggedOut = (emailInput && passwordInput) || findVisible(config.chooser) ||
                                  findVisible(config.open) || findVisibleOpenLoginButton();
                if (!loggedOut) return;
                clearInterval(timer);
                console.log(`[flow] No saved login for ${config.domain} — asking`);
                const creds = await askForCredentials(config.domain);
                if (creds) flowLoop(config);
                else console.log("[flow] Login prompt cancelled — not logging in this time.");
                return;
            }

            // Step 3/4: the form is showing — fill and submit, once.
            if (emailInput && passwordInput) {
                clearInterval(timer);
                console.log("[flow] Login form visible — clicking fields then logging in");
                fillAndSubmit(config, emailInput, passwordInput);
                return;
            }

            const now = Date.now();

            // Step 2: "Login with Email" style chooser.
            const chooser = findVisible(config.chooser);
            if (chooser && now - lastChooserClick > FLOW_RECLICK_COOLDOWN_MS) {
                lastChooserClick = now;
                humanClick(chooser);
                console.log("[flow] Clicked email-login chooser");
                return;
            }

            // Step 1: header login button.
            if (!chooser && now - lastOpenClick > FLOW_RECLICK_COOLDOWN_MS) {
                const opener = findVisible(config.open) || findVisibleOpenLoginButton();
                if (opener) {
                    lastOpenClick = now;
                    humanClick(opener);
                    console.log("[flow] Clicked header login button");
                }
            }
        }, 500);
    }

    // ===== CAPTCHA DETECTION =====
    // Every major captcha writes its solved token into a hidden field; CapSolver
    // fills these same fields, so a non-empty token means "solved" no matter
    // whether CapSolver shows its on-page overlay or not (it doesn't for Turnstile).
    const CAPTCHA_TOKEN_SELECTORS = [
        'input[name="cf-turnstile-response"]',  // Cloudflare Turnstile (FortuneWins)
        'textarea[name="g-recaptcha-response"]', // reCAPTCHA v2/v3
        'textarea[name="h-captcha-response"]',   // hCaptcha
        'input[name="h-captcha-response"]'
    ];
    const CAPTCHA_WIDGET_SELECTOR = [
        '.cf-turnstile', '[class*="turnstile" i]', 'iframe[src*="challenges.cloudflare.com"]',
        '.g-recaptcha', 'iframe[src*="recaptcha"]',
        '.h-captcha', 'iframe[src*="hcaptcha"]',
        ...CAPTCHA_TOKEN_SELECTORS
    ].join(',');

    function getCaptchaState() {
        // CapSolver's own overlay (shown for some captcha types)
        const capsolverDiv = document.querySelector("div.capsolver-solver-info");
        if (capsolverDiv && capsolverDiv.innerText.trim() === "Captcha solved!") {
            return { present: true, solved: true, source: "CapSolver overlay" };
        }

        const tokenFields = document.querySelectorAll(CAPTCHA_TOKEN_SELECTORS.join(','));
        for (const field of tokenFields) {
            if ((field.value || "").trim().length > 0) {
                return { present: true, solved: true, source: field.name };
            }
        }

        const present = !!capsolverDiv || tokenFields.length > 0 ||
                        !!document.querySelector(CAPTCHA_WIDGET_SELECTOR);
        return { present, solved: false, source: null };
    }

    function waitForCaptchaSolved(onReady = clickLoginButton) {
        const startedAt = Date.now();
        let finished = false;
        let sawCaptcha = false;

        // Exactly one path (solved / no captcha / timeout) gets to trigger the login.
        function finish(reason, delayMs) {
            if (finished) return;
            finished = true;
            clearInterval(interval);
            clearTimeout(timeout);
            console.log(`${reason} — clicking login in ${Math.round(delayMs / 1000)}s...`);
            setTimeout(() => onReady(), delayMs);
        }

        const interval = setInterval(() => {
            const state = getCaptchaState();
            if (state.present) sawCaptcha = true;

            if (state.solved) {
                finish(`Captcha solved (${state.source})`, CLICK_DELAY_AFTER_SOLVE_MS);
            } else if (!sawCaptcha && Date.now() - startedAt > NO_CAPTCHA_GRACE_MS) {
                finish("No captcha on page", 500);
            }
        }, 250);

        const timeout = setTimeout(() => {
            finish("Captcha timeout — attempting login anyway", 0);
        }, CAPTCHA_TIMEOUT_MS);
    }

    // ===== BOOT =====
    async function start() {
        // Popup-login sites (FORM_FLOW_SITES) run on any page; everything else only on its /login page.
        if (!FORM_FLOW_SITES[ACTIVE_DOMAIN] && !/^\/login/i.test(location.pathname)) return;

        let method = gv(methodKey(ACTIVE_DOMAIN), '');
        if (method !== "google" && method !== "password") {
            method = await askLoginMethod(ACTIVE_DOMAIN, '');
            if (!method) {
                console.log("Login method prompt cancelled — not logging in this time.");
                return;
            }
            sv(methodKey(ACTIVE_DOMAIN), method);
            console.log(`Saved login method for ${ACTIVE_DOMAIN}: ${method}`);
        }
        ACTIVE_METHOD = method;

        const siteConfig = getSiteConfig();
        if (siteConfig.type === "flow") {
            runFormFlow(siteConfig);
        } else {
            waitForCaptchaSolved();
        }
    }

    try {
        GM_registerMenuCommand('🔑 Set GitHub token (also tests it)', setToken);
        GM_registerMenuCommand('➕ Add a site by typing…', () => { const t = prompt('Site to add (e.g. www.example.com):', ''); if (t && t.trim()) addSite(t); });
    } catch (e) { /* menu not available */ }

    ACTIVE_DOMAIN = siteFor(HOST);
    if (!ACTIVE_DOMAIN) {
        // Not one of the listed casinos: stay dormant (just the add-site menu, and a button where a token is set).
        try { GM_registerMenuCommand('➕ Add ' + normDomain(HOST) + ' to Auto Login', () => addSite(HOST)); } catch (e) { /* ignore */ }
        if (gv(TOKEN_KEY, '')) showAddSiteButton();
    } else {
        try {
            GM_registerMenuCommand('🔁 Change login method for ' + ACTIVE_DOMAIN + ' (now: ' + (gv(methodKey(ACTIVE_DOMAIN), '') || 'not set') + ')', async () => {
                const m = await askLoginMethod(ACTIVE_DOMAIN, gv(methodKey(ACTIVE_DOMAIN), ''));
                if (m) { sv(methodKey(ACTIVE_DOMAIN), m); location.reload(); }
            });
            GM_registerMenuCommand('🗑 Remove ' + ACTIVE_DOMAIN + ' from Auto Login', () => { if (confirm('Remove ' + ACTIVE_DOMAIN + ' from Auto Login?')) removeSite(ACTIVE_DOMAIN); });
        } catch (e) { /* menu not available */ }
        start();
    }
})();
