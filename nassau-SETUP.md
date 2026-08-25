# Nassau Golf App — Setup Guide
## From zero to on your iPhone home screen

---

## What You're Building

```
Your iPhone
    ↓ opens
GitHub Pages (free hosting)
    ↓ AI photo feature calls
Cloudflare Worker (free, secure proxy)
    ↓ forwards with your secret key to
Anthropic API (reads scorecard photos)
```

**Time required:** ~30 minutes  
**Cost:** Free forever (Anthropic charges ~$0.01 per round of scorecard photos)

---

## STEP 1 — Get Your Anthropic API Key

1. Go to **console.anthropic.com**
2. Sign in or create a free account
3. Add a credit card (pay-as-you-go, no subscription)
4. Click **API Keys** in the left sidebar
5. Click **Create Key**
6. Name it `nassau-golf`
7. **Copy the key and save it somewhere safe** — you'll only see it once
   - It looks like: `sk-ant-api03-...`

> Anthropic gives $5 free credit on signup — enough for hundreds of rounds.

---

## STEP 2 — Set Up the Cloudflare Worker

The Worker is a tiny script that sits securely between your app and Anthropic.
Your API key lives here, never in the HTML file.

### 2a. Create a Cloudflare Account

1. Go to **dash.cloudflare.com**
2. Sign up for a free account (no credit card needed)
3. Verify your email

### 2b. Create the Worker

1. In the Cloudflare dashboard, click **Workers & Pages** in the left sidebar
2. Click **Create** → **Create Worker**
3. Give it a name: `nassau-proxy`
4. Click **Deploy** (ignore the default code for now)

### 2c. Paste the Worker Code

1. Click **Edit Code**
2. **Select all** the existing code and **delete it**
3. Open the file `nassau-worker.js` from this folder
4. **Copy everything** and paste it into the Cloudflare editor
5. Click **Save and Deploy**

> **Updating the Worker later?** This update *changes the request contract*
> between the app and the Worker (the app now sends just the photo and lets
> the Worker build the AI request). Paste the new `nassau-worker.js` into
> Cloudflare and **Save and Deploy** *before* using Photo mode on the
> updated page, or photo uploads will fail against the old Worker.

### 2d. Add Your API Key as a Secret

1. Go back to your Worker's main page
2. Click **Settings** tab
3. Click **Variables and Secrets**
4. Under **Secrets**, click **Add**
5. Set:
   - **Variable name:** `ANTHROPIC_API_KEY`
   - **Value:** paste your key from Step 1
6. Click **Deploy**

### 2e. Copy Your Worker URL

1. At the top of the Worker page you'll see a URL like:
   `https://nassau-proxy.YOUR-NAME.workers.dev`
2. **Copy this URL** — you need it in the next step

### 2f. Set a Monthly Spend Limit (do this — it's your real backstop)

The Worker only accepts requests from your GitHub Pages site, but any
belt-and-suspenders setup should still cap what a mistake or an abuse
attempt could cost you:

1. Go to **console.anthropic.com**
2. Click **Billing** in the left sidebar → **Limits**
3. Set a monthly spend limit — a few dollars is plenty for a golf group's
   worth of scorecard photos

---

## STEP 3 — Set Up GitHub Pages

GitHub Pages hosts your HTML file for free with a permanent public URL.

### 3a. Create a GitHub Account

1. Go to **github.com**
2. Sign up for a free account if you don't have one

### 3b. Create a Repository

1. Click the **+** icon (top right) → **New repository**
2. Name it: `nassau-golf`
3. Set to **Public**
4. Check **Add a README file**
5. Click **Create repository**

### 3c. Add Your Worker URL to nassau-index.html

The app itself lives in `nassau-index.html`; `index.html` is just an
11-line redirect to it (so a bare GitHub Pages URL still lands on the app).
Before uploading, paste your Worker URL into the real app file:

1. Open `nassau-index.html` in a text editor (TextEdit on Mac works)
2. Find this line near the top of the `<script>` section:
   ```
   const WORKER_URL = 'https://nassau-proxy.devin-p-fitzpatrick.workers.dev';
   ```
   (It's already filled in for this deployment — only change it if you set
   up your own Worker under a different name.)
