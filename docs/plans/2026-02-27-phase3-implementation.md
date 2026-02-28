# Phase 3: Login UI & Server Data Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a login/signup screen to the Stash PWA and switch all data storage from localStorage to the server API.

**Architecture:** Auth state lives inside the existing `Stash` component. A `LoginScreen` sub-component renders a full-page login/signup form. All CRUD operations switch from `window.storage` calls to `fetch()` calls against the backend API. A one-time migration auto-imports localStorage stashes on first login.

**Tech Stack:** React 18 (CDN), Babel standalone, existing Express.js backend on Railway

---

### Task 1: Add the API helper function

**Files:**
- Modify: `index.html` (after the `BACKEND_URL` constant, around line 415)

**Step 1: Add the `apiFetch` helper**

After the existing `BACKEND_URL` line (line 415), add this helper function. It wraps `fetch()` to automatically attach the JWT token and handle common errors. Every API call in the app will use this instead of raw `fetch()`.

```js
// ============================================================
// API HELPER
//
// Wraps fetch() to attach the JWT token and handle errors.
// Every authenticated API call uses this function.
//
// NEW CONCEPT: "Bearer token"
// When a user logs in, the server gives them a token (a long
// string). For every API request after that, we send this token
// in the "Authorization" header so the server knows who we are.
// The format is: "Bearer <token>" — "Bearer" is just a keyword
// that tells the server "here comes a token."
// ============================================================
const apiFetch = async (path, options = {}) => {
  const token = localStorage.getItem("stash-token");
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers,
  });

  // If the server says our token is expired or invalid,
  // we need to log out and show the login screen again
  if (response.status === 401) {
    localStorage.removeItem("stash-token");
    // Dispatch a custom event so the Stash component can react
    window.dispatchEvent(new CustomEvent("auth-expired"));
    throw new Error("Session expired");
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
};
```

**Step 2: Commit**

```bash
git add index.html
git commit -m "Add apiFetch helper for authenticated API calls"
```

---

### Task 2: Add the LoginScreen component

**Files:**
- Modify: `index.html` (before the `Stash` function, around line 1560)

**Step 1: Add the LoginScreen component**

Insert this component just before the `function Stash()` line (line 1565). It renders a full-page login or signup form styled to match the app's warm aesthetic.

