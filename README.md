# 📌 Instagram Following Inspector
### A simple Chrome extension to analyze who you follow and who doesn’t follow you back

Instagram does not provide an easy way to compare your *following* and *followers* lists or see who no longer follows you.  
This extension was created to fill that gap by offering a fast, local, transparent tool that runs directly in your browser.

---

## 🚀 Features

- Automatically fetches your full list of:
  - **Following**
  - **Followers**
- Identifies users who **don’t follow you back**
- Displays results ordered from most recent to oldest
- Each username links directly to its Instagram profile
- Includes a **one-click Unfollow** button next to each user
- Everything runs **locally in your browser** — no external servers, no tracking

---

## 🔧 Installation (Developer Mode)

1. Clone or download this repository:
   ```bash
   git clone https://github.com/<your-username>/<repo-name>.git
   ```
2. Open Chrome and go to:
   ```
   chrome://extensions/
   ```
3. Enable **Developer Mode** (top right)
4. Click **Load unpacked**
5. Select the folder containing `manifest.json`

The extension will appear in your Chrome toolbar immediately.

After updating the source files, click **Reload** for the extension on
`chrome://extensions/`, then reload the Instagram tab before testing again.

---

## 📖 Usage

1. Open **Instagram** in Chrome  
2. Navigate to **your profile page**, e.g.:
   ```
   https://www.instagram.com/<your-username>/
   ```
3. Click the extension’s icon in the toolbar  
4. The extension will:
   - Fetch your following list  
   - Fetch your followers list  
   - Compare them  
   - Calculate who doesn’t follow you back  
   - Open a **results page** automatically

### On the results page you can:

- Open any profile in a new tab  
- See when (relative order) you followed each user  
- Perform **instant unfollow actions** with a single click  

---

## 🔐 Privacy & Security

- No data is ever sent to external servers  
- Nothing is stored outside your local browser  
- No passwords are read. Requests use your existing Instagram session and its
  request tokens, read locally from the open Instagram page.
- Request tokens are not stored or printed in request diagnostics. Original
  response bodies are logged as received and may contain session data.

This tool operates fully client-side.

---

## ⚠️ Notes & Limitations

- You must be **logged into Instagram** in Chrome  
- The extension works only when used on an Instagram profile page  
- The profile ID is read from embedded page data when the username matches.
  If no matching ID is available, the extension falls back to `web_profile_info`.
  An HTTP 429 on that request stops the analysis with a short message.
- Excessive unfollow actions may trigger Instagram rate-limits — use responsibly
- An unfollow is confirmed only when Instagram returns HTTP success and JSON with
  `status: "ok"` and `friendship_status.following: false`. The status panel logs
  the original response body, HTTP status, content type, final URL, and redirects.
- Before each unfollow, the extension reads `fb_dtsg`, computes `jazoest` with
  Instagram's own token utility, and gets `container_module` and `nav_chain`
  from the current page navigation. Instagram's header builder supplies the
  current CSRF token, app ID, revision, claim, ASBD ID, and web session ID.
  The `scripting` permission allows this local read in the Instagram page's
  JavaScript context. If required values are unavailable, no POST is sent and
  the log identifies the missing field or module. These internal modules may
  change when Instagram updates its site.
- Unfollows run one at a time, with an eight-second pause after a confirmed
  response before dispatching the next item (in addition to the request delay).
  The queue stops on the first failure or unconfirmed response. A request that
  takes more than 15 seconds times out; check the profile before retrying it.
  While a queue is active, new single or bulk requests cannot replace it.

---

## Local checks

Run the regression tests with Node.js (no dependencies required):

```bash
node --test tests/*.test.cjs
```

The tests use simulated page data and network responses; they do not contact Instagram.

---

## 🤝 Contributing

Contributions, suggestions, and pull requests are welcome!  
Feel free to open an Issue for bug reports or feature ideas.

---

## 📝 License

MIT License — free to use, modify, and distribute.
