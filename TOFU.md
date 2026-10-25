# Tofu gallery copy

This repository is Tofu's copy of **actualbudget/actual** (licence: MIT), listed in Tofu's app gallery as **Envelope budget planner** (Actual Budget): a local-first envelope budgeting app with accounts, transactions, a monthly budget by category, schedules, rules and reports. Each budget is kept in the browser of the person using it.

- `master` mirrors the upstream repository and is never committed to by Tofu.
- `tofu` carries Tofu's own changes; tags named `pin/<date>` mark the versions the gallery points to. The current pin is `pin/2026-10-25`.
- A visitor who chooses this app gets a private snapshot of the pinned version in their own Tofu account. Their copy does not follow upstream updates.
- Upstream: https://github.com/actualbudget/actual at `2bebdbaae0b701120a8cad9d56aafd64fa04c577`, the release `v26.10.0` (2026-10-02). Upstream tags its releases on its `release` branch, not on `master`, so `tofu` starts from that release commit rather than from `master`: 25 commits of the release are not on `master`, and `master` had 573 commits the release does not have when this copy was made.

## How Tofu runs it

- Framework preset `container`, root folder `site`. Tofu builds `site/Dockerfile` and runs the image as a service, so there is no install command, build command or output directory. The image is `node:22-alpine` (from `mirror.gcr.io`) with `site/LICENSE.txt`, `site/server.mjs` and `site/web/` copied in, started with `node server.mjs`. Nothing is installed or built in the image.
- `site/web/` is Actual's web client, already built from this branch's source (see "How `site/web` is built").
- `site/server.mjs` is a small Node server with no dependencies. It listens on `PORT` (Tofu sets it; 80 without it) and serves `site/web/`. Every response carries `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`, the `Content-Security-Policy` upstream's sync server sends in production (`packages/sync-server/src/app.ts`) and `X-Content-Type-Options: nosniff`. A page address of the app (`/budget`, `/accounts/<id>`) gets `index.html`. Any other address without a file gets a plain-text 404, including the sync server's own `/account/needs-bootstrap`. Actual asks that address once to find out whether a sync server runs at this address, and the 404 tells it none does. Text files are sent compressed (`br` or `gzip`); files under `/static/` (named by their content hash) are cached for a year, everything else is revalidated.
- No database, no settings and no secrets. Nothing has to be set before or after the first deploy.
- Where the data lives: Actual keeps each budget in the visitor's own browser, in a SQLite database it stores in IndexedDB from a web worker. The server stores nothing.
- Why not Tofu's static hosting, which would serve these files for free: Actual needs `SharedArrayBuffer`, which a browser only gives a page served with the two `Cross-Origin-*` headers above. Tofu's static hosting cannot send custom headers. Without them Actual shows an error page instead of the app; its way around that is marked unsupported and may lose data. Upstream's own deployments send the same headers (its sync server, and `packages/desktop-client/public/_headers` for Netlify).

## How `site/web` is built

From the root of a git clone of this repository, with the source as of `b8996c020b7d2a3e1a395f12afd876529c7bcbcb` (this branch's second Tofu commit; the first only removes images and changes no file the build reads), Node 22.22.3 and the Yarn that `.yarnrc.yml` names (`.yarn/releases/yarn-4.17.1.cjs`):

```sh
git clone https://github.com/actualbudget/translations packages/desktop-client/locale
git -C packages/desktop-client/locale checkout 1d3585a06ae3ad8b2833667234317ae149c3c008
node packages/desktop-client/bin/remove-untranslated-languages
HUSKY=0 ELECTRON_SKIP_BINARY_DOWNLOAD=1 node .yarn/releases/yarn-4.17.1.cjs install --immutable
node .yarn/releases/yarn-4.17.1.cjs build:browser --skip-translations
rm -rf site/web
rsync -a --exclude='*.map' --exclude='.vite/' --exclude='_headers' --exclude='_redirects' packages/desktop-client/build/ site/web/
cp LICENSE.txt site/web/LICENSE.txt
```

- `yarn build:browser` is upstream's own release build (`bin/package-browser`, the command upstream's release workflows run). Without `--skip-translations` it clones the translations repository at its newest commit, which would not give the same result twice, so the translations are checked out at `1d3585a0…` (2026-10-02 04:20 UTC), the last commit before `v26.10.0` was published. `remove-untranslated-languages` is upstream's step that keeps the languages at least half translated: Catalan, German, English, British English, Spanish, French, Italian, Norwegian Bokmål, Dutch, Polish, Brazilian Portuguese, Russian, Ukrainian and Chinese (Simplified and Traditional).
- Upstream's `.nvmrc` names Node 24.18.1; its `engines` field accepts 22.18.0 or later, and the build here used 22.22.3.
- The copy leaves out the build's 47 source maps (36 MB), `.vite/manifest.json` (not used at run time) and Netlify's `_headers` and `_redirects`, which `site/server.mjs` replaces. None of them is in the service worker's precache list. `LICENSE.txt` is added so the licence is served at `/LICENSE.txt`.
- The result is 160 files, 17 MB. A change to the client's source needs this build run again and `site/web/` replaced in the same commit.
- `rm -rf site/web` empties the folder before the build is copied into it, so nothing of an earlier build stays behind. Many of the built files are named after their content (`static/js/*.<hash>.chunk.js`, `kcab/kcab.worker.<hash>.js`, `workbox-<hash>.js`), so a build of changed source has new file names, and copying it over the old folder would keep the old files next to the new ones. The build itself starts from empty folders every time: Vite empties `packages/desktop-client/build/` and loot-core's `lib-dist/browser/`, and the web build deletes `public/kcab/` before it copies the worker there.
- A git clone keeps the execute bits upstream's build scripts need (`yarn build:browser` runs `./bin/package-browser`). `git clone` of the translations needs `packages/desktop-client/locale` not to exist, so in a clone that kept it from an earlier build, delete it first.