```js
// ============================================================
// LOGIN SCREEN
//
// Full-page login/signup form. Rendered when the user has no
// valid JWT token. Uses the same theme system as the rest of
// the app.
//
// NEW CONCEPTS:
// - "Controlled form" — React controls the input values via
//   state (email, password). Every keystroke updates state,
//   and the input always shows the current state value.
//
// - "Form submission" — We prevent the browser's default form
//   submit (which would reload the page) and handle it ourselves
//   with an API call.
//
// - "authMode" toggle — Instead of two separate pages, we use
//   one component with a state variable that switches between
//   "login" and "signup" mode. The form fields are the same,
//   just the button text and API endpoint change.
// ============================================================
const LoginScreen = ({ onLogin, theme }) => {
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const response = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Something went wrong");
      }

      // Save the token and tell the parent component
      localStorage.setItem("stash-token", data.token);
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: theme.pageBg,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'DM Sans', sans-serif",
      transition: "background 0.4s ease",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;1,400;1,500&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300;1,400&display=swap" rel="stylesheet" />

      <div style={{
        width: "92%",
        maxWidth: "380px",
        animation: "softFadeIn 0.6s ease",
      }}>
        {/* Branding */}
        <div style={{ textAlign: "center", marginBottom: "36px" }}>
          <h1 style={{
            fontFamily: "'Lora', serif",
            fontSize: "36px",
            fontWeight: 400,
            color: theme.textSecondary,
            letterSpacing: "-0.02em",
            margin: "0 0 6px",
          }}>Stash</h1>
          <p style={{
            fontFamily: "'Lora', serif",
            fontSize: "14px",
            color: theme.textGhost,
            fontStyle: "italic",
            margin: 0,
          }}>your personal memory bank</p>
        </div>

        {/* Form card */}
        <div style={{
          background: theme.cardBg,
          borderRadius: "20px",
          border: `1px solid ${theme.border}`,
          padding: "32px 28px",
          boxShadow: theme.shadowMedium,
        }}>
          <form onSubmit={handleSubmit}>
            {/* Email */}
            <div style={{ marginBottom: "18px" }}>
              <label style={{
                display: "block",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: "13px",
                fontWeight: 500,
                color: theme.textMuted,
                marginBottom: "6px",
              }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                placeholder="you@example.com"
                required
                autoComplete="email"
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: `1px solid ${theme.border}`,
                  background: theme.inputBg,
                  color: theme.textPrimary,
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: "15px",
                  outline: "none",
                  boxSizing: "border-box",
                  transition: "border-color 0.2s ease",
                }}
                onFocus={(e) => e.target.style.borderColor = theme.borderHover}
                onBlur={(e) => e.target.style.borderColor = theme.border}
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: "24px" }}>
              <label style={{
                display: "block",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: "13px",
                fontWeight: 500,
                color: theme.textMuted,
                marginBottom: "6px",
              }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                placeholder={authMode === "signup" ? "8+ characters" : ""}
                required
                autoComplete={authMode === "login" ? "current-password" : "new-password"}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: `1px solid ${theme.border}`,
                  background: theme.inputBg,
                  color: theme.textPrimary,
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: "15px",
                  outline: "none",
                  boxSizing: "border-box",
                  transition: "border-color 0.2s ease",
                }}
                onFocus={(e) => e.target.style.borderColor = theme.borderHover}
                onBlur={(e) => e.target.style.borderColor = theme.border}
              />
            </div>

            {/* Error message */}
            {error && (
              <div style={{
                color: theme.deleteColor,
                fontSize: "13px",
                fontFamily: "'DM Sans', sans-serif",
                marginBottom: "16px",
                textAlign: "center",
              }}>{error}</div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                padding: "13px",
                borderRadius: "12px",
                border: "none",
                background: loading ? theme.disabledBg : theme.accentGradient,
                color: loading ? theme.disabledText : "#FFFFFF",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px",
                fontWeight: 500,
                cursor: loading ? "default" : "pointer",
                transition: "opacity 0.2s ease",
              }}
            >
              {loading
                ? (authMode === "login" ? "Logging in..." : "Creating account...")
                : (authMode === "login" ? "Log in" : "Create account")}
            </button>
          </form>

          {/* Toggle login/signup */}
          <div style={{
            textAlign: "center",
            marginTop: "20px",
            fontSize: "13px",
            color: theme.textFaint,
            fontFamily: "'DM Sans', sans-serif",
          }}>
            {authMode === "login" ? (
              <span>
                Don't have an account?{" "}
                <span
                  onClick={() => { setAuthMode("signup"); setError(""); }}
                  style={{ color: theme.accent, cursor: "pointer", fontWeight: 500 }}
                >Sign up</span>
              </span>
            ) : (
              <span>
                Already have an account?{" "}
                <span
                  onClick={() => { setAuthMode("login"); setError(""); }}
                  style={{ color: theme.accent, cursor: "pointer", fontWeight: 500 }}
                >Log in</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
```

**Step 2: Commit**

```bash
git add index.html
git commit -m "Add LoginScreen component"
```

---

### Task 3: Add auth state and login/logout flow to Stash component

**Files:**
- Modify: `index.html` (inside the `Stash` function, starting at line 1565)

**Step 1: Add auth state variables**

At the top of the `Stash` function (after line 1565 `function Stash() {`), before the existing state variables, add:

```js
  // --- Auth state ---
  const [token, setToken] = useState(localStorage.getItem("stash-token"));
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(!!localStorage.getItem("stash-token"));
  const [authError, setAuthError] = useState("");
```

**Step 2: Add auth-expired event listener**

After the new auth state variables, add this effect that listens for the custom event fired by `apiFetch` when a token is expired:

