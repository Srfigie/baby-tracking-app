# Apps Script setup (recommended connection)

GitHub Pages hosts the PWA. Google Apps Script runs the backend; you authorize it once as the sheet owner. Both phones then use a shared access key without Google sign-in. Keep the sheet's sharing **Restricted**.

This setup can use a free personal Google account. The Sheets API has no additional usage charge. Quota exhaustion causes errors rather than an automatic overage bill. Two phones refreshing every 30 seconds while visible make roughly four read requests per minute, plus saves, well below the Sheets API's published 60 reads per minute per user per project. Quotas are shared with other usage under the script owner and can change. See [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas) and [Sheets API limits and pricing](https://developers.google.com/workspace/sheets/api/limits).

1. Open your existing sheet → **Extensions → Apps Script**. Replace the editor's starter code with [Code.gs](Code.gs) and save.
2. In the editor, click **Services +**, select **Google Sheets API**, and add it (identifier `Sheets`, version v4). For a manually linked Cloud project, also enable Google Sheets API in that project.
3. Generate a cryptographically random key in your browser's developer console:

   ```js
   Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
   ```

   Save the resulting 64-character key in your password manager. Do not commit it to GitHub.

4. Open **Project Settings → Script Properties → Add script property**. Add:

   | Property | Value |
   | --- | --- |
   | `SPREADSHEET_ID` | ID between `/d/` and `/edit` in your sheet's URL |
   | `ACCESS_KEY` | The generated 64-character key |

5. Select **Deploy → New deployment → Web app**. Set **Execute as: Me** and **Who has access: Anyone** (including people not signed into Google). Authorize using the account that can edit your sheet. A Workspace policy may prevent anonymous deployment; this mode requires it.
6. Copy the deployed URL ending in `/exec`, not the editor URL or `/dev` test URL.
7. Deploy the updated app to GitHub Pages using the existing workflow. On each phone, open **Settings**, choose **Apps Script**, and enter the deployment URL and key. Saving settings connects immediately. Each subsequent launch connects automatically; no Google account chooser or sheet picker is needed.
8. Verify a bottle, breastfeed, and pump save on one phone appears on the other after Refresh. Verify editing works. Try a wrong key and confirm no records load. Test in the installed PWA on both actual phones before relying on it.

The script creates `BabyLog` and its headers if missing. Existing eight-column logs are upgraded with the two timer columns only when those columns are unused. Other tabs remain unchanged. Writes use `RAW`, so notes beginning with `=` remain literal text.

## Keys and updates

Anyone who obtains the key can read and edit the log through this endpoint, even without permission on the sheet itself. Keep it private. The key is sent in POST bodies, not URLs, and saved in localStorage on each phone. Only host trusted apps on the same GitHub Pages origin: scripts on that origin can access localStorage. This app does not cache records or backend requests.

To revoke access, replace `ACCESS_KEY` in Script Properties with a newly generated key and update both phones. No redeployment is needed for property changes. **Forget this phone's settings** removes that phone's saved key; it does not revoke a copied key or delete records.

For script code updates, use **Deploy → Manage deployments → Edit → Version: New version → Deploy** to keep the same endpoint. Closing and reopening the PWA activates an updated service worker.

The script serializes its writes, rejects duplicate IDs with different contents, and compares the original row before edits to prevent two phones overwriting each other. Direct edits in Google Sheets do not participate in the script lock; avoid editing the sheet at the same moment as saving in the app. Internet is still required. A timed-out save is ambiguous: press Save again to check the existing entry rather than reloading and reentering it.

## Troubleshooting

- **Could not reach Apps Script:** Check `/exec`, deployment access **Anyone**, owner authorization, and Sheets advanced service. An HTML Google sign-in page instead of JSON indicates deployment access is wrong. Browser requests use `text/plain` POST bodies and follow Google's Content Service redirects; do not change them to JSON content-type or `no-cors`, which prevents reading a confirmed response.
- **Access key rejected:** Match the saved key to the script's `ACCESS_KEY`; key comparison is case-sensitive.
- **Sheet access or headers fail:** Confirm `SPREADSHEET_ID`, the script owner's Editor access, and the expected `BabyLog` columns.
- Google applies Apps Script execution and service quotas. Frequent foreground refreshes on two phones should be verified against your account's limits; this is not an unlimited backend.

References: [Web app deployment](https://developers.google.com/apps-script/guides/web), [advanced services](https://developers.google.com/apps-script/guides/services/advanced), [Content Service redirects](https://developers.google.com/apps-script/guides/content).
