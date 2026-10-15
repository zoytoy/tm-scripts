# tm-scripts

Tampermonkey userscripts that auto-update on every installed browser.

## How it works

Each script's header has:

```
// @version      1.0.0
// @updateURL    https://raw.githubusercontent.com/zoytoy/tm-scripts/main/<file>.user.js
// @downloadURL  https://raw.githubusercontent.com/zoytoy/tm-scripts/main/<file>.user.js
```

Tampermonkey periodically re-fetches `@updateURL`; if `@version` is higher than the installed one it updates. 
The repo must be public so the raw URL needs no login.

## Install (clients)

Open the script's raw URL in a browser with Tampermonkey installed and click Install:

- https://raw.githubusercontent.com/zoytoy/tm-scripts/main/contestcomment.user.js

To pull an update immediately: Tampermonkey dashboard -> Utilities -> Check for userscript updates.
(Default is every 24h; Settings -> Externals -> Update interval.)

## Publish a change

Edit the script, then:

```
.\publish.ps1 "what changed"
```

That bumps the patch version of every changed `.user.js`, commits and pushes.

## Add a new script

1. Create `name.user.js` with the usual header plus the two URLs above pointing at that filename and a `@version`.
2. `git add name.user.js`, then `.\publish.ps1 "add name"` (or commit and push by hand).
3. Send clients its raw URL.

## Notes

- Never put secrets in these files; they are public.
- `contestcomment.user.js` can also edit its own poster list on GitHub from the Tampermonkey menu. That needs a
  fine-grained token limited to this repo (Contents: Read and write), pasted in per browser. Clients don't need one.
