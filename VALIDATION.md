# Validation

October 4, 2026 Apps Script update: 14 Node tests pass, including backend key rejection, invalid input rejection, duplicate append protection, edit conflicts, lock release, and safe header migration. App JavaScript syntax check passes. These backend tests use mocked Apps Script services. Live deployment, cross-origin browser responses, and actual phone PWA behavior still require the owner's deployed script.

Headless Edge integration checks also pass for both connection modes, including Apps Script setup, POST body key transport, saving, reconnecting with cleared sessionStorage, editing, wrong-key rejection, forgetting settings, and the updated offline shell. Browser backend responses were mocked, so this does not verify Google's live redirect/CORS behavior.

Verified locally on September 28, 2026:

- Seven Node tests pass: unit conversion, nursing requirements, invalid inputs, literal notes, incompatible headers, duplicate-ID handling, and local-day totals.
- Browser integration checks pass in headless Microsoft Edge at a 390 px phone viewport, using **mock Google responses and synthetic entries**.
- The browser checks exercise Settings, Google authorization callback, sheet selection, all three entry types, refresh, safe rendering of HTML-like notes, tab session restoration and expiration, token removal on sign-out, lost-append-response reconciliation without duplicate writes, offline controls, and denied sheet access.
- The real service worker successfully reloads the app shell offline. Its cache contains only the ten expected same-origin static assets.
- JavaScript syntax checks pass. Mobile screenshot inspected for layout and readability.

Not verified: live Google OAuth/Picker configuration, actual shared-sheet requests from two Google accounts, native iOS/Android installation, or a GitHub Pages deployment. Those need the owner's Google project and repository. Optional experimental WebMCP registration is feature-detected; no supported WebMCP browser was available for that check.

The browser integration script is `tests/browser.cjs`. It needs the optional `playwright` package and Microsoft Edge. The app and default Node tests do not need Playwright. With Playwright available, run `node tests/browser.cjs` while `npm start` is running. Screenshots go into ignored `test-results/`. Mocks verify app behavior; they do not prove Google's live service configuration.
