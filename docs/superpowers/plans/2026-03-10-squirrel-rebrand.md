# Squirrel Rebrand Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the Stash PWA to "Squirrel" — update all user-facing text, icons, and copy while keeping the backend API routes and database unchanged.

**Architecture:** Frontend-only rebrand of app.jsx, index.html, manifest.json, and icon assets. Two email subjects change in stash-server. No database changes, no API changes.

**Tech Stack:** React (CDN), HTML, SVG, Node.js (backend email only)

**Spec:** `docs/superpowers/specs/2026-03-10-squirrel-rebrand-design.md`

---

## Chunk 1: Static Files (index.html, manifest.json, boot.js, icons)

### Task 1: Update manifest.json

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: Update manifest fields**

```json
{
  "name": "Squirrel — Squirrel Away Your Thoughts",
  "short_name": "Squirrel",
  "description": "Squirrel away your thoughts",
  "start_url": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#FAF7F2",
  "theme_color": "#6B5F53",
  "icons": [
    {
      "src": "./icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "./icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add manifest.json
git commit -m "rebrand: update manifest.json to Squirrel"
```

### Task 2: Update index.html

**Files:**
- Modify: `index.html:10,11,12,44`

- [ ] **Step 1: Update meta tags and title**

Line 10: Change `content="Stash"` → `content="Squirrel"`
Line 11: Change `content="Capture and organize the things worth holding on to"` → `content="Squirrel away your thoughts"`
Line 12: Change `<title>Stash</title>` → `<title>Squirrel</title>`
Line 44: Change `Stash requires JavaScript to run.` → `Squirrel requires JavaScript to run.`

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "rebrand: update index.html meta tags to Squirrel"
```

### Task 3: Update boot.js comment

**Files:**
- Modify: `boot.js:4`

- [ ] **Step 1: Update comment**

Line 4: Change `The artifact version of Stash uses` → `The artifact version of Squirrel uses`

- [ ] **Step 2: Commit**

```bash
git add boot.js
git commit -m "rebrand: update boot.js comment to Squirrel"
```

### Task 4: Create squirrel mascot SVG and generate icon PNGs

**Files:**
- Create: `squirrel.svg` (mascot SVG extracted from brainstorm session)
- Modify: `icon-192.png` (replace with squirrel)
- Modify: `icon-512.png` (replace with squirrel)

- [ ] **Step 1: Create squirrel.svg**

Extract the approved "Gentle Keeper v6" SVG from `.superpowers/brainstorm/1429-1773168563/gentle-keeper-v6.html` into a standalone `squirrel.svg` file. Add a solid `#FAF7F2` background circle for the icon versions.

- [ ] **Step 2: Generate icon PNGs**

Use a tool or browser to render the SVG at 192x192 and 512x512 pixels, save as `icon-192.png` and `icon-512.png`, replacing the old files.

- [ ] **Step 3: Commit**

```bash
git add squirrel.svg icon-192.png icon-512.png
git commit -m "rebrand: add squirrel mascot SVG and icon PNGs"
```

---

## Chunk 2: app.jsx User-Facing String Changes

### Task 5: Update app titles and taglines

**Files:**
- Modify: `app.jsx:2866,3045,3052,4560`

- [ ] **Step 1: Update h1 headings**

Line 2866: Change `}}>Stash</h1>` → `}}>Squirrel</h1>`
Line 3045: Change `}}>Stash</h1>` → `}}>Squirrel</h1>`
Line 4560: Change `}}>Stash</h1>` → `}}>Squirrel</h1>`

- [ ] **Step 2: Update tagline**

Line 3052: Change `}}>your personal memory bank</p>` → `}}>squirrel away your thoughts</p>`

- [ ] **Step 3: Commit**

```bash
git add app.jsx
git commit -m "rebrand: update app titles and tagline to Squirrel"
```

### Task 6: Update action button and placeholder copy

**Files:**
- Modify: `app.jsx:4672`

- [ ] **Step 1: Update main action button**

Line 4672: Change `>Stash</button>` → `>Stash it</button>`

- [ ] **Step 2: Update input placeholder (if exists)**

Search for the text input placeholder near the action button and update to: `Something worth squirreling away?`

- [ ] **Step 3: Commit**

```bash
git add app.jsx
git commit -m "rebrand: update action button and placeholder copy"
```

### Task 7: Update empty state, loading, and notifications

**Files:**
- Modify: `app.jsx:2686,4087,4228`

- [ ] **Step 1: Update empty state**

Line 2686: Change `}}>Your stash is empty</p>` → `}}>Your nest is empty — squirrel something away!</p>`