```js
  // Listen for auth-expired events from apiFetch
  useEffect(() => {
    const handleAuthExpired = () => {
      setToken(null);
      setUser(null);
      setItems([]);
      setAuthError("Session expired. Please log in again.");
    };
    window.addEventListener("auth-expired", handleAuthExpired);
    return () => window.removeEventListener("auth-expired", handleAuthExpired);
  }, []);
```

**Step 3: Add the handleLogin function**

After the auth-expired listener, add the login handler that the `LoginScreen` calls:

```js
  // Called by LoginScreen after successful login/signup
  const handleLogin = async (newToken, userData) => {
    setToken(newToken);
    setUser(userData);
    setAuthError("");
    setAuthLoading(true);

    try {
      // Check for localStorage stashes to migrate
      const localData = localStorage.getItem("stash-items");
      if (localData) {
        const localStashes = JSON.parse(localData);
        if (localStashes.length > 0) {
          // Auto-migrate localStorage stashes to the server
          await fetch(`${BACKEND_URL}/api/stashes/import`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${newToken}`,
            },
            body: JSON.stringify({ stashes: localStashes }),
          });
          // Clear localStorage stashes after successful migration
          localStorage.removeItem("stash-items");
        }
      }

      // Fetch all stashes from the server
      const data = await apiFetch("/api/stashes");
      setItems(data.stashes);
    } catch (err) {
      console.error("[Auth] Failed to load stashes:", err.message);
    } finally {
      setAuthLoading(false);
      setIsLoading(false);
    }
  };
```

**Step 4: Add the handleLogout function**

After handleLogin, add:

```js
  const handleLogout = () => {
    localStorage.removeItem("stash-token");
    setToken(null);
    setUser(null);
    setItems([]);
  };
```

**Step 5: Commit**

```bash
git add index.html
git commit -m "Add auth state, login handler, and logout to Stash component"
```

---

### Task 4: Replace the loadData effect with server-based loading

**Files:**
- Modify: `index.html` (the `useEffect` at line 1598)

**Step 1: Replace the loadData useEffect**

Replace the existing `// Load items + settings` useEffect (lines 1598-1647) with this version that loads from the server when logged in, or shows the login screen when not:

```js
  // Load data on mount
  useEffect(() => {
    const loadData = async () => {
      // Load settings from localStorage (stays local, not synced)
      try {
        const settingsResult = await window.storage.get("stash-settings");
        if (settingsResult?.value) setSettings(prev => ({ ...prev, ...JSON.parse(settingsResult.value) }));
      } catch (e) {}

      // If we have a token, try loading stashes from the server
      if (token) {
        try {
          const data = await apiFetch("/api/stashes");
          setItems(data.stashes);
          setAuthLoading(false);
          setIsLoading(false);
        } catch (err) {
          // Token is invalid or expired — clear it
          localStorage.removeItem("stash-token");
          setToken(null);
          setAuthLoading(false);
          setIsLoading(false);
        }
      } else {
        // No token — just finish loading (will show login screen)
        setIsLoading(false);
      }
    };
    loadData();
  }, []);
```

**Step 2: Remove or update the save-items useEffect**

Find the `// Save items` useEffect (lines 1650-1657) and replace it with a no-op comment. Items are now saved via API calls, not localStorage:

```js
  // Items are now saved via API calls (addItem, editItem, deleteItem, etc.)
  // No localStorage save needed for items.
```

**Step 3: Commit**

```bash
git add index.html
git commit -m "Switch data loading from localStorage to server API"
```

---

### Task 5: Update CRUD operations to use API calls

**Files:**
- Modify: `index.html` (the `addItem`, `deleteItem`, `deleteMultiple`, `editItem`, `toggleComplete`, `togglePin`, `completeMultiple`, `clearAllCompleted` functions)

This task updates each function that modifies stashes to also make the corresponding API call. The pattern is **optimistic updates**: update the UI immediately, then sync with the server in the background.

**Step 1: Update addItem**

Replace the `const addItem` function (starting at line 1708). The key change is adding an `apiFetch` call after updating local state. The item is created in local state first (for instant UI), then synced to the server.

Find this line inside addItem (around line 1733):

