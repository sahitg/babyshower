# Baby shower site — setup in two short steps

Everything lives in two places you already own: a **Google Sheet** (guests, RSVPs, wishes, guesses, settings, and the script that emails people) and a **GitHub Pages** site (the pages guests see).

## Step 1 — the Google Sheet + script (≈3 minutes)

1. Open the Google Sheet **"Baby Shower — Guests & RSVPs"** in your Drive (Claude created it; the first tab holds the settings).
2. Menu **Extensions → Apps Script**. Delete the sample code in `Code.gs`, paste the whole contents of `apps-script/Code.gs` from this folder, and click **Save** (the disk icon).
3. In the toolbar, pick **`setup`** in the function dropdown and click **Run**. Google will ask you to authorize:
   *Review permissions → choose your account → Advanced → Go to Untitled project (unsafe) → Allow.* (It's "unsafe" only because you wrote it yourself; it only touches this Sheet and sends mail as you.)
   When it finishes, the Sheet gains tabs (Guests, RSVPs, Wishes, Guesses, Log) and a toast shows your **host key** (also in the Settings tab, row `hostKey`).
4. Click **Deploy → New deployment**. Click the gear next to "Select type" and choose **Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy**, then copy the **Web app URL** (it starts with `https://script.google.com/macros/s/…/exec`).
5. Paste that URL into `config.js` as `appsScriptUrl`. (Already done in this copy of the files.)

> Later code changes: **Deploy → Manage deployments → ✎ (edit) → Version: New version → Deploy.** The URL stays the same.

## Step 2 — the site on GitHub Pages (≈3 minutes)

1. Go to **github.com/new**. Repository name: `baby-shower`. Visibility: **Public** (required for free Pages). Click **Create repository**.
2. On the empty-repo page click **"uploading an existing file"**. Drag in everything from this folder (`index.html`, `host.html`, `config.js`, the `assets` folder, `apps-script`, these docs). Click **Commit changes**.
3. Open **Settings → Pages**. Under *Build and deployment* choose **Source: Deploy from a branch**, Branch **main**, folder **/ (root)**. Save.
4. After a minute or two the page shows your address: `https://sahitg.github.io/baby-shower/`.
5. Open `https://sahitg.github.io/baby-shower/host.html`, sign in with the host key, and check **Settings**: venue, registry, phone and **Site address** (`https://sahitg.github.io/baby-shower/`) should already be filled in; adjust anything and save.

Updating the site later: upload the changed file again on GitHub (it replaces the old one), or start a Claude session connected to the repo and ask for the change. Most things never need that: venue, registry links, contact details, schedule, templates and the photo are all edited from the host dashboard.

## Day-to-day

* **Host dashboard**: `…/host.html` — headcount, dietary summary, who has opened/replied, send invites and reminders, copy links, export CSV, moderate the wishes wall, see the guesses, edit event settings.
* **Add guests**: dashboard → *Add guests* → paste names with emails/phones, one per line. Each guest gets a personal link (`…/?g=xxxx`) that pre-fills their RSVP and lets you see who opened it.
* **Invite by email**: select guests → *Email invites*. Sent from your Gmail with a calendar file attached. Gmail allows about 100 emails per day from scripts; the dashboard shows what's left.
* **Invite by text / WhatsApp**: on your phone, tap *Text* or *WhatsApp* next to a guest; the message and their personal link are pre-filled. Then tap *Mark as invited* so the dashboard knows.
* **Reminders**: filter *Awaiting* → select all → *Email reminders* (skips anyone who has replied).
* **Day before**: filter *Attending* → select all → *Email day-before details* (address, parking, what to wear).
* **You get an email for every RSVP**, with a running total. Guests get a confirmation with the calendar file.
* **The Sheet is the source of truth** — you can edit anything there directly (for example fix a typo in a guest's name). The `hostKey` row in Settings is the dashboard password; change it any time.

## Files

```
index.html          guest site
host.html           host dashboard (host key required)
config.js           defaults + the Apps Script URL
assets/             styles, scripts, fonts (self-hosted), illustration, favicon, og.png
apps-script/Code.gs the backend, pasted into the Sheet's script editor
```
