// ==UserScript==
// @name         LuckyParty Auto Claim Now + Close Popups
// @namespace    https://luckparty.com/
// @version      1.2.1
// @description  Auto-clicks "Claim Now" buttons and closes retarget + welcome-back popups on luckparty.com and americanluck.com
// @match        https://luckparty.com/*
// @match        https://*.luckparty.com/*
// @match        https://americanluck.com/*
// @match        https://*.americanluck.com/*
// @updateURL    https://raw.githubusercontent.com/zoytoy/tm-scripts/main/auto-claim.user.js
// @downloadURL  https://raw.githubusercontent.com/zoytoy/tm-scripts/main/auto-claim.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Elements we've already clicked, so we don't spam-click the same button.
    const clicked = new WeakSet();

    function isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' &&
               style.visibility !== 'hidden' &&
               style.pointerEvents !== 'none' &&
               style.opacity !== '0';
    }

    // ── Claim Now logic ──────────────────────────────────────────────────────
    function findClaimDivs() {
        const byInner = Array.from(document.querySelectorAll('div.button-content'))
            .filter(el => el.textContent.trim().toLowerCase() === 'claim now');
        // americanluck free-offer dialog button
        const byClass = Array.from(document.querySelectorAll('button.free-offer-dialog__button'))
            .filter(el => el.textContent.trim().toLowerCase() === 'claim now');
        return [...byInner, ...byClass];
    }

    function clickTargetFor(el) {
        return el.closest('button, a, [role="button"], .button, [class*="btn"]') || el;
    }

    function scanClaims() {
        for (const div of findClaimDivs()) {
            const target = clickTargetFor(div);
            if (clicked.has(target)) continue;
            if (target.disabled) continue;
            if (!isVisible(target)) continue;

            clicked.add(target);
            console.log('[Auto Claim Now] clicking', target);
            target.click();
        }
    }

    // ── Popup closing logic ──────────────────────────────────────────────────
    function closeRetargetModal() {
        // Primary close button inside the retarget modal
        const closeBtn = document.querySelector(
            '.retarget-modal.retarget-entered button.retarget-close, ' +
            '.retarget-modal button.retarget-close[aria-label="Close"]'
        );

        if (closeBtn && isVisible(closeBtn) && !clicked.has(closeBtn)) {
            clicked.add(closeBtn);
            console.log('[Auto Close] closing retarget modal', closeBtn);
            closeBtn.click();
            return true;
        }
        return false;
    }

    function closeWelcomeBackDialog() {
        // Prefer the dedicated close (X) button
        let closeBtn = document.querySelector(
            '.app-dialog.welcome-back-dialog button.close-popup-button, ' +
            '.welcome-back-dialog button.app-dialog__close-button'
        );

        // Fallback: the "Close" text button inside the dialog
        if (!closeBtn) {
            const candidates = document.querySelectorAll(
                '.welcome-back-dialog button.app-button, ' +
                '.app-dialog.welcome-back-dialog button'
            );
            for (const btn of candidates) {
                const text = (btn.textContent || '').trim().toLowerCase();
                if (text === 'close' || btn.querySelector('.button-content')?.textContent.trim().toLowerCase() === 'close') {
                    closeBtn = btn;
                    break;
                }
            }
        }

        if (closeBtn && isVisible(closeBtn) && !clicked.has(closeBtn)) {
            clicked.add(closeBtn);
            console.log('[Auto Close] closing welcome-back dialog', closeBtn);
            closeBtn.click();
            return true;
        }
        return false;
    }

    function scanPopups() {
        closeRetargetModal();
        closeWelcomeBackDialog();
    }

    // ── Main scan ────────────────────────────────────────────────────────────
    function scan() {
        scanClaims();
        scanPopups();
    }

    // Initial pass
    scan();

    // Re-scan on DOM changes (SPA re-renders, delayed loads, etc.)
    const observer = new MutationObserver(() => scan());
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    // Safety-net poll
    setInterval(scan, 1500);
})();