```js
    setItems(prev => [{
      id: newId,
      content: cleanContent || (pendingImage ? pendingImage.fileName : text),
      type: itemType,
      tags: pendingImage && tags.length === 0 ? ["photo"] : tags,
      image: imageData,
      createdAt: new Date().toISOString(),
      completed: false,
      completedAt: null,
      pinned: false,
    }, ...prev]);
```

After that `setItems` call (and before the `setInputValue("")` line), add:

```js
    // Sync to server
    apiFetch("/api/stashes", {
      method: "POST",
      body: JSON.stringify({
        id: newId,
        type: itemType,
        content: cleanContent || (pendingImage ? pendingImage.fileName : text),
        tags: pendingImage && tags.length === 0 ? ["photo"] : tags,
        image: imageData,
        createdAt: new Date().toISOString(),
      }),
    }).catch(err => console.error("[Sync] Create failed:", err.message));
```

**Step 2: Update deleteItem**

Inside the `deleteItem` function, after the line `setItems(prev => prev.filter(i => i.id !== id));` (inside the setTimeout), add:

```js
      // Sync to server
      apiFetch(`/api/stashes/${id}`, { method: "DELETE" })
        .catch(err => console.error("[Sync] Delete failed:", err.message));
```

**Step 3: Update deleteMultiple**

Inside the `deleteMultiple` function, after the line `setItems(prev => prev.filter(i => !ids.has(i.id)));` (inside the setTimeout), add:

```js
      // Sync to server
      ids.forEach(id => {
        apiFetch(`/api/stashes/${id}`, { method: "DELETE" })
          .catch(err => console.error("[Sync] Delete failed:", err.message));
      });
```

**Step 4: Update editItem**

Replace the `editItem` function with this version that also syncs to the server:

```js
  const editItem = (id, updates) => {
    setItems(prev => prev.map(item =>
      item.id === id
        ? { ...item, ...updates }
        : item
    ));
    // Sync to server
    apiFetch(`/api/stashes/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    }).catch(err => console.error("[Sync] Update failed:", err.message));
  };