- [ ] **Step 2: Update loading message**

Line 4228: Change `opening your stash…` → `Gathering your nuts...`

- [ ] **Step 3: Update notification title**

Line 4087: Change `new Notification("Stash Reminder",` → `new Notification("Squirrel Reminder",`

- [ ] **Step 4: Commit**

```bash
git add app.jsx
git commit -m "rebrand: update empty state, loading, and notification copy"
```

### Task 8: Update export filenames

**Files:**
- Modify: `app.jsx:519,543,3892`

- [ ] **Step 1: Update backup filenames**

Line 519: Change `stash-backup-` → `squirrel-backup-`
Line 543: Change `stash-full-backup-` → `squirrel-full-backup-`
Line 3892: Change `stash-selection-` → `squirrel-selection-`

- [ ] **Step 2: Commit**

```bash
git add app.jsx
git commit -m "rebrand: update export filenames to squirrel-*"
```

### Task 9: Update alerts, error messages, and misc copy

**Files:**
- Modify: `app.jsx:1095,1112,1243,1308,1441,1956,4373,5193,5553`

- [ ] **Step 1: Update settings copy**

Line 1095: Change `sends you a summary email of your recent stashes` → `sends you a summary of your recent saves`
Line 1112: Change `Get a summary of your recent stashes by email` → `Get a summary of your recent saves by email`
Line 1243: Change `Download a backup of all your stashes` → `Download a backup of all your saved items`

- [ ] **Step 2: Update alert messages**

Line 1308: Change `Make sure it's a Stash backup (.json).` → `Make sure it's a Squirrel backup (.json).`
Line 4373: Change `a valid Stash backup file` → `a valid Squirrel backup file`

- [ ] **Step 3: Update account deletion text**

Line 1441: Change `delete your account and all your stashes` → `delete your account and all your saved items`

- [ ] **Step 4: Update photo alt text**

Line 1956: Change `"Stashed image"` → `"Squirreled image"`

- [ ] **Step 5: Update hint text**

Line 5193: Change `"Stash meeting notes, deadlines, or project ideas"` → `"Squirrel away meeting notes, deadlines, or project ideas"`

- [ ] **Step 6: Update install prompt**

Line 5553: Change `Install Stash` → `Install Squirrel`

- [ ] **Step 7: Commit**

```bash
git add app.jsx
git commit -m "rebrand: update alerts, hints, and misc copy to Squirrel"
```

### Task 10: Update error message

**Files:**
- Modify: `app.jsx:3296`

- [ ] **Step 1: Update load error**

Line 3296: Change `couldn't load your stashes` → `couldn't load your stash`

- [ ] **Step 2: Commit**

```bash
git add app.jsx
git commit -m "rebrand: update error message copy"
```

---

## Chunk 3: Build, Backend, and Verification

### Task 11: Rebuild app.js from app.jsx

**Files:**
- Modify: `app.js` (generated from app.jsx)

- [ ] **Step 1: Run the build**

```bash
npm run build
```

- [ ] **Step 2: Verify the build succeeded**

Open `app.js` and spot-check that "Squirrel" appears and old "Stash" user-facing strings are gone.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "rebrand: rebuild app.js with Squirrel branding"
```

### Task 12: Update backend email subjects

**Files:**
- Modify: `stash-server/utils/email.js:41,63`

- [ ] **Step 1: Update email subjects**

Line 41: Change `"Your Stash verification code"` → `"Your Squirrel verification code"`
Line 63: Change `"Your Stash password reset code"` → `"Your Squirrel password reset code"`

- [ ] **Step 2: Commit**

```bash
cd stash-server
git add utils/email.js
git commit -m "rebrand: update email subjects to Squirrel"
```

### Task 13: Verify no remaining user-facing "Stash" references

- [ ] **Step 1: Grep for remaining "Stash" in user-facing strings**

```bash
cd ../stash
grep -n "Stash" app.jsx | grep -v "//\|StashCard\|mapServerStash\|stash-token\|stash-logged\|stash-items\|stash-settings\|localStorage\|stashes\|window.storage"
```

Any remaining hits should be internal code (component names, variable names, comments about architecture) — not user-facing. If any user-facing strings remain, fix them.

- [ ] **Step 2: Verify in browser**

Open the app locally and check:
- Page title says "Squirrel"
- Login screen shows "Squirrel" and "squirrel away your thoughts"
- Action button says "Stash it"
- Empty state says "Your nest is empty..."
- PWA install prompt says "Install Squirrel"

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "rebrand: fix any remaining Stash references"
```
