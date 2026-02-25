# Stash PWA — Deployment Guide

## What's in this folder

```
stash-pwa/
├── index.html      ← The full app (HTML + React + all features)
├── manifest.json   ← PWA metadata (name, icon, colors)
├── sw.js           ← Service worker (enables offline mode)
├── icon-192.png    ← App icon (small)
├── icon-512.png    ← App icon (large)
└── DEPLOY.md       ← This file
```

## Deploying to Netlify (Free — recommended)

**Option A: Drag and drop (easiest)**

1. Go to [app.netlify.com](https://app.netlify.com)
2. Sign up or log in (GitHub, GitLab, or email)
3. From the dashboard, find "Deploy manually" or drag the `stash-pwa` folder onto the deploy area
4. Netlify gives you a URL like `amazing-stash-123.netlify.app`
5. Done! HTTPS is automatic.

**Option B: Via GitHub (auto-deploys on changes)**

1. Create a GitHub repository
2. Push all the files from `stash-pwa/` to the root of the repo
3. In Netlify, click "New site from Git" → connect your GitHub repo
4. Set publish directory to `/` (root)
5. Click Deploy
6. Every push to GitHub now auto-deploys

## Deploying to Vercel (Free)

1. Go to [vercel.com](https://vercel.com) and sign up
2. Install Vercel CLI: `npm install -g vercel`
3. In your terminal, navigate to the `stash-pwa` folder
4. Run `vercel`
5. Follow the prompts — it'll deploy and give you a URL
6. HTTPS is automatic

## Deploying to GitHub Pages (Free)

1. Create a GitHub repo named `stash` (or anything)
2. Push all files to the `main` branch
3. Go to repo Settings → Pages → Source: "Deploy from branch" → `main` → `/` (root)
4. Your app will be at `yourusername.github.io/stash`
5. Note: You may need to update `start_url` in manifest.json to `/stash/` if using a subpath

## Custom Domain (Optional)

All three hosting options above support custom domains:
- Buy a domain from Namecheap, Google Domains, Cloudflare, etc. (~$10-15/year)
- In your hosting dashboard, add the custom domain
- Update DNS records as instructed
- HTTPS certificate is provided free automatically

## Testing the PWA

After deploying, verify everything works:

1. **Open in Chrome** → DevTools → Application tab → check "Manifest" and "Service Workers"
2. **Lighthouse audit** → DevTools → Lighthouse → check "Progressive Web App"
3. **Install test** → On mobile, open the URL → you should see an install prompt (Android) or use Share → "Add to Home Screen" (iOS)
4. **Offline test** → Install the app → turn on airplane mode → open the app → it should still work

## How Data is Stored

The PWA version uses **localStorage** (your browser's built-in storage) instead of the artifact storage API. This means:

- Data persists between visits on the same device/browser
- Data does NOT sync across devices (that's Phase 2)
- Clearing browser data will erase your stashes
- Use the Export feature regularly to back up!

## Updating the App

When you make changes to index.html:

1. Re-deploy (push to GitHub or re-drag to Netlify)
2. Update the `CACHE_NAME` in `sw.js` (e.g., change `stash-v1` to `stash-v2`)
3. This tells the service worker to clear old caches and download fresh files
4. Users will get the update on their next visit