```

**Step 5: Update toggleComplete**

Replace the `toggleComplete` function:

```js
  const toggleComplete = (id) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const updated = {
        ...item,
        completed: !item.completed,
        completedAt: !item.completed ? new Date().toISOString() : null,
      };
      // Sync to server
      apiFetch(`/api/stashes/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          completed: updated.completed,
          completedAt: updated.completedAt,
        }),
      }).catch(err => console.error("[Sync] Update failed:", err.message));
      return updated;
    }));
  };
```

**Step 6: Update togglePin**

Replace the `togglePin` function:

```js
  const togglePin = (id) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const updated = { ...item, pinned: !item.pinned };
      // Sync to server
      apiFetch(`/api/stashes/${id}`, {
        method: "PUT",
        body: JSON.stringify({ pinned: updated.pinned }),
      }).catch(err => console.error("[Sync] Update failed:", err.message));
      return updated;
    }));
  };
```

**Step 7: Update completeMultiple**

Replace the `completeMultiple` function:

```js
  const completeMultiple = (ids) => {
    const completedAt = new Date().toISOString();
    setItems(prev => prev.map(item =>
      ids.has(item.id) ? { ...item, completed: true, completedAt } : item
    ));
    // Sync to server
    ids.forEach(id => {
      apiFetch(`/api/stashes/${id}`, {
        method: "PUT",
        body: JSON.stringify({ completed: true, completedAt }),
      }).catch(err => console.error("[Sync] Update failed:", err.message));
    });
    setBulkSelected(new Set());
    setBulkMode(false);
  };
```

**Step 8: Update clearAllCompleted**

Inside `clearAllCompleted`, after the line `setItems(prev => prev.filter(i => !i.completed));` (inside the setTimeout), add:

```js
      // Sync to server
      completedIds.forEach(id => {
        apiFetch(`/api/stashes/${id}`, { method: "DELETE" })
          .catch(err => console.error("[Sync] Delete failed:", err.message));
      });
```

**Step 9: Update the OCR auto-scan callback in addItem**

Inside the `addItem` function, find the block where OCR results update the item (the `setItems(prev => prev.map(item =>` inside the `extractBusinessCard` `.then()` callback). After that `setItems` call, add a server sync:

```js
          // Sync OCR results to server
          apiFetch(`/api/stashes/${newId}`, {
            method: "PUT",
            body: JSON.stringify({
              content: formatted,
              type: "contact",
              tags: updatedTags,
              ocrData: cardData,
            }),
          }).catch(err => console.error("[Sync] OCR update failed:", err.message));
```

Similarly, in the `scanBusinessCard` function, the `editItem` call already syncs (from Step 4), so no additional change is needed there.

**Step 10: Commit**

```bash
git add index.html
git commit -m "Switch all CRUD operations to server API with optimistic updates"
```

---

### Task 6: Render LoginScreen and add logout button

**Files:**
- Modify: `index.html` (the Stash component's return statements and the SettingsPanel)

**Step 1: Add the login screen render**

In the `Stash` component, find the existing loading screen (around line 1996):

```js
  if (isLoading) {
    return (
      <div style={{
        minHeight: "100vh", background: theme.pageBg,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: theme.textFaint, fontFamily: "'Lora', serif",
        fontStyle: "italic", fontSize: "15px",
        transition: "background 0.4s ease",
      }}>opening your stash…</div>
    );
  }
```

Replace it with this, which handles both loading and auth states:

```js
  // Show loading screen while checking auth
  if (isLoading || authLoading) {
    return (
      <div style={{
        minHeight: "100vh", background: theme.pageBg,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: theme.textFaint, fontFamily: "'Lora', serif",
        fontStyle: "italic", fontSize: "15px",
        transition: "background 0.4s ease",
      }}>
        <link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;1,400;1,500&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300;1,400&display=swap" rel="stylesheet" />
        opening your stash…
      </div>
    );
  }

  // Show login screen if not authenticated
  if (!token) {
    return <LoginScreen onLogin={handleLogin} theme={theme} initialError={authError} />;
  }
```

**Step 2: Update LoginScreen to accept initialError**

Go back to the `LoginScreen` component and update its props and initial error state:

Change the function signature from:

```js
const LoginScreen = ({ onLogin, theme }) => {
```

to:

```js
const LoginScreen = ({ onLogin, theme, initialError }) => {
```

Change the error state initialization from:

```js
  const [error, setError] = useState("");
```

to:

```js
  const [error, setError] = useState(initialError || "");
```

**Step 3: Add logout button to SettingsPanel**

Update the `SettingsPanel` component signature to accept an `onLogout` prop. Change:

```js
const SettingsPanel = ({ isOpen, onClose, settings, onUpdateSettings, theme, itemCount, completedCount, onExport, onExportFull, onImport }) => {
```

to:

```js
const SettingsPanel = ({ isOpen, onClose, settings, onUpdateSettings, theme, itemCount, completedCount, onExport, onExportFull, onImport, onLogout }) => {
```

Then, inside the SettingsPanel, just before the closing `</div>` of the modal content (around line 1038, after the Import section's closing `</div>`), add the logout button:

```js
        {/* Logout */}
        {onLogout && (
          <div style={{ marginTop: "28px", paddingTop: "20px", borderTop: `1px solid ${theme.border}` }}>
            <button
              onClick={onLogout}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "12px",
                border: `1px solid ${theme.border}`,
                background: "none",
                color: theme.deleteColor,
                fontFamily: "'DM Sans', sans-serif",
                fontSize: "14px",
                fontWeight: 500,
                cursor: "pointer",
                transition: "background 0.2s ease",
              }}
              onMouseEnter={(e) => e.target.style.background = theme.deleteBg}
              onMouseLeave={(e) => e.target.style.background = "none"}
            >Log out</button>
          </div>
        )}
```

**Step 4: Pass onLogout to SettingsPanel**

In the `Stash` component's return, find the `<SettingsPanel` usage (around line 2096) and add the `onLogout` prop:

After:
```js
        onImport={(data) => {
```

Before the end of the SettingsPanel props, add:

```js
        onLogout={handleLogout}
```

So the full SettingsPanel usage becomes:

```js
      <SettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={setSettings}
        theme={theme}
        itemCount={activeItems.length}
        completedCount={completedItems.length}
        onExport={() => exportData(items, settings)}
        onExportFull={() => exportDataFull(items, settings)}
        onImport={(data) => {
          if (data?.items && Array.isArray(data.items)) {
            setItems(data.items);
            if (data.settings) setSettings(prev => ({ ...prev, ...data.settings }));
            setSettingsOpen(false);
          } else {
            alert("This doesn't look like a valid Stash backup file.");
          }
        }}
        onLogout={handleLogout}
      />
```

**Step 5: Remove the onboarding seed items**

In the `loadData` effect, the old code seeded example items for first-time users when localStorage was empty. Since data now comes from the server, remove the onboarding seed block. This block no longer makes sense because:
- New users will have zero stashes on the server (which is correct)
- The seed items would only show briefly before being replaced by server data

The seed items block was inside the old `loadData` — it should already be gone since we replaced that effect in Task 4. Verify it's not present.

**Step 6: Commit**

```bash
git add index.html
git commit -m "Render LoginScreen, add logout button to Settings"
```

---

### Task 7: Update the OCR call to use auth token

**Files:**
- Modify: `index.html` (the `extractBusinessCard` function, around line 417)

**Step 1: Update extractBusinessCard to use apiFetch**

The OCR endpoint now requires authentication (we added `requireAuth` to it in Phase 1). Update the function to use `apiFetch` instead of raw `fetch`.

Find the `extractBusinessCard` function and replace its `fetch` call:

Change:
```js
    const response = await fetch(`${BACKEND_URL}/api/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageDataUrl }),
    });