3. Replace the URL with your actual Worker URL from Step 2e if needed:
   ```
   const WORKER_URL = 'https://nassau-proxy.YOUR-NAME.workers.dev';
   ```
4. Save the file

### 3d. Upload Your Files

1. In your GitHub repository, click **Add file** → **Upload files**
2. Drag and drop **both** `index.html` and `nassau-index.html` into the
   upload area (uploading only one leaves the redirect pointing at a page
   that isn't there, or leaves the app itself missing)
3. Scroll down and click **Commit changes**

### 3e. Enable GitHub Pages

1. Click **Settings** tab in your repository
2. Click **Pages** in the left sidebar
3. Under **Source**, select **Deploy from a branch**
4. Under **Branch**, select **main** and keep `/ (root)`
5. Click **Save**
6. Wait 2–3 minutes, then refresh the page
7. You'll see: **Your site is live at** `https://YOUR-USERNAME.github.io/nassau-golf`
8. **Copy this URL**

---

## STEP 4 — Add to Your iPhone Home Screen

This makes the app feel exactly like a native app — its own icon, no browser chrome.

1. On your iPhone, open **Safari** (must be Safari, not Chrome)
2. Go to your GitHub Pages URL:
   `https://YOUR-USERNAME.github.io/nassau-golf`
3. Tap the **Share** button (box with arrow pointing up)
4. Scroll down and tap **Add to Home Screen**
5. Name it `Nassau`
6. Tap **Add**

The app now appears on your home screen with its own icon.
Tap it and it opens full-screen, just like a native app.

---

## STEP 5 — Test It

### Test manual entry (no API needed):
1. Open the app from your home screen
2. Select a course and format
3. Tap **Manual** entry mode
4. Hit **Start Round** and enter a few scores
5. Confirm Nassau calculations look right

### Test photo upload:
1. Go back to setup, select **Photo** mode
2. Tap **Upload Scorecards**
3. Photograph an old scorecard
4. Watch the AI read it — should take 10–15 seconds
5. Review the extracted scores and correct any errors
6. Assign players to teams and confirm results

---

## Updating the App in the Future

When there's a new version of `nassau-index.html`:

1. Go to your GitHub repository
2. Click on `nassau-index.html`
3. Click the **pencil icon** (Edit)
4. Select all and replace with new content
   *(or use the upload method from Step 3d)*
5. Commit changes
6. GitHub Pages updates automatically in ~2 minutes

---

## Troubleshooting

**AI photo reading not working?**
- Check that your Worker URL in `nassau-index.html` is correct (no trailing slash)
- Each scorecard now shows its own status inline — a failed card shows the
  actual error message (not just a generic "read error"), and has a ↻ retry
  and a × delete button right on the card. Retry the specific card before
  assuming anything else is wrong.
- If you just pasted an updated `nassau-worker.js` into Cloudflare, confirm
  you clicked **Save and Deploy** — old Worker code will reject the new
  app's requests
- Verify your Anthropic API key is saved correctly in Cloudflare Secrets

**Page not loading on GitHub?**
- Wait 5 minutes after enabling Pages — first deploy takes a moment
- Make sure you selected `main` branch in Pages settings
- Confirm `index.html` is at the root of the repository (not in a subfolder)

**App not opening full-screen?**
- Must be added to home screen via Safari, not Chrome
- Delete and re-add if needed

**Scores not calculating?**
- Make sure each team has at least one player assigned
- The app now warns you before settling if any holes are missing scores or
  a team is short-handed for the format — "Settle anyway?" — so a blank
  hole can't silently hand the money to someone. Fill in what's missing,
  or confirm you mean to leave it undecided.

---

## File Summary

| File | Purpose | Where it goes |
|------|---------|---------------|
| `nassau-index.html` | The app itself | GitHub repository root |
| `index.html` | 11-line redirect to `nassau-index.html` | GitHub repository root |
| `nassau-worker.js` | Secure, closed API proxy | Cloudflare Workers |
| `nassau-SETUP.md` | This guide | Keep locally for reference |

---

## Support

Built for Fair Oaks Ranch Nassau games.  
Questions or bugs → open `nassau-index.html` and make adjustments,
or ask Claude to help you modify specific features.
