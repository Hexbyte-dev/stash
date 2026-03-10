// ============================================================
// STORAGE SHIM
//
// The artifact version of Squirrel uses window.storage (Claude's
// persistent storage API). For a standalone PWA, we replace it
// with localStorage — same interface, browser-native storage.
//
// localStorage is synchronous and stores strings, so we wrap
// it in async functions to match the original API shape.
// ============================================================
window.storage = {
  async get(key) {
    const value = localStorage.getItem(key);
    if (value === null) throw new Error("Key not found: " + key);
    return { key, value };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { key, value };
  },
  async delete(key) {
    localStorage.removeItem(key);
    return { key, deleted: true };
  },
  async list(prefix) {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!prefix || k.startsWith(prefix)) keys.push(k);
    }
    return { keys };
  }
};

// ============================================================
// SERVICE WORKER REGISTRATION
// ============================================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => console.log("[PWA] Service worker registered:", reg.scope))
      .catch((err) => console.log("[PWA] Service worker registration failed:", err));
  });
}

// ============================================================
// INSTALL PROMPT HANDLER
//
// Browsers fire a "beforeinstallprompt" event when the PWA
// criteria are met. We capture it so we can show our own
// install button instead of relying on the browser's banner.
// ============================================================
// Fix #15: Use window.deferredPrompt consistently so InstallBanner can read it
window.deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  window.deferredPrompt = e;
  // Dispatch a custom event so our React app can show an install button
  window.dispatchEvent(new CustomEvent("pwa-installable"));
});

window.addEventListener("appinstalled", () => {
  window.deferredPrompt = null;
  window.dispatchEvent(new CustomEvent("pwa-installed"));
  console.log("[PWA] App installed successfully");
});
