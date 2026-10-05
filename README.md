# Milky Way

## Recommended: connect once using Apps Script

For automatic connection on every launch without Google sign-in, follow [Apps Script setup](apps-script/SETUP.md). GitHub Pages still hosts the PWA for free; Apps Script handles authorized access to the private sheet. Each phone saves the deployed endpoint and a shared access key in Settings. Anyone with the key can access the log, so keep it private and out of this repository.

The Google OAuth instructions below describe the alternative **Google sign-in** connection mode. Apps Script mode does not need the OAuth client, Google Picker key, or repeated sheet selection described below. Its access key is a persistent credential stored in localStorage; the token-storage statements below apply only to Google sign-in mode.

A small, installable phone app for two parents to log bottle feeds, breastfeeding, and pumping sessions in one private Google Sheet. Plain HTML, CSS, and JavaScript; no package dependencies or paid server. Includes a GitHub Pages deployment workflow.

## What is ready

- Bottle amount and milk type; breastfeed duration and side; pumping amount, duration, and side.
- mL or US fluid ounces, optional notes, backdated entries, local-day totals, and recent activity.
- Google authorization using `drive.file`, limited to files explicitly selected with Google Picker.
- Automatic refresh every 30 seconds while visible, plus manual refresh.
- Installable PWA with offline app shell. Reading after restart and all saves require internet. No background synchronization or offline record queue.
- Records can be corrected or deleted directly in the sheet. Its revision history provides recovery.

## Security design — read before setup

GitHub Pages serves public files. It cannot make the app shell private or store server secrets. Google protects the records: each request needs a Google access token and the signed-in account must have access to the sheet. A client-side email list would not provide security, so this app does not use one.

Keep sheet sharing **Restricted**, with only your two Google accounts as editors. Do not publish the sheet to the web or turn on “Anyone with the link.” People who find the app URL can see its shell; they cannot read your sheet without Google granting access. They could configure the generic app against a sheet of their own, which does not grant access to yours.

All project-specific values are entered in Settings on each device. None are substituted into source files, deployment artifacts, repository variables, or Actions logs. The browser stores the OAuth client ID, project number, restricted Picker API key, selected sheet ID, and unit preference in localStorage. Tokens and records stay in app memory, not localStorage or the service-worker cache. The app adds no analytics or remote logging.

**OAuth client IDs and browser API keys cannot be hidden from someone inspecting a browser that uses them.** These are public-client configuration, not user credentials. Restrict the browser key as described below. Never create or enter a client secret, service account key, refresh token, or password. This architecture keeps actual credentials out of GitHub, but cannot promise invisible OAuth metadata during use. GitHub Actions secrets would not fix that: anything injected into a static build is public.

For stronger origin isolation, use a dedicated GitHub account/site origin or a custom domain if you already own one. All Pages projects under the same `ACCOUNT.github.io` origin share browser storage access. Only publish code you trust on that origin. No custom domain purchase is required.

## 1. Publish to GitHub Pages

1. Create an empty **public** repository on GitHub. Free Pages supports public repositories. Use a generic name such as `milky-way` with no baby information in the repository name, description, commits, or issues.
2. Put the contents of this folder at the repository root, including `.github/workflows/pages.yml`. Only `public/` is deployed. Do not upload the outer `outputs` or `work` folders.
3. In repository **Settings → Pages**, set **Source → GitHub Actions**.
4. Push to `main`, or run **Deploy GitHub Pages** manually from the Actions tab after enabling Pages. Wait for the deployment to succeed.
5. Note the HTTPS site URL, usually `https://ACCOUNT.github.io/REPOSITORY/`. All asset paths and service-worker scope are relative, so project subpaths work.

If using Git locally, from this folder:

```sh
git init -b main
git add .
git commit -m "Add private Google Sheets baby log app"
git remote add origin https://github.com/ACCOUNT/REPOSITORY.git
git push -u origin main
```

Use your GitHub sign-in/credential manager when prompted. No Google values belong in these commands.

## 2. Create the Google project (once)

