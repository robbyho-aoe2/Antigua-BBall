# Antigua Pickup: basketball signups

A free, simple signup site for our weekly pickup games. It replaces SignupGenie.

- **Players** open one link from the group chat, type their name and email, and they're in. The first 15 (or whatever cap you set) make the **roster**. Everyone after that goes on the **waitlist**, and moves up automatically when someone drops.
- **Stats:** games played, streaks, "first to sign up" count, badges, and a Regulars leaderboard.
- **You (admin)** create games, copy last week's game in one click, and manage the list. You can also just edit the Google Sheet.

**How it's built:** the website is plain HTML/CSS/JS hosted free on GitHub Pages. The "database" is a Google Sheet, with a small Google Apps Script that acts as the server. No servers to pay for.

```
index.html / admin.html  ──fetch──▶  Apps Script web app  ──▶  Google Sheet (Events + Signups tabs)
   (GitHub Pages)                       (apps-script/Code.gs)
```

---

## Setup (one time, about 15 minutes)

### 1. Create the Google Sheet

1. Go to [sheets.new](https://sheets.new) and name the sheet something like **Pickup Signups**.
2. You don't need to add anything. The script creates the **Events** and **Signups** tabs for you.

### 2. Paste the script

1. In the Sheet, open **Extensions → Apps Script**.
2. Delete everything in `Code.gs`.
3. Open [`apps-script/Code.gs`](apps-script/Code.gs) from this repo, copy **all** of it, and paste it in.
4. Click the 💾 **Save** icon.
5. In the toolbar's function dropdown, choose **`setup`** and click **▶ Run**.
   - Google will ask you to authorize. Click **Review permissions**, choose your account, then **Advanced → Go to (project name) (unsafe) → Allow**. The warning appears because you wrote the script yourself, not Google. That's normal.
   - When it finishes, the Sheet has **Events** and **Signups** tabs, and its timezone is set to Guatemala.

### 3. Set the admin password

1. In the Apps Script editor, click the ⚙️ **Project Settings** gear on the left.
2. Scroll to **Script Properties** and click **Add script property**.
   - **Property:** `ADMIN_PASSWORD`
   - **Value:** a password of your choice
3. Click **Save script properties**.

The password lives only here. It is never in the website code.

### 4. Deploy the script as a web app

1. Click **Deploy → New deployment**.
2. Click the ⚙️ gear next to "Select type" and choose **Web app**.
3. Set:
   - **Description:** anything, e.g. `v1`
   - **Execute as:** **Me**
   - **Who has access:** **Anyone**
4. Click **Deploy** (authorize again if asked).
5. Copy the **Web app URL**. It looks like `https://script.google.com/macros/s/AKfy.../exec`.

To check it works, open that URL in your browser. You should see `{"ok":true,"message":"Pickup signup API is running."}`.

### 5. Put the URL in `config.js`

In this repo, edit [`config.js`](config.js). You can do it right on GitHub: open the file, click the ✏️ pencil, then commit.

```js
API_URL: 'https://script.google.com/macros/s/AKfy.../exec',
```

While you're there, you can also change `SITE_NAME`, `TAGLINE` and `TAGLINE_ES` (the Spanish tagline).

**Gyms (`LOCATIONS`):** the list of places shown in the admin's Location dropdown. The first one is the default for new games. Each gym has a `name`, an `address`, and an optional `mapUrl`. To pin the exact spot, open the gym in Google Maps, tap **Share → Copy link**, and paste that link as `mapUrl`. Otherwise the map link searches for the name and address. If you start playing somewhere new, add another `{ name, address, mapUrl }` entry. For a one-off place, pick **Other…** in the dropdown and type it in.

### 6. Turn on GitHub Pages

1. On GitHub, go to the repo's **Settings → Pages**.
2. Under **Build and deployment**, set **Source: Deploy from a branch**, **Branch: `main`**, folder **`/ (root)`**, and click **Save**.
3. After a minute or two the site is live at `https://<your-username>.github.io/Antigua-BBall/`.
   - Players use: `https://<your-username>.github.io/Antigua-BBall/`
   - You use: `https://<your-username>.github.io/Antigua-BBall/admin.html`

### 7. Create your first game

1. Open `admin.html` and log in with your password.
2. Click **+ New game**, fill it in, and click **Create game**.
3. Click **Copy player link** and paste it in the group chat. The link goes straight to that game (`?event=ID`).

**Every week after that:** open admin and tap **Copy last game +7 days**. That creates a new game at the same time and place, 7 days later. Then copy its link to the chat.

---

### Allow confirmation emails (one time)

After pasting `Code.gs`, choose **`testEmail`** in the function dropdown and click **▶ Run**. Approve sending email (**Advanced → Go to … → Allow**); you'll get a sample confirmation. Do this **before** redeploying.

## Updating the script later (important)

When you change `Code.gs` in the Apps Script editor, **the live site keeps running the old version until you redeploy.** You have two options:

| | How | URL |
|---|---|---|
| ✅ **Update the existing deployment** (use this) | **Deploy → Manage deployments**, click ✏️ **Edit** on your deployment, set **Version: New version**, then **Deploy** | **Stays the same.** Nothing else to change. |
| ⚠️ New deployment | **Deploy → New deployment** | **New URL.** You'd have to update `config.js` again. |

Changes to the website files (HTML/CSS/JS) go live on GitHub Pages automatically after you commit to `main`.

---

## How things work

### For players

- **Sign up:** name and email. The email is only used to let you edit your spot and to track your stats. Other players never see it.
- **One spot per email per game.** Exception: tick **"I'm signing up a family member"** to add one more person (e.g. a parent and their kid) with the same email. That's 2 people max per email.
- **Duplicate names are blocked** in the same game (case doesn't matter). If two Juans show up, the second adds a last initial.
- **Edit name / drop out:** the phone remembers your signup, so you'll see "You're signed up – #7 [Edit name] [Drop out]". On a different phone, use **"Already signed up on another phone?"** and enter your name and email to get your spot back.
- **Confirmation emails:** sent from your Gmail in the player's language (bilingual for players you add in admin):
  - signed up (roster spot, or waitlist position)
  - "A spot opened up, you're in!" when moving up from the waitlist
  - "Moved to the waitlist" if a reorder or a smaller roster size bumps them
  - dropped out, or removed by the organizer
- **Email opt-in:** the first time someone signs up with an email, they choose **"Email me updates about my games"** (on by default). The choice is saved for that email and applies to all games, so they aren't asked again. They can switch it any time with **🔔 / 🔕 Turn on/off** on their "You're signed up" card, or on the **👤 profile card** at the top of the home page (which also shows who the phone is signed up as). You can see or change it in the **EmailPrefs** tab (Notify TRUE/FALSE). To turn all emails off, set `SEND_EMAILS = false` near the top of `Code.gs` and redeploy.
- **Waitlist:** if someone on the roster drops, the first person on the waitlist moves up automatically.
- **Closed signups:** you can still see the roster, and players can still drop out.
- **Past games** disappear from the main page the day after. The direct link still shows the final list.

### Language (English / Español)

- On the first visit, the player page uses the phone's language: Spanish phones get Spanish, everything else gets English.
- The **Español / English** button in the header switches language. The choice is remembered on that phone.
- All player-facing wording lives in [`i18n.js`](i18n.js), so you can tweak the Spanish (or English) there.
- Game **notes** and **location** show exactly as you type them, so write them bilingually if you like (e.g. "Bring a white and a dark shirt / Trae camisa blanca y oscura").
- The admin page stays in English.

### Install as an app

The site can be added to a phone's home screen. It then opens full-screen with its own icon, like a normal app, with no app store and no updates to install.

- **Android (Chrome):** the home page shows an **Install app** button. You can also use the browser menu → **Install app / Add to Home screen**.
- **iPhone (Safari):** tap **Share** (square with an arrow ↑) → **Add to Home Screen**. The home page shows these steps too.
- **Updates:** the app always loads the newest version when online. With no signal, it still opens and shows the last roster it loaded.
- **On iPhone,** the installed app and Safari keep separate memory. If someone signed up in Safari, they can use **"Already signed up on another phone?"** once inside the app to get their spot back.
- **To change the icon:** replace the PNGs in `icons/`. App name and colors are in `manifest.webmanifest`.

### Stats and badges

Stats are tied to your email and count **past games where you made the roster**:

- **Games:** total games played
- **Streak 🔥:** games in a row. Being waitlisted doesn't break a streak; skipping a game does.
- **Best streak:** your longest streak ever
- **First in:** how many times you were the first to sign up
- **Badges:** 🏀 Rookie (1 game), ⭐ Regular (10), 🏅 Veteran (25), 👑 Legend (50), 🔥 On Fire (3 in a row), 💪 Iron Man (10 in a row), 🐦 Early Bird (first to sign up), 🚨 Buzzer Beater (grabbed the last roster spot, e.g. #15 of 15)

The home page also shows a **🏆 Regulars** top-10 leaderboard (names only).

### For you (admin)

- Create, edit, and delete games: date, start time, optional end time, location (dropdown of your gyms, or "Other…"), roster size (default 15), notes, and an open/closed toggle. On the player page, the location links to Google Maps.
- Manage the list: add a name (email optional), edit a name or email, remove someone, and move people up or down with ↑/↓.
- See every player's email and signup time. This is how you help someone who's stuck.
- The password is checked by the server on every admin action. Your browser only remembers it until you close the tab.

### Editing the Google Sheet directly

The Sheet is meant to be readable and editable by hand:

**Events tab**

| ID | Date | Time | Location | Cap | Notes | Open | Created | EndTime |
|---|---|---|---|---|---|---|---|---|
| a1b2c3d4 | 2026-10-14 | 19:00 | Centro Integral Deportivo Ciudad Vieja | 15 | Bring 2 shirts | TRUE | … | 21:00 |

- **Date:** `YYYY-MM-DD`. `M/D/YYYY` also works.
- **Time / EndTime:** 24-hour like `19:00`. `7:00 PM` also works. EndTime is optional; leave it blank if there isn't one.
- **Open:** `TRUE` or `FALSE`. Blank counts as open.
- **ID:** any short unique text, if you add a row by hand.

**Signups tab**

| EventID | Name | Email | SignedUpAt | Order | Token | Lang |
|---|---|---|---|---|---|

- The list is sorted by **Order** (1, 2, 3…). To reorder by hand, change the numbers. Rows with a blank Order go to the end.
- **Token** is the player's private edit key. Leave it alone; it's filled in automatically, even for rows you add by hand.
- To remove someone, delete their row.

---

## Safety notes

- **Simultaneous signups:** Apps Script's `LockService` makes sure two people can't both grab spot 15 at the same instant.
- **Emails:** never sent to other players. Only you see them, in admin and in the Sheet.
- **Inputs:** trimmed and validated. Names are capped at 40 characters, and text is protected against spreadsheet formula injection.
- **Honest limit:** anyone who knows a player's name and email could drop them. That's fine for a group of friends. If it ever becomes a problem, you'll see it in the Sheet.

## Files

| File | What it is |
|---|---|
| `index.html`, `app.js` | Player page |
| `admin.html`, `admin.js` | Admin page |
| `common.js` | Shared helpers (talking to the server, formatting, language) |
| `i18n.js` | All player-facing text in English and Spanish |
| `style.css` | Panza Verde colors: jade green, Antigua arch yellow, terracotta, cream |
| `manifest.webmanifest`, `sw.js`, `icons/` | Make the site installable as a phone app |
| `config.js` | **The one file you edit:** your Apps Script URL and site name |
| `apps-script/Code.gs` | The server code you paste into the Sheet |

### A note on the "CORS" setup

Browsers normally send a "preflight" check before a cross-site JSON request, and Apps Script can't answer it. To avoid that, the site sends its data as plain text (`text/plain`), which skips the preflight, and the script parses it as JSON. You don't need to do anything about this; it's why it works.