## What Tofu changes

- **Removed so the repository fits Tofu's GitHub import** (at most 50 MB; upstream's archive of `v26.10.0` is 59.5 MB, this branch's about 20.5 MB). A copy needs none of these files to build or run:
  - `packages/desktop-client/e2e/*-snapshots/` (444 PNG files, about 30 MB): the reference screenshots of upstream's visual regression tests.
  - `packages/desktop-electron/e2e/__screenshots__/` (3 PNG files): the same for the desktop app.
  - `packages/docs/static/img/` (469 images, about 15 MB): the pictures of the documentation site.
  - The tests and the documentation text stay. The visual regression tests and the documentation site need the removed files, so they do not run on `tofu` as it is; `master` and upstream have them.
- **No requests to GitHub unless the owner asks for them.** `packages/loot-core/src/server/preferences/app.ts`: two settings that upstream turns on by default are now off by default. "Display a notification when updates are available" asks `api.github.com` for upstream's latest release each time the app starts. "Show in-app notifications (release notes and announcements)" fetches upstream's news feed from `raw.githubusercontent.com`. A copy is a fixed snapshot that does not follow upstream, so neither applies to it. Both stay switches on the Settings page, and a value saved before is kept. `packages/desktop-client/src/hooks/useNewsFeed.ts` only has its comment updated to say so.
- **`site/` (new):** `Dockerfile`, `server.mjs`, `LICENSE.txt` (upstream's, unchanged) and `web/` (above).
- Nothing else in the app changes. Upstream has no analytics, trackers, ads or donation prompts in the web client, so there was nothing to remove. The links in the app (help, documentation, Discord, the support contact) still point to the upstream project.

## What works differently on Tofu

- **No sync server, so each browser holds its own budgets.** The copy runs Actual's local mode, and the app shows "No server" in its top bar. A budget made on one device or browser is not on another, and clearing the browser's site data deletes it. To move or back up a budget, use Settings → Export data, then "Import my budget" on the other side. Upstream's sync server, which keeps budgets on a server, syncs devices and holds sign-in, is not part of the copy: it keeps its accounts and budget files on a disk, and Tofu's server hosting has no disk that lasts. Moving it to a Tofu database and storage would be a separate, larger change.
- **Features that need a sync server are not available:** syncing between devices, bank sync (GoCardless, SimpleFIN and the others), and end-to-end encryption of synced budgets. An owner who runs an Actual sync server elsewhere can point the copy at it ("Connect to a sync server" on the first screen, or "Start using a server" in the "No server" menu). That was not tried here.
- **No accounts and nothing to close.** Anyone who can open the address can use the app, but each visitor only ever sees the budgets in their own browser, and nothing is stored on Tofu. An owner who does not want others to use their copy can make it private on Tofu.
- **The app works offline once loaded.** Its service worker caches the client. After a new deploy, a browser that opened the copy before may keep running the version it cached until the page is reloaded or the app's own update prompt is accepted.

## Needs a real deploy to verify

- The image builds on Tofu's container hosting (pulling `mirror.gcr.io/library/node:22-alpine`) and `/` answers 200 on `PORT`.
- The two `Cross-Origin-*` headers reach the browser unchanged through Tofu's address, so `crossOriginIsolated` is true there. If anything in front of the app removed them, Actual would show its `SharedArrayBuffer` error page.
- How long the container takes to answer its first request after it has been idle.
- The service worker and "install as an app" on the copy's own address.

## Licence

- MIT. `LICENSE.txt` ("Copyright James Long") is unchanged. It is copied, unchanged, to `site/LICENSE.txt` (in the image) and `site/web/LICENSE.txt` (served at `/LICENSE.txt`). `packages/sync-server/LICENSE` is unchanged. No licence or notice file was removed.
- The built client in `site/web/` bundles the npm packages it depends on under their own licences, as upstream's own builds do, including sql.js (`sql-wasm.wasm`, MIT) and Actual's bundled default database and migrations from `packages/loot-core`. The fonts are Inter (`@fontsource-variable/inter`) and Redacted Script (`@fontsource/redacted-script`), both under the SIL Open Font License 1.1. The translations come from actualbudget/translations (MIT), written by its contributors on Weblate.
- The Actual name and logo belong to the upstream project; the gallery uses them only to say which app this is.
- MIT asks for no source offer. The copy shows no link to its own source, and the app's links to upstream's GitHub stay as they are.

## Verification

2026-10-25, on macOS arm64 against 127.0.0.1 only. No Docker, nothing deployed.

- Build: `yarn install --immutable` (Yarn 4.17.1, 2,485 packages) and `yarn build:browser --skip-translations` succeeded: lage built `plugins-service`, `@actual-app/crdt`, `@actual-app/core` and `@actual-app/web` (`build:browser`) with no failures. The built worker (`kcab/kcab.worker.BZAskUSD.js`) has both settings above defaulting to off. Every one of the 151 files in the service worker's precache list is in `site/web/`.
- Run as the image would: `site/LICENSE.txt`, `site/server.mjs` and `site/web/` copied into an empty folder exactly as the `Dockerfile`'s `COPY` lines name them, then `PORT=<free port> HOST=127.0.0.1 node server.mjs` (Node 22.22.3). `GET /` answered 200 `text/html` with `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp` and the CSP. A page address (`/budget`, sent with `Accept: text/html`) got `index.html` with 200. `/account/needs-bootstrap` (sent as the app sends it) got a plain-text 404. `/sql-wasm.wasm` was `application/wasm`. The worker came back `br`-compressed and `/static/` files with `Cache-Control: public, max-age=31536000, immutable`. `If-None-Match` got 304, `HEAD /` 200, `POST /` 405, and `/../server.mjs`, `/%2e%2e/server.mjs`, `/.vite/manifest.json` and a removed source map all 404.
- Browser (Playwright's Chromium, headless, 127.0.0.1 only): the page reported `crossOriginIsolated: true` and `SharedArrayBuffer` available. The first screen was "Welcome to Actual" at `/`, with no "Where's the server?" screen. "Start budgeting" opened a new budget at `/budget`. "Add account" with the name "Tofu check account" and the balance 1234.56 opened the account with a "Starting Balance" row of 1,234.56. After a reload, the same account, balance and row were read back from the browser's storage. A service worker was registered. No page error and no console error. The only response of 400 or more was the expected 404 for `/account/needs-bootstrap`, and no request went to any other host.
- Tofu's own check on the pushed `tofu` branch (the GitHub import with root folder `site`, then Tofu's static-lane predicates and safety check) printed:

  ```
  actual                   tofu                 root=site       detect=container files=  163 published= 162 -> not on the static lane | refused: typex56 | build: not_vite | safety ok (24 findings)
  free static limit: 162/500 published files | archive 200 20474138
  ```

  The import keeps all 163 files of `site/`, and the detector answers `container`. The 24 findings are all medium and none blocks a deploy: 15 `rls-disabled` on the SQL files in `site/web/data/migrations/`, which are the migrations Actual runs on each visitor's SQLite database in the browser and never reach a Tofu database (the copy has none); 7 `obfuscated-code` on long encoded literals in bundled code (the worker, the date picker chunk and the IndexedDB worker); and 2 `secret-exfiltration`: `firstLoginPassword` is the sign-in page's request to a sync server, which a copy never sends unless its owner connects one, and `nextToken` is the parser library chevrotain (bundled through hyperformula) reading its next token, not a credential.
- All local servers and the browser were stopped afterwards.
