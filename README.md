# Farewell Memories 2022–2026 🎓💊

The official B.Pharmacy Batch 2022–2026 Farewell Memories website, hosted statically on **GitHub Pages**.

---

## 🌐 Live Website

- **URL**: [https://apollofarewell.github.io/Farewell-memories-2022-2026/](https://apollofarewell.github.io/Farewell-memories-2022-2026/)

---

## 🏗️ Architecture

- **Frontend & Data (This Repository)**: Static HTML5, CSS3, and Vanilla JavaScript (`index.html` and `app.js`), loading from `data.json` hosted on GitHub Pages.
- **Media & CDN Storage**: Cloudflare R2 Object Storage (`https://media.errand.ltd`) serving all student portraits, memory photos, and video flashbacks with zero egress fees.
- **Backend (Optional / Archived)**: Originally managed via Node.js/Express backend at [Madhukaran-R/farewell-backend](https://github.com/Madhukaran-R/farewell-backend).

---

## ⚙️ How It Works

- The site loads all batch content (100 students directory, anthem prescription, memories, video flashbacks, and wishes) directly from the static `data.json` file in the repository.
- All media assets (photos, student portraits, and 500MB videos) stream directly from Cloudflare R2 CDN (`https://media.errand.ltd`).
- Runs 100% serverless on GitHub Pages with zero ongoing backend server maintenance or hosting costs.
