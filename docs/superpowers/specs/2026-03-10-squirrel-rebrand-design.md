# Squirrel Rebrand — Design Spec

## Summary

Rebrand the Stash PWA to "Squirrel" — a warm, cozy memory bank with a cute squirrel mascot, punny copy, and the same earth-tone palette. Backend stays as-is; only user-facing UI text, icons, and copy change.

## Mascot

"The Gentle Keeper" — a soft-eared squirrel nestled in a tree hollow, cradling an acorn with mitten-like paws. Warm eyes, rosy cheeks, fluffy tail. SVG-based for sharp rendering at any size.

The approved SVG lives in the brainstorm session at `.superpowers/brainstorm/1429-1773168563/gentle-keeper-v6.html`. It will be extracted and used for:
- App icon (icon-192.png, icon-512.png) — rendered from SVG
- Empty state illustration in the app
- Login/signup screen

## Copy Changes

| Location | Old | New |
|----------|-----|-----|
| App title (h1, meta, manifest) | Stash | Squirrel |
| Tagline / subtitle | your personal memory bank | squirrel away your thoughts |
| Main action button | Stash | Stash it |
| Input placeholder | (varies) | Something worth squirreling away? |
| Empty state | Your stash is empty | Your nest is empty — squirrel something away! |
| Loading message | opening your stash… | Gathering your nuts... |
| Notification title | Stash Reminder | Squirrel Reminder |
| Export filename | stash-backup-*.json | squirrel-backup-*.json |
| Selection export | stash-selection-*.json | squirrel-selection-*.json |
| Full backup | stash-full-backup-*.json | squirrel-full-backup-*.json |
| Backup parse error | ...a Stash backup (.json) | ...a Squirrel backup (.json) |
| Invalid backup | ...a valid Stash backup file | ...a valid Squirrel backup file |
| PWA install prompt | Install Stash | Install Squirrel |
| Noscript fallback | Stash requires JavaScript | Squirrel requires JavaScript to run. |
| Photo alt text | Stashed image | Squirreled image |
| Upload hint | photos, screenshots, business cards — all welcome | photos, screenshots, business cards — all welcome |
| Contact hint | Scan a business card or add contact info | Scan a business card or add contact info |
| Work hint | Stash meeting notes... | Squirrel away meeting notes... |
| Couldn't load | Couldn't load your stashes | Couldn't load your stash |
| Delete account | ...delete your account and all your stashes | ...delete your account and all your saved items |
| Digest description | sends you a summary email of your recent stashes | sends you a summary of your recent saves |
| Download backup | Download a backup of all your stashes | Download a backup of all your saved items |

## File Changes

### Frontend (stash repo) — all changes

**index.html:**
- `<title>` → Squirrel
- `apple-mobile-web-app-title` → Squirrel
- `<meta name="description">` → Squirrel away your thoughts
- `<noscript>` fallback text

**manifest.json:**
- `name` → Squirrel — Squirrel Away Your Thoughts
- `short_name` → Squirrel
- `description` → Squirrel away your thoughts

**app.jsx → app.js (rebuild required):**
- All user-facing strings per the copy table above
- Component names stay as-is (StashCard, Stash) — internal, not user-facing
- localStorage keys stay as-is (stash-token, stash-settings, etc.) — changing would log out existing users

**Icon files:**
- icon-192.png — replace with squirrel mascot
- icon-512.png — replace with squirrel mascot

**boot.js:**
- Comment update only (internal)

### Backend (stash-server repo) — minimal changes

**utils/email.js:**
- Email subjects: "Your Squirrel verification code", "Your Squirrel password reset code"

**server.js:**
- Console startup banner: "Squirrel Server Running"

**No changes to:**
- API routes (`/api/stashes` stays)
- Database tables (`stashes` stays)
- Cookie names (`stash-token` stays)
- Route files, middleware, tests

## Color Palette

No changes. Current warm earth tones (#FAF7F2 cream, browns, etc.) match the squirrel theme perfectly.

## What Does NOT Change

- All backend API routes and database schema
- localStorage key names (would break existing sessions)
- Cookie names (would break auth)
- Internal component/function names
- Category names (food, work, travel, etc.)
- Business card OCR flow
- Any functional behavior

## Risk

Low. This is a cosmetic rebrand — no logic changes, no API changes, no database migration. The only risk is a missed string replacement showing "Stash" somewhere, which can be caught by grep.
