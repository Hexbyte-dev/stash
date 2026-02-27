# Auth + Email Digest System Design

## Overview

Add user accounts and email digests to Stash. Users can optionally sign up to sync stashes across devices and receive daily/weekly email summaries of what they stashed.

## Decisions

- **Auth method:** Email + password
- **Database:** PostgreSQL on Railway (same project as existing server)
- **Session:** JWT tokens, 7-day expiration
- **Login requirement:** Optional — app works without account (localStorage), login unlocks sync + email
- **Local data on signup:** Merge existing localStorage stashes into account automatically
- **Email service:** Resend (free tier: 100/day, 3000/month)
- **Email digest options:** Daily (7 AM user timezone) and/or Weekly (Sunday 9 AM user timezone)
- **Email content:** Summary of stashes in that time window, grouped by category
- **Architecture:** Everything added to the existing Express server on Railway (Approach 1)

## Database Schema

### users table

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID (PK) | Unique user ID, auto-generated |
| email | text (unique) | Login email |
| password_hash | text | bcrypt-hashed password |
| timezone | text | User timezone for digest scheduling |
| digest_preference | text | "none", "daily", "weekly", or "both" |
| created_at | timestamp | Signup time |

### stashes table

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID (PK) | Unique stash ID |
| user_id | UUID (FK -> users.id) | Owner |
| content | text | Stash text |
| type | text | Category (note, link, recommended, etc.) |
| tags | text[] | Array of tags |
| image | text | Base64 image data (nullable) |
| ocr_data | jsonb | Extracted business card data (nullable) |
| pinned | boolean | Is it pinned |
| completed | boolean | Is it checked off |
| completed_at | timestamp | When completed (nullable) |
| created_at | timestamp | When stashed |

## API Endpoints

### Auth
| Endpoint | Method | Purpose |
|----------|--------|---------|
| /api/auth/signup | POST | Create account, return JWT |
| /api/auth/login | POST | Verify credentials, return JWT |
| /api/auth/me | GET | Validate token, return user info |

### Stashes (requires auth)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| /api/stashes | GET | Fetch all stashes for logged-in user |
| /api/stashes | POST | Save a new stash |
| /api/stashes/bulk | POST | Import multiple stashes (localStorage merge) |
| /api/stashes/:id | PUT | Update a stash (edit, complete, pin) |
| /api/stashes/:id | DELETE | Delete a stash |

### Settings (requires auth)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| /api/settings | GET | Get user settings |
| /api/settings | PUT | Update settings (digest pref, timezone, etc.) |

### Existing
| Endpoint | Method | Purpose |
|----------|--------|---------|
| /health | GET | Health check (unchanged) |
| /api/ocr | POST | Business card OCR (unchanged) |

## Auth Flow

### Signup
1. User enters email + password in frontend modal
2. POST /api/auth/signup
3. Server checks email not taken
4. Server hashes password with bcrypt
5. Server creates user row in Postgres
6. Server creates JWT token (7-day expiry) containing user ID
7. Frontend stores token in localStorage
8. Frontend sends any existing localStorage stashes to POST /api/stashes/bulk
9. Frontend clears localStorage stash data, switches to server mode

### Login
1. User enters email + password
2. POST /api/auth/login
3. Server finds user by email, runs bcrypt.compare()
4. Match -> return JWT. No match -> error

### Session persistence
- Token stored in localStorage under key like "stash-auth-token"
- Every API request includes header: Authorization: Bearer <token>
- Server middleware validates token on protected routes
- On app load: check for token -> call GET /api/auth/me -> if valid, load from server; if expired, show login

## Frontend Changes

### Header
- Logged out: "Sign In" link in header area
- Logged in: user email + "Sign Out" link

### Login/Signup Modal
- Overlay modal (not separate page)
- Email field, password field
- "Log In" button / "Sign Up" toggle
- "Continue without account" dismiss link
- Matches Stash warm aesthetic

### Data routing
- Not logged in: localStorage (current behavior, unchanged)
- Logged in: all reads/writes go through /api/stashes endpoints
- Settings also sync to server when logged in

### Settings panel additions (when logged in)
- "Email Digests" section
- Daily digest toggle
- Weekly digest toggle (Sundays)

## Email Digest System

### Scheduling
- Daily: cron job runs every day at 7:00 AM (user timezone)
- Weekly: cron job runs every Sunday at 9:00 AM (user timezone)

### Logic
1. Query users where digest_preference matches the schedule
2. For each user, query stashes created in the time window (24h for daily, 7d for weekly)
3. Group stashes by category (type field)
4. Build HTML email with category breakdown
5. Send via Resend API

### Email format
- Subject: "Your Stash Digest - Feb 26" (daily) / "Your Week in Stash - Feb 20-26" (weekly)
- Body: stashes grouped by category with icons, content, tags, timestamps
- Footer: link to open app, link to change preferences

### Category breakdown example
```
Recommended (3)
  * Mom told me about that Thai place on 5th
  * Check out the book "Atomic Habits"
  * Sarah referred me to her accountant

Links (2)
  * https://example.com/cool-article
  * https://docs.railway.app/guides

Notes (1)
  * Remember to call the dentist Tuesday
```

## Implementation Phases

### Phase 1: Database + Auth
- Add PostgreSQL to Railway project (manual step in dashboard)
- Install dependencies: pg, bcrypt, jsonwebtoken
- Create database tables (users, stashes)
- Build auth endpoints: signup, login, me
- Add JWT middleware for protected routes

### Phase 2: Server-side stash storage
- Build CRUD endpoints for /api/stashes
- Build /api/stashes/bulk for localStorage merge
- Build /api/settings endpoints
- Frontend: detect logged-in vs logged-out, route saves accordingly
- Frontend: merge localStorage stashes on signup

### Phase 3: Login UI
- Login/signup modal component
- Header auth state (sign in link / user email)
- Settings panel digest preference toggles (visible when logged in)

### Phase 4: Email digests
- Install resend dependency
- Build email HTML template with category breakdown
- Build sendDigest() function
- Set up cron jobs (daily + weekly)
- Add RESEND_API_KEY to Railway environment variables

## Tech Stack Summary

| Component | Technology |
|-----------|-----------|
| Frontend | React via CDN + Babel (index.html, unchanged) |
| Backend | Express.js on Railway (expanded) |
| Database | PostgreSQL on Railway |
| Auth | bcrypt + jsonwebtoken (JWT) |
| Email | Resend |
| Scheduling | node-cron or Railway cron |
| Hosting | Netlify (frontend) + Railway (backend + DB) |