Use [Google Cloud Console](https://console.cloud.google.com/) while signed into your own account. Both parents use the same project configuration.

1. Create a project with a generic name, such as `Milky Way`.
2. Enable **Google Sheets API**, **Google Drive API**, and **Google Picker API** in the API Library. Drive is used to verify Editor access; Picker selects the sheet. Normal family usage is small; this app does not require a paid backend or a service account.
3. Under **Google Auth Platform**, configure Branding, Audience, and Data Access. Choose an **External** audience for personal Gmail accounts. Keep it in **Testing**, add only your two Google accounts as test users, and add this scope:

   `https://www.googleapis.com/auth/drive.file`

   Testing is an additional Google-controlled gate. Test authorizations can expire after seven days, and the app’s short-lived access tokens require reconnecting more frequently. The app deliberately has no persistent refresh token. Personal-use production settings are another option, but sheet sharing remains the real data-access boundary in either mode. Follow Google’s current prompts and policy requirements if changing publication state.

4. Create an OAuth client of type **Web application**. Add the **Authorized JavaScript origin** `https://ACCOUNT.github.io` — origin only, without the repository path or trailing slash. This popup token flow does not require a redirect URI. For optional local sign-in testing, also add `http://127.0.0.1:4173`.
5. Copy the **client ID**, ending in `.apps.googleusercontent.com`. Do not copy or use a client secret.
6. Find the numeric **project number** on the project dashboard. This is not the textual project ID.
7. Create a browser **API key** under APIs & Services → Credentials. Set application restrictions to **Websites (HTTP referrers)**, allowing both `https://ACCOUNT.github.io/*` and `https://docs.google.com/*`. Google Picker runs in a docs.google.com iframe; omitting that referrer can cause an “API developer key is invalid” error. Because browsers send origin-only referrers across origins, do not depend on a repository path restriction. If testing locally, separately allow `http://127.0.0.1:4173/*`.
8. Restrict that key to **Google Picker API**. The app’s Sheets and Drive requests use the OAuth token, not this API key. The key and OAuth client must belong to the same project whose number you entered.

Keep these three values privately, such as in your password manager. Enter them into each phone’s Settings, never into files committed to GitHub. Key restrictions and allowed origins must match a custom domain if you use one.

## 3. Create and share the sheet (once)

1. Create a blank Google Sheet using either parent’s Google account.
2. Share it with the other parent’s exact Google account as **Editor**. Keep General access **Restricted**. Do not enable Publish to web.
3. On each phone, open Milky Way, open Settings, and enter the same client ID, project number, and restricted Picker API key.
4. Tap **Connect with Google** and select the account with access to the sheet. Allow the requested permission.
5. Tap **Choose shared sheet** and select that same sheet on both phones. Selection adds a `BabyLog` tab if it does not exist, and headers if the tab is empty. Existing unrelated tabs are left alone. A nonempty `BabyLog` tab with incompatible headers is rejected rather than overwritten.
6. Make one test entry on one phone and refresh on the other. Verify it appears and that the total is correct. Delete that test row directly in Google Sheets afterward.
7. Check that a third account without sheet access cannot read it. Do not change the sheet’s sharing to make an access error disappear.

## 4. Install on your phones

- **iPhone:** Open the site in Safari → Share → Add to Home Screen.
- **Android:** Open in Chrome → menu → Install app / Add to Home screen.

If the installed app uses separate browser storage, enter Settings again there. Google pop-ups may need to be allowed; if sign-in fails in standalone mode, open in the regular browser and follow its sign-in prompts. Actual phone OAuth behavior needs a live project to verify.

## Daily use and limits

Select Bottle, Breastfeed, or Pump, enter the time and amount/duration, then Save. Pump amount means the **total expressed volume for that session**, including both sides when Both is selected. Nursing requires duration; other durations are optional. There is no automatic timer. Totals follow each phone’s local calendar day, so phones in different time zones can show different daily totals.

Sign out clears the app session and forms. It does not sign out your entire Google account or revoke consent. “Forget this phone’s settings” removes local setup; it does not delete the sheet. Revoke consent from your Google Account permissions if desired.

Refreshing the current tab restores its unexpired Google session and reconnects the remembered sheet automatically. The access token is stored in sessionStorage for that tab, never in localStorage. Google still requires reconnecting after token expiration; the selected sheet remains remembered. Closing the tab normally ends the session, although browser session restoration may retain it. Sign out and Forget settings remove the saved token.

Saves append rows so both parents do not overwrite each other’s entries. Each entry has a random ID. If a save response is lost, the app does **not** automatically repeat the append: tapping Save again checks for the same ID first. If it still cannot confirm, inspect the sheet before reloading and entering it again. Do not close/reload during an unconfirmed save; there is intentionally no persistent recovery queue. Sheets is not a transactional database and provides no unique-ID constraint, so exactly-once delivery across crashes is not promised.

The app shows the latest 100 valid entries but reads the tab for totals; all data remains in the sheet. For a family-scale log this is simple; a large multi-year log may load more slowly. Keep the header columns intact:

| Column | Meaning |
| --- | --- |
| id | Random entry ID |
| started_at | ISO timestamp stored in UTC |
| kind | bottle, nursing, or pump |
| amount_ml | Numeric volume in mL; blank for nursing |
| duration_minutes | Duration; optional except nursing |
| detail | Milk type for bottles, side for nursing/pumping |
| notes | Literal text (writes use RAW, not formula evaluation) |
| created_at | ISO timestamp stored in UTC |

## Development and verification

Install Node.js 24 or later. No `npm install` is needed.

```sh
npm test
npm start
```

Open `http://127.0.0.1:4173`. Tests cover amounts, input validation, header protection, local-day totals, and duplicate-ID display handling. Deployment runs these tests before publishing. Public source contains no real Google configuration or sample family records.

For updates, change the cache version in `public/sw.js` when changing the shell. Close and reopen the installed app to activate a waiting service worker. No webhooks, Apps Script deployment, token proxy, backend secret, or GitHub Actions Google secret is required.

## Troubleshooting

- **Origin mismatch:** Add the exact site origin to the OAuth Web client; allow time for Google settings to propagate.
- **Picker fails:** Check project number, enabled Picker API, same-project key/client, and HTTP-referrer/API restrictions.
- **403 / access denied:** Use the correct Google account; ensure the account is a test user and an Editor on the sheet; enable all three APIs. Sign out and pick the sheet again to grant file access. Do not broaden to all-spreadsheet scope.
- **Header mismatch:** Preserve the eight headers above; connect a fresh sheet if the selected tab is unrelated.
- **Offline:** The shell can open, but new authorization, reading, and saving require internet. The app does not claim a save succeeded until Google responds successfully.

## Official references

- [Google browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Google Sheets authorization scopes](https://developers.google.com/workspace/sheets/api/scopes)
- [Google Picker overview](https://developers.google.com/workspace/drive/picker/guides/overview)
- [OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies)
- [GitHub Pages workflows and plan availability](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

If port 4173 is in use, set the PORT environment variable for the server and TEST_BASE_URL for browser checks (for example, PORT=4174 and TEST_BASE_URL=http://127.0.0.1:4174).

