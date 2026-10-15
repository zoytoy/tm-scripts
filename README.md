# tm-scripts

Tampermonkey userscripts that auto-update on every installed browser.
This repo is **public** - never put passwords, tokens or other secrets in any file here.

## Scripts

| Script | What it does | Install link |
|---|---|---|
| Casino Google Form Input (`casino-form.user.js`) | Reads the SC balance on casino sites, auto-submits it to the Google Form, and offers a manual form, element picker and API picker. Dormant on sites not in its list. | https://raw.githubusercontent.com/zoytoy/tm-scripts/main/casino-form.user.js |
| Contest Comment Helper (`contestcomment.user.js`) | On Instagram and Facebook contest posts from listed accounts/pages, finds the most common answer and types it into the comment box. Never clicks Post. | https://raw.githubusercontent.com/zoytoy/tm-scripts/main/contestcomment.user.js |

| Auto Login to Casinos (`auto-login.user.js`) | On a casino's login page, waits for the captcha to be solved, then logs in. Each user chooses per site whether they use Google or email/password. | https://raw.githubusercontent.com/zoytoy/tm-scripts/main/auto-login.user.js |

## Onboarding a new user

1. Install the **Tampermonkey** extension in their browser.
2. Open each install link above in that browser and click **Install**.
3. Casino form only: when the **Owner** prompt appears (first time the script needs it), enter that person's name. It is stored on that computer and never overwritten by updates. Change it later from the Tampermonkey menu -> "Change Owner name".
   Auto login only: the first time they open a listed casino's login page, a box asks **"Sign in with Google"** or **"Email & password"** for that site. The answer is stored on that computer per site (each person can choose differently) and is never overwritten by updates. Change it any time: Tampermonkey menu -> "Change login method for <site>". Choosing email/password on a popup-login site (Lonestar, RealPrize) also asks once for the email and password, which are stored locally in Tampermonkey.
4. Remove or disable any **old copies** of the same scripts so two versions don't run at once. (Installing from the link over a script with the same name replaces it in place and keeps its saved settings.)
5. Check it works:
   - Casino form: open a listed casino; an "Open Casino Form" button appears bottom-right.
   - Contest helper: open a contest post from a listed account; a small box appears bottom-left after a few seconds.
6. Clients do **not** need a GitHub token. They get updates automatically (see below).

## How updates reach people

Each script header has `@version`, `@updateURL` and `@downloadURL` pointing at the raw file in this repo. Tampermonkey re-checks about once a day and installs the file when `@version` is higher.

To update right now: Tampermonkey dashboard -> **Installed Userscripts**, tick the script, choose **Update** from the dropdown at the bottom. Or just open the script's install link and click **Update/Reinstall**.

## Admin notes (only the admin's computer needs these)

### Publishing a change

Edit the script in `C:\scripts\tm-scripts`, then:

```
.\publish.ps1 "what changed"
```

It bumps the patch `@version` of every changed `.user.js`, commits and pushes. Always bump the version, or nobody gets the update.

### GitHub token

Needed only on the admin's machine, only for the menu features that edit the shared lists from inside the browser.

- Create: github.com/settings/personal-access-tokens -> fine-grained token, **Only select repositories** -> `zoytoy/tm-scripts`, **Contents: Read and write**.
- Keep it in the password manager (Bitwarden). Lost it? Open the token on that page and **Regenerate token**, then paste the new one everywhere.
- Paste it once **per script, per browser**: Tampermonkey menu -> "Set GitHub token (also tests it)". Tampermonkey storage is per script, so each script needs it separately.
- A 403 when pushing means the token isn't set to Contents: Read and write on this repo.

### Adding a site (casino form)

Open the site, then Tampermonkey menu -> "Add <site> to Casino Form" (or click the blue button that appears on unlisted pages when a token is set). It saves locally, pushes to the shared `SITES` list and reloads the page. Clients get it at their next update.
Casinos embedded as iframes (e.g. `game.*` hosts) can't be added from the parent page: use "Add a site by typing..." with the hostname.
Selectors saved with the Pick SC Element / API Picker buttons stay on that one computer. To share one, add it to `siteConfigs` in `casino-form.user.js` and publish.

### Adding a site (auto login)

Open the site's login page, then Tampermonkey menu -> "Add <site> to Auto Login" (or the teal button that appears on login-looking pages when a token is set). It saves locally, pushes the domain to the shared `SITES` list and reloads. The script is dormant on any domain not in that list.
A newly added site only gets generic handling (a "Sign in with Google" button, or a form with a password field and a Login/Sign in submit button) and is only acted on at `/login...` URLs. If a site needs specific selectors or is a popup login with no `/login` page, add an entry for it to `CUSTOM_SITES` or `FORM_FLOW_SITES` in `auto-login.user.js` and publish. Each user's Google vs email/password choice is local and not part of the shared list.

### Adding a poster/page (contest helper)

On the post's page: Tampermonkey menu -> "Add this post's poster/page". It pushes to `POSTERS_IG` / `POSTERS_FB`. Or edit those lines by hand and publish.

### Adding a new script to this repo

1. Create `name.user.js` with a `@version` and these header lines (use the new filename):
   ```
   // @updateURL    https://raw.githubusercontent.com/zoytoy/tm-scripts/main/name.user.js
   // @downloadURL  https://raw.githubusercontent.com/zoytoy/tm-scripts/main/name.user.js
   ```
2. `.\publish.ps1 "add name"`.
3. **Add it to the Scripts table above** (what it does + install link) and push the README, so the onboarding list stays complete.
4. Send existing users its install link.

## Per-script notes

- **casino-form**: runs on all https pages but does nothing on unlisted sites. The Google Form URL and field IDs are in the file (public); if someone spams the sheet, make the repo private and clean the rows - note auto-update stops while the repo is private.
- **auto-login**: installed on every https page but does nothing on unlisted domains. Keeps per-site login method (`method:<domain>`) and saved popup-login credentials (`creds:<domain>`) in each computer's Tampermonkey storage. Its token is entered separately from the other scripts' tokens. Keep the original `@name`/`@namespace` unchanged so installing over an older copy preserves saved logins.
- **contestcomment**: never submits anything; you always click Post yourself.
