# Submission receiver: setup

`Code.gs` is the Google Apps Script that receives submissions from the site's Contribute form (`#/submit`).
It appends one row per cultivar to a private Google Sheet, saves photos to Google Drive and emails the owner.
Design: `notes/submission-form-plan.md`.

## One-time setup (about 10 minutes)

Use the Google account that should own the submissions. The Sheet and the photos live in that account.

1. **Create the Sheet.** Go to <https://sheets.new>, name it `AV Submissions`. Keep it private (share it only with
   reviewers, as Editor). Contact details of contributors will be in it.
2. **Open the script editor.** In the Sheet: Extensions > Apps Script. Delete the sample code, paste the whole of
   `apps_script/Code.gs`, and click Save (name the project `AV Submission Receiver`).
3. **Build the Inbox tab.** In the editor's toolbar there is a dropdown to the right of **Debug**. It shows the
   name of one function (at first often `doGet`, or "Select function"). **Open that dropdown and choose
   `setupSheet`**, then click **Run** (the button just left of Debug). Choosing the function does not run it;
   clicking Run does. A function other than `setupSheet` will not build the Inbox.
   The first time, Google asks you to authorize: Review permissions > choose your account > Advanced >
   "Go to AV Submission Receiver (unsafe)" > Allow. (The warning appears because the script is yours and is not
   verified by Google. It asks for access to this Sheet, to create the photo folder in your Drive, and to send
   you email.) Run `setupSheet` again after authorizing if the first click only showed the permission dialog.
   Watch the "Execution log" at the bottom: it should end with "Execution completed". Then switch to the Sheet:
   it has an `Inbox` tab (header row, decision dropdowns, colors) and a `Help` tab. If a message lists optional
   formatting steps that failed, the Inbox still works.
4. **Deploy as a web app.** Top right of the editor: Deploy > New deployment. Next to "Select type" click the gear
   icon and choose Web app.
   - Description: `v1`
   - Execute as: **Me**
   - Who has access: **Anyone** (contributors do not sign in)
   - Click Deploy (authorize again if asked) and copy the **Web app URL** (ends in `/exec`; the other link shown,
     ending in `/dev`, is for testing and is not the one to use).
5. **Check it is running.** Open the URL in a browser. You should see
   `{"ok":true,"service":"Saintpaulia Ancestry submission receiver","version":1}`.
6. **Connect the site.** In `site/submit.js` set `const SUBMIT_URL = "<the URL>";` (the Send button then appears
   on the form). The URL is not a secret: anyone can see it in the page source. The receiver limits what it
   accepts (see below), and nothing reaches the database without your review.
7. **Test.** Open the site locally (`python scripts/serve.py`), go to Contribute, fill in a test cultivar
   (use your own name, tick the agreement) and press Send. A row should appear in the Inbox within seconds and
   you get an email. Delete the test row afterwards.

## Changing the script later

Edit the code in the editor, then Deploy > Manage deployments > pencil icon > Version: **New version** > Deploy.
The URL stays the same. (If you instead choose "New deployment" you get a new URL and must update `SUBMIT_URL`.)
Keep `COLUMNS` in `Code.gs` identical to `SHEET_COLUMNS` in `scripts/submissions_lib.py`.

## What the receiver accepts

- Up to 100 cultivars and 40 photos per submission; photos must be JPEG (the form converts and shrinks them to
  1600 px), at most 4 MB each and 20 MB in total.
- Up to 300 new rows per day in total. Past that it asks people to try again tomorrow or email the file.
- Every row needs a name, the contributor's name and the license box; duplicate names in one submission are refused.
- A hidden form field catches simple bots. Text is stored as plain text (never as a formula) and capped at
  5,000 characters per cell.
- Sending the same submission again refreshes rows that have no decision yet and leaves rows you have decided on.

## Where things are

- Rows: Sheet > `Inbox`. Review instructions: Sheet > `Help`.
- Photos: Drive > `AV Submissions photos` > one folder per submission id.
- Neither is in this repository. Raw exports go in `submissions/inbox/` (git-ignored).

## If the form says it could not reach the receiver

The form still offers "Download a copy (.csv)": contributors can email that file instead. Check that the
deployment's access is "Anyone", that `SUBMIT_URL` ends in `/exec`, and look at Executions in the script editor
for errors.
