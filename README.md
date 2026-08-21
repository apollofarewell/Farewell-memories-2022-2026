# Farewell Memories 2022–2026 🎓💊

The official B.Pharmacy Batch 2022–2026 Farewell Memories website, hosted statically on **GitHub Pages**.

---

## 🌐 Live Website

- **URL**: [https://apollofarewell.github.io/Farewell-memories-2022-2026/](https://apollofarewell.github.io/Farewell-memories-2022-2026/)

---

## 🏗️ Architecture

- **Frontend (This Repository)**: Static HTML5, CSS3, and Vanilla JavaScript (`index.html` and `app.js`), hosted on GitHub Pages.
- **Backend API & Admin Portal**: Hosted separately on AWS EC2 at [Madhukaran-R/farewell-backend](https://github.com/Madhukaran-R/farewell-backend).
- **Media & CDN Storage**: Cloudflare R2 Object Storage (`https://media.errand.ltd`).

---

## ⚙️ How It Works

- The site fetches all dynamic content (100 students directory, anthem prescription, memories, video flashbacks, and wishes) in real-time from `https://apps.errand.ltd/farewell/api/*`.
- Uploads (photos & up to 500MB videos) stream directly from the user's browser to Cloudflare R2 via presigned URLs.