```

To:
```js
    const response = await apiFetch("/api/ocr", {
      method: "POST",
      body: JSON.stringify({ image: imageDataUrl }),
    });
```

Note: `apiFetch` returns the parsed JSON data, not a raw Response object. So also update the response handling. The current code likely does `const data = await response.json();` — that line should be removed since `apiFetch` already parses JSON. The function needs to be adjusted to work with the parsed data directly.

Find the full function and replace it:

```js
const extractBusinessCard = async (imageDataUrl) => {
  try {
    const data = await apiFetch("/api/ocr", {
      method: "POST",
      body: JSON.stringify({ image: imageDataUrl }),
    });
    return data.card || null;
  } catch (err) {
    console.error("[OCR Error]", err.message);
    return null;
  }
};
```

**Step 2: Commit**

```bash
git add index.html
git commit -m "Update OCR call to use authenticated apiFetch"
```

---

### Task 8: Test locally and deploy

**Step 1: Test the login flow**

Open the app locally (or on Netlify after pushing). Verify:

1. App shows login screen on first visit
2. Can switch between login and signup modes
3. Can create a new account (signup)
4. After signup, app loads and shows empty stash list
5. Can create a stash and it appears
6. Refresh the page — stash persists (loaded from server)
7. Can edit, pin, complete, and delete stashes
8. Logout button in settings works — returns to login screen
9. Can log back in and see stashes

**Step 2: Test migration**

To test localStorage migration:
1. Log out
2. Open browser console and run: `localStorage.setItem("stash-items", JSON.stringify([{id:"test-migrate",type:"note",content:"Migrated from localStorage",tags:["test"],createdAt:new Date().toISOString(),completed:false,pinned:false}]))`
3. Log in
4. The migrated stash should appear in the list
5. `localStorage.getItem("stash-items")` should return `null` (cleared after migration)

**Step 3: Test error handling**

1. Try logging in with wrong password — should show error message
2. Try signing up with an email that already exists — should show error
3. Try signing up with a short password (< 8 chars) — should show error

**Step 4: Push to deploy**

```bash
git push origin main
```

Verify the app works on Netlify after deployment.

**Step 5: Commit (if any fixes needed)**

If any fixes are needed during testing, commit them:

```bash
git add index.html
git commit -m "Fix issues found during testing"
```
