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
- No passwords, credentials, or login data are accessed  
- The extension only uses your existing authenticated Instagram session  

This tool operates fully client-side.

---

## ⚠️ Notes & Limitations

- You must be **logged into Instagram** in Chrome  
- The extension works only when used on an Instagram profile page  
- Excessive unfollow actions may trigger Instagram rate-limits — use responsibly

---

## 🤝 Contributing

Contributions, suggestions, and pull requests are welcome!  
Feel free to open an Issue for bug reports or feature ideas.

---

## 📝 License

MIT License — free to use, modify, and distribute.
