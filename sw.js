// ============================================================
// STASH SERVICE WORKER
// 
// This file runs in the background, separate from your app.
// It intercepts network requests and serves cached responses
// when offline. Think of it as a helpful proxy between your
// app and the internet.
//
// CACHING STRATEGY: "Cache first, network fallback"
// 1. On install: pre-cache the core app files
// 2. On fetch: try cache first, fall back to network
// 3. On activate: clean up old caches
// ============================================================

const CACHE_NAME = "stash-v1";

// Core files to cache immediately on install
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  // React from CDN — cached locally for offline
  "https://unpkg.com/react@18/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
  "https://unpkg.com/@babel/standalone/babel.min.js",
  // Fonts
  "https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;1,400;1,500&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300;1,400&display=swap",
];

// INSTALL: Cache core assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Pre-caching core assets");
      return cache.addAll(CORE_ASSETS);
    })
  );
  // Activate immediately, don't wait for old SW to finish
  self.skipWaiting();
});

// ACTIVATE: Clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log("[SW] Removing old cache:", name);
            return caches.delete(name);
          })
      );
    })
  );
  // Take control of all pages immediately
  self.clients.claim();
});

// FETCH: Cache-first strategy
self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only handle GET requests
  if (request.method !== "GET") return;

  // Skip API calls — these should always hit the network
  if (request.url.includes("api.anthropic.com")) return;
  if (request.url.includes("stash-server-production")) return;

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Found in cache — serve it immediately
        // Also fetch from network in background to update cache
        fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, networkResponse);
              });
            }
          })
          .catch(() => {}); // Network failed, that's fine
        return cachedResponse;
      }

      // Not in cache — try network
      return fetch(request)
        .then((networkResponse) => {
          // Cache the new response for next time
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Network failed and nothing in cache
          // Return offline fallback for navigation requests
          if (request.mode === "navigate") {
            return caches.match("/index.html");
          }
          return new Response("Offline", { status: 503 });
        });
    })
  );
});
