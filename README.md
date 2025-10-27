# ⚡ MoveOnJoy On The Fly CDN Scanner

Scan across **fl1 → fl100** CDN nodes of the `moveonjoy.com` domain to find the first working `.m3u8` stream and automatically redirect your player to it.

This project includes a simple API endpoint (`/api/scan`) built for deployment on **Vercel** — no setup required.

---

## 🚀 Deploy Instantly

Click below to deploy your own instance on **Vercel** in one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/dtankdempsey2/moveonjoy-cdn-scanner&project-name=moveonjoy-cdn-scanner&repository-name=moveonjoy-cdn-scanner)

---

## 🌐 How It Works

The `/api/scan` endpoint checks multiple CDN nodes (e.g. `fl1.moveonjoy.com`, `fl2.moveonjoy.com`, …) for the same path and redirects to the first valid `.m3u8` response.

If none are available, it returns a `404`.

### ✅ Example Usage

**Basic Scan**

> https://your-app.vercel.app/api/scan?url=https://fl41.moveonjoy.com/ACC_NETWORK/index.m3u8

**Custom Range**

> https://your-app.vercel.app/api/scan?url=https://fl41.moveonjoy.com/ACC_NETWORK/index.m3u8&min=10&max=50


---

## ⚙️ Query Parameters

| Parameter | Description | Default | Max |
|------------|--------------|----------|-----|
| `url` | The `.m3u8` source URL (must be from `moveonjoy.com`) | *Required* | — |
| `min` | Start of scan range | `1` | — |
| `max` | End of scan range | `100` | `500` |

---

## 📦 Deployment Details

- Runs on **Vercel Serverless Functions**
- Uses `Promise.any()` for fast parallel scanning
- No environment variables required
- Single endpoint: `/api/scan`

**Steps:**
1. Deploy using the button above  
2. Wait for build completion (about 10–15 seconds)  
3. Visit your deployed endpoint (e.g. `https://your-app.vercel.app`)  
4. Test by calling `/api/scan?url=...` with a real stream URL

---

## 🧠 What It Does

1. Validates `url` to ensure it's from `moveonjoy.com`
2. Iterates through CDN node numbers between `min` and `max`
3. Builds test URLs and performs parallel `HEAD` requests
4. Returns a **302 Redirect** to the first successful `.m3u8`
5. Returns **404** if all nodes fail

---
