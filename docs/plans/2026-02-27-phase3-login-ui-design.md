# Phase 3: Login UI & Server Data Flow

**Date:** 2026-02-27
**Status:** Approved

## Overview

Add a login/signup screen to the Stash PWA and switch all data storage from localStorage to the server API. Login is required — users must authenticate before using the app. Existing localStorage stashes are auto-migrated on first login.

## Decisions

- **Auth required:** App shows login screen on startup. No anonymous usage.
- **Auth state location:** Inside the existing `Stash` component (no new wrapper).
- **Token storage:** `localStorage` key `stash-token`.
- **UI style:** Full-page login screen (not a modal).
- **Default view:** Login form, with link to switch to signup.
- **Migration:** Auto-import localStorage stashes on first login, then clear them.
- **Settings:** Stay in localStorage (device-specific, not synced).
- **Offline:** Not supported. App requires network to log in and fetch stashes.
- **Scope:** Frontend only — backend is already built (Phase 1 & 2).

## Auth State

Three new state variables in the `Stash` component:

- `token` — JWT string (persisted in localStorage as `stash-token`)
- `user` — user object from login/signup response (email, id)
- `authLoading` — true while checking for existing token on startup

### Startup Flow

1. App mounts, checks localStorage for `stash-token`
2. If token exists, try `GET /api/stashes` (validates token + loads data)
3. If fetch succeeds → logged in, load stashes into state
4. If fetch fails (401) → clear token, show login screen
5. If no token → show login screen

## Login/Signup Screen

Full-page screen rendered when there's no valid token. Matches the app's warm aesthetic.

### Layout
- Centered container (maxWidth: 580px, same as main app)
- App title "Stash" in Lora serif
- Subtitle "Your personal memory bank"
- Card-style form with warm beige/white theme styling

### Login Form
- Email input
- Password input
- "Log in" button (accent gradient)
- "Don't have an account? Sign up" link

### Signup Form
- Email input
- Password input (with "8+ characters" hint)
- "Create account" button (accent gradient)
- "Already have an account? Log in" link

### Behavior
- `authMode` state toggles between "login" and "signup"
- Inline error messages below form (warm red/coral color)
- Errors clear when user starts typing
- Button shows "Logging in..." / "Creating account..." while loading
- Button disabled during API call

## Data Flow After Login

### CRUD switches to API calls
- Create: `POST /api/stashes` (was localStorage write)
- Update: `PUT /api/stashes/:id` (was localStorage write)
- Delete: `DELETE /api/stashes/:id` (was localStorage write)
- Read: Loaded on login via `GET /api/stashes`, kept in React state

### Optimistic updates
UI updates immediately on create/edit/delete. API call runs in background. Error toast if API fails.

### Migration (one-time)
After first login, if localStorage has `stash-items`:
1. Call `POST /api/stashes/import` with existing stashes
2. Clear `stash-items` from localStorage
3. Reload stashes from server

## Logout & Error Handling

### Logout
- Button added to Settings panel (bottom)
- Clears `stash-token` from localStorage
- Clears items and user state
- Shows login screen

### Token expiration
- JWT expires after 7 days
- Any 401 response → clear token, show login screen with "Session expired" message

### Network errors
- Show toast: "Unable to reach the server. Changes may not be saved."
- App continues working with data in state
- Changes won't sync until connection restored

## File Changes

- `index.html` — All changes (login screen, auth state, API calls, logout, migration)
- No backend changes needed

## Not Building (YAGNI)

- No offline mode (requires network)
- No "remember me" checkbox (token persists in localStorage by default)
- No password reset (future phase)
- No settings sync (settings stay device-local)
- No loading skeleton / shimmer effects
- No social login (OAuth)
