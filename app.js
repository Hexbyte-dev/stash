const {
  useState,
  useEffect,
  useRef,
  useCallback
} = React;

// Fix #17: Single version constant — change this one value to update everywhere
const APP_VERSION = "0.8";

/*
  STASH — Your Personal Memory Bank
  v0.8: Business Card OCR + Pin Items + Export Data
  
  NEW CONCEPTS:
  - "OCR" (Optical Character Recognition) = extracting text from images
    We use the Anthropic API to analyze business card photos and pull out
    structured info like name, phone, email, company, title.
  - "Pinning" = flagging items as important so they always appear at top
  - "Data export" = converting app data to a downloadable JSON file
    This teaches you about Blob URLs and programmatic downloads
*/

const generateId = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

// ============================================================
// TIMEZONE & DATE FORMATTING
// 
// NEW CONCEPT: "Timezones"
// Dates in JavaScript are stored as UTC (universal time).
// When we display them, we convert to a specific timezone.
// The Intl.DateTimeFormat API handles this — we just tell it
// which timezone to use (like "America/New_York") and it
// does all the math for daylight savings, offsets, etc.
//
// We use 24-hour time (aka "military time") — so 2:30 PM
// displays as 14:30. No AM/PM ambiguity!
// ============================================================
const timezoneOptions = [{
  value: "America/New_York",
  label: "Eastern (ET)"
}, {
  value: "America/Chicago",
  label: "Central (CT)"
}, {
  value: "America/Denver",
  label: "Mountain (MT)"
}, {
  value: "America/Los_Angeles",
  label: "Pacific (PT)"
}, {
  value: "UTC",
  label: "UTC"
}];

// ============================================================
// DIGEST SETTING CONSTANTS
// These live outside components so they're created once and
// shared by any component that needs them (avoids recreating
// arrays on every render).
// ============================================================

// Curated timezone list for digest settings
// Only major zones to keep the dropdown manageable
const DIGEST_TIMEZONES = [{
  value: "America/New_York",
  label: "Eastern (New York)"
}, {
  value: "America/Chicago",
  label: "Central (Chicago)"
}, {
  value: "America/Denver",
  label: "Mountain (Denver)"
}, {
  value: "America/Los_Angeles",
  label: "Pacific (Los Angeles)"
}, {
  value: "America/Anchorage",
  label: "Alaska"
}, {
  value: "Pacific/Honolulu",
  label: "Hawaii"
}, {
  value: "Europe/London",
  label: "London"
}, {
  value: "Europe/Paris",
  label: "Paris / Berlin"
}, {
  value: "Asia/Dubai",
  label: "Dubai"
}, {
  value: "Asia/Kolkata",
  label: "Mumbai"
}, {
  value: "Asia/Singapore",
  label: "Singapore"
}, {
  value: "Asia/Tokyo",
  label: "Tokyo"
}, {
  value: "Australia/Sydney",
  label: "Sydney"
}, {
  value: "Pacific/Auckland",
  label: "Auckland"
}];

// Hourly time slots from 6 AM to 10 PM for digest send time
// We use a for loop to build this array programmatically instead
// of typing out 17 entries by hand — less error-prone!
const DIGEST_TIMES = [];
for (let h = 6; h <= 22; h++) {
  // padStart(2, "0") turns 6 → "06", 10 → "10", etc.
  DIGEST_TIMES.push(String(h).padStart(2, "0") + ":00");
}
const formatDateTime = (dateString, timezone = "America/New_York") => {
  const date = new Date(dateString);

  // Format the date portion: "Feb 24, 2026"
  const datePart = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);

  // Format the time in 24-hour: "14:30"
  const timePart = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
  return `${datePart} · ${timePart}`;
};

// ============================================================
// SERVER DATA MAPPER
//
// The server (PostgreSQL) returns column names in snake_case:
//   created_at, completed_at, ocr_data, user_id
// But the frontend uses camelCase:
//   createdAt, completedAt, ocrData
//
// This function maps server stash objects to the format the
// frontend expects. Applied whenever we load stashes from the API.
// ============================================================
const mapServerStash = stash => ({
  ...stash,
  createdAt: stash.created_at || stash.createdAt,
  completedAt: stash.completed_at || stash.completedAt || null,
  ocrData: stash.ocr_data || stash.ocrData || null
});

// ============================================================
// AUTO-DETECTION
// Scans text for keywords to guess the category.
// Custom categories use user-defined keywords (stored in settings).
// The "auto" override skips this and uses whatever the user picks.
// ============================================================
const builtInKeywords = {
  link: {
    pattern: /https?:\/\//
  },
  contact: {
    pattern: /(@.+\.\w{2,}|\d{3}[\s.-]?\d{3}[\s.-]?\d{4})/
  },
  travel: {
    pattern: /travel|flight|hotel|airport|trip|vacation|passport|airbnb|booking|destination|luggage|itinerary/i
  },
  work: {
    pattern: /meeting|deadline|project|client|office|presentation|agenda|boss|colleague|report|quarterly/i
  },
  money: {
    pattern: /price|\$|cost|budget|invest|expense|deal|sale|payment|invoice|subscription/i
  },
  health: {
    pattern: /doctor|appointment|medicine|symptom|prescription|therapy|dentist|hospital|workout|vitamin/i
  },
  media: {
    pattern: /song|album|playlist|podcast|movie|show|watch|listen|series|episode|spotify|netflix/i
  },
  event: {
    pattern: /event|party|birthday|conference|concert|wedding|rsvp|invite|festival|ceremony|reunion/i
  },
  reading: {
    pattern: /read|book|article|blog|chapter|author|novel|paper|journal/i
  },
  food: {
    pattern: /restaurant|eat|food|dinner|lunch|cafe|recipe|cook|brunch|bakery|reservation/i
  },
  idea: {
    pattern: /idea|thought|maybe|what if|brainstorm|concept|possibility/i
  },
  person: {
    pattern: /meet|person|name|card|introduce/i
  },
  recommended: {
    pattern: /recommend|suggested|check out|you should try|told me about|referred/i
  }
};

// Fix #3: Escape special regex characters in user input.
// Without this, a keyword like "c++" would break the RegExp because
// "+" has special meaning in regex. This makes it literal.
const escapeRegex = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const detectType = (text, customCategories = []) => {
  // Check built-in patterns (link and contact first — most specific)
  for (const key of ["link", "contact"]) {
    if (builtInKeywords[key].pattern.test(text)) return key;
  }

  // Check custom categories (user-defined keywords take priority)
  for (const cat of customCategories) {
    if (cat.keywords && cat.keywords.length > 0) {
      // Fix #3: Escape each keyword so special chars like "." or "+" are treated literally
      const pattern = new RegExp(cat.keywords.map(escapeRegex).join("|"), "i");
      if (pattern.test(text)) return cat.id;
    }
  }

  // Check remaining built-in patterns
  for (const key of Object.keys(builtInKeywords)) {
    if (key === "link" || key === "contact") continue;
    if (builtInKeywords[key].pattern.test(text)) return key;
  }
  return "note";
};

// ============================================================
// THEME SYSTEM
// 
// Instead of scattering color values everywhere, we define them
// in one place per theme. Every component references these.
// To add a new theme later, just add another object here!
// ============================================================
const themes = {
  light: {
    // Backgrounds
    pageBg: "#FAF7F2",
    cardBg: "#FFFFFF",
    inputBg: "#FFFFFF",
    searchBg: "#FFFFFF",
    settingsBg: "#FFFFFF",
    overlayBg: "rgba(250, 247, 242, 0.92)",
    hoverBg: "#F9F6F2",
    completedBg: "#F7F4EF",
    // Borders
    border: "#EDE8E0",
    borderHover: "#D5CEC4",
    // Text
    textPrimary: "#5C5347",
    textSecondary: "#8A7E72",
    textMuted: "#8A8278",
    // timestamps, secondary labels
    textFaint: "#9A928A",
    // placeholders, tips
    textGhost: "#A49C92",
    // filter labels, faintest UI text
    // Accents
    accent: "#6B5F53",
    accentGradient: "linear-gradient(145deg, #8A7E72, #6B5F53)",
    disabledBg: "#EDE8E0",
    disabledText: "#9A928A",
    checkColor: "#7EB5A0",
    checkBg: "#EEF7F3",
    deleteColor: "#C48B8B",
    deleteBg: "#FAF0F0",
    // Shadows
    shadowLight: "0 1px 3px rgba(140, 120, 100, 0.04)",
    shadowMedium: "0 2px 12px rgba(140, 120, 100, 0.05)",
    shadowHover: "0 4px 20px rgba(140, 120, 100, 0.08)",
    shadowImage: "0 12px 48px rgba(120, 100, 80, 0.15)",
    // Category colors
    types: {
      note: {
        color: "#9B8E7E",
        bg: "#F5F0EA"
      },
      link: {
        color: "#7E9BB5",
        bg: "#EDF3F8"
      },
      contact: {
        color: "#C49A6C",
        bg: "#FAF2E8"
      },
      reading: {
        color: "#9B8BB5",
        bg: "#F3EFF8"
      },
      food: {
        color: "#C48B8B",
        bg: "#FAF0F0"
      },
      idea: {
        color: "#7EB5A0",
        bg: "#EEF7F3"
      },
      person: {
        color: "#C49A6C",
        bg: "#FAF2E8"
      },
      photo: {
        color: "#B5A67E",
        bg: "#F7F3EA"
      },
      travel: {
        color: "#5E9EBF",
        bg: "#EBF4F8"
      },
      work: {
        color: "#8A8EB5",
        bg: "#EEEFF8"
      },
      money: {
        color: "#8AB57E",
        bg: "#EEF5EB"
      },
      health: {
        color: "#B57EA0",
        bg: "#F5EBF2"
      },
      media: {
        color: "#BF8A5E",
        bg: "#F8F0EB"
      },
      event: {
        color: "#B5A05E",
        bg: "#F5F2E8"
      },
      recommended: {
        color: "#D4A05E",
        bg: "#FBF3E8"
      }
    }
  },
  dark: {
    // Backgrounds — rich, warm darks (not cold blue-black)
    pageBg: "#1C1A17",
    cardBg: "#262320",
    inputBg: "#262320",
    searchBg: "#222019",
    settingsBg: "#262320",
    overlayBg: "rgba(28, 26, 23, 0.94)",
    hoverBg: "#2E2B27",
    completedBg: "#21201C",
    // Borders
    border: "#3A3530",
    borderHover: "#4A443D",
    // Text
    textPrimary: "#D4CFC8",
    textSecondary: "#A89E94",
    textMuted: "#A09890",
    // timestamps, secondary labels
    textFaint: "#8A827A",
    // placeholders, tips
    textGhost: "#787068",
    // filter labels, faintest UI text
    // Accents
    accent: "#D4CFC8",
    accentGradient: "linear-gradient(145deg, #A89E94, #7E756B)",
    disabledBg: "#3A3530",
    disabledText: "#8A827A",
    checkColor: "#7EB5A0",
    checkBg: "#1E2E28",
    deleteColor: "#C48B8B",
    deleteBg: "#2E2222",
    // Shadows
    shadowLight: "0 1px 3px rgba(0, 0, 0, 0.12)",
    shadowMedium: "0 2px 12px rgba(0, 0, 0, 0.15)",
    shadowHover: "0 4px 20px rgba(0, 0, 0, 0.2)",
    shadowImage: "0 12px 48px rgba(0, 0, 0, 0.4)",
    // Category colors — slightly brighter for dark bg contrast
    types: {
      note: {
        color: "#B5A898",
        bg: "#2E2A25"
      },
      link: {
        color: "#8AAFC8",
        bg: "#1E2830"
      },
      contact: {
        color: "#D4AA7C",
        bg: "#2E2518"
      },
      reading: {
        color: "#AE9BC8",
        bg: "#28202E"
      },
      food: {
        color: "#D49A9A",
        bg: "#2E2020"
      },
      idea: {
        color: "#8AC8B0",
        bg: "#1E2E25"
      },
      person: {
        color: "#D4AA7C",
        bg: "#2E2518"
      },
      photo: {
        color: "#C8B88E",
        bg: "#2E2A1E"
      },
      travel: {
        color: "#7AB8D4",
        bg: "#1A2830"
      },
      work: {
        color: "#9EA2C8",
        bg: "#22232E"
      },
      money: {
        color: "#9EC894",
        bg: "#1E2E1A"
      },
      health: {
        color: "#C898B5",
        bg: "#2E1E28"
      },
      media: {
        color: "#D4A07A",
        bg: "#2E2518"
      },
      event: {
        color: "#C8B87A",
        bg: "#2E2A1A"
      },
      recommended: {
        color: "#D4B07A",
        bg: "#2E2518"
      }
    }
  }
};
const typeLabels = {
  note: {
    icon: "◦",
    label: "Note"
  },
  link: {
    icon: "↗",
    label: "Link"
  },
  contact: {
    icon: "◯",
    label: "Contact"
  },
  reading: {
    icon: "▪",
    label: "Reading"
  },
  food: {
    icon: "◦",
    label: "Food"
  },
  idea: {
    icon: "✧",
    label: "Idea"
  },
  person: {
    icon: "◯",
    label: "Person"
  },
  photo: {
    icon: "▫",
    label: "Photo"
  },
  travel: {
    icon: "△",
    label: "Travel"
  },
  work: {
    icon: "▢",
    label: "Work"
  },
  money: {
    icon: "◇",
    label: "Money"
  },
  health: {
    icon: "♡",
    label: "Health"
  },
  media: {
    icon: "♪",
    label: "Media"
  },
  event: {
    icon: "☆",
    label: "Event"
  },
  recommended: {
    icon: "★",
    label: "Recommended"
  }
};

// ============================================================
// TYPE BORDER COLORS
//
// Each stash type gets a unique accent color for its left border
// and tinted pill backgrounds. These are earthy, muted tones
// that complement the warm Stash palette without being too loud.
// Some related types share colors (e.g., contact & person).
// ============================================================
const TYPE_COLORS = {
  note: "#8B9E6B",
  // sage green
  link: "#5B8FA8",
  // ocean blue
  contact: "#C4956A",
  // warm copper
  reading: "#7B6B8A",
  // muted purple
  food: "#D4915E",
  // terracotta
  idea: "#C9A84C",
  // golden
  person: "#C4956A",
  // warm copper (same as contact)
  photo: "#5BA88F",
  // teal green
  travel: "#5B8FA8",
  // ocean blue (same as link)
  work: "#8B7355",
  // brown
  money: "#6B8E5B",
  // forest green
  health: "#A8555B",
  // dusty rose
  media: "#7B6B8A",
  // muted purple (same as reading)
  event: "#C9A84C",
  // golden (same as idea)
  recommended: "#5BA88F" // teal green (same as photo)
};

// ============================================================
// CUSTOM CATEGORY SUPPORT
// 
// Colors for user-created categories. When someone makes a
// new category, they get the next color in this rotation.
// ============================================================
const customColorPalette = [{
  light: {
    color: "#8A7EB5",
    bg: "#F0EEF8"
  },
  dark: {
    color: "#A898C8",
    bg: "#25202E"
  }
}, {
  light: {
    color: "#5EBF8A",
    bg: "#EBF8F0"
  },
  dark: {
    color: "#7AD4A0",
    bg: "#1A2E22"
  }
}, {
  light: {
    color: "#BF5E8A",
    bg: "#F8EBF0"
  },
  dark: {
    color: "#D47AA0",
    bg: "#2E1A22"
  }
}, {
  light: {
    color: "#8ABF5E",
    bg: "#F0F8EB"
  },
  dark: {
    color: "#A0D47A",
    bg: "#222E1A"
  }
}, {
  light: {
    color: "#BF8A5E",
    bg: "#F8F0EB"
  },
  dark: {
    color: "#D4A07A",
    bg: "#2E2218"
  }
}, {
  light: {
    color: "#5E8ABF",
    bg: "#EBF0F8"
  },
  dark: {
    color: "#7AA0D4",
    bg: "#1A222E"
  }
}];

// Gets type label info, checking custom categories as a fallback
const getTypeInfo = (type, customCategories = []) => {
  if (typeLabels[type]) return typeLabels[type];
  const custom = customCategories.find(c => c.id === type);
  if (custom) return {
    icon: custom.icon || "●",
    label: custom.label
  };
  return typeLabels.note;
};

// Gets type colors, checking custom categories as a fallback
const getTypeColors = (type, theme, customCategories = []) => {
  if (theme.types[type]) return theme.types[type];
  const custom = customCategories.find(c => c.id === type);
  if (custom) {
    const palette = customColorPalette[custom.colorIndex % customColorPalette.length];
    // Detect dark mode by checking background color
    const isDark = theme.pageBg === "#1C1A17";
    return isDark ? palette.dark : palette.light;
  }
  return theme.types.note;
};

// All available types (built-in + custom) for the category selector
const getAllTypes = (customCategories = []) => {
  const builtIn = Object.keys(typeLabels);
  const custom = customCategories.map(c => c.id);
  return [...builtIn, ...custom];
};
const readFileAsBase64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

// Fix #5: Added reject + img.onerror so a broken image rejects the
// Promise instead of hanging forever (a "dangling promise" bug)
const compressImage = (dataUrl, maxWidth = 800) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    const ratio = Math.min(maxWidth / img.width, maxWidth / img.height, 1);
    canvas.width = img.width * ratio;
    canvas.height = img.height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    resolve(canvas.toDataURL("image/jpeg", 0.7));
  };
  // If the image data is corrupt or unreadable, reject so callers can handle it
  img.onerror = () => reject(new Error("Failed to load image"));
  img.src = dataUrl;
});

// ============================================================
// BUSINESS CARD OCR
// 
// Uses the Anthropic API to analyze a business card image and
// extract structured contact information. The API "sees" the
// image and returns name, title, company, phone, email, etc.
//
// We send the image as base64 and ask Claude to respond with
// JSON so we can parse it cleanly.
// ============================================================
const BACKEND_URL = "https://stash-server-production-1c71.up.railway.app";

// ============================================================
// API HELPER
//
// Wraps fetch() to handle auth and errors for all API calls.
//
// HOW AUTH WORKS NOW (httpOnly cookies):
// Instead of storing the JWT in localStorage (where any XSS
// attack could steal it), the server sets it as an httpOnly
// cookie. The browser sends this cookie automatically with
// every request — we just need to include { credentials: 'include' }
// so fetch() knows to attach cookies for cross-origin requests.
//
// Auth uses BOTH httpOnly cookies AND a Bearer token header.
// Cookies are the most secure option, but mobile Safari and some
// browsers block cross-site cookies (when frontend and backend are
// on different domains). The Bearer header is the fallback.
// The server accepts either one (checks cookie first, then header).
// ============================================================
const apiFetch = async (path, options = {}) => {
  const authToken = localStorage.getItem("stash-token");
  const headers = {
    "Content-Type": "application/json",
    ...options.headers
  };
  // Send Bearer token as fallback for browsers that block cross-site cookies
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }
  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers,
    credentials: "include" // Also send httpOnly cookies where supported
  });

  // If the server says our token is expired or invalid,
  // we need to log out and show the login screen again
  if (response.status === 401) {
    localStorage.removeItem("stash-logged-in");
    localStorage.removeItem("stash-token");
    // Dispatch a custom event so the Stash component can react
    window.dispatchEvent(new CustomEvent("auth-expired"));
    throw new Error("Session expired");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Server returned an unexpected response");
  }
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
};
const extractBusinessCard = async imageDataUrl => {
  try {
    const data = await apiFetch("/api/ocr", {
      method: "POST",
      body: JSON.stringify({
        image: imageDataUrl
      })
    });
    return data.data || null;
  } catch (err) {
    console.error("[OCR Error]", err.message);
    return null;
  }
};

// Format extracted card data into readable text
const formatCardInfo = card => {
  const lines = [];
  if (card.name) lines.push(card.name);
  if (card.title && card.company) lines.push(`${card.title} at ${card.company}`);else if (card.title) lines.push(card.title);else if (card.company) lines.push(card.company);
  if (card.phone) lines.push(card.phone);
  if (card.email) lines.push(card.email);
  if (card.website) lines.push(card.website);
  if (card.address) lines.push(card.address);
  return lines.join("\n");
};

// ============================================================
// EXPORT DATA
// 
// Creates a JSON file of all your stash data and triggers a
// browser download. We use a "Blob" (binary large object) to
// create a temporary file URL, then simulate clicking a link.
// ============================================================
const exportData = (items, settings) => {
  const exportObj = {
    exportDate: new Date().toISOString(),
    version: APP_VERSION,
    // Fix #17: references shared constant
    itemCount: items.length,
    items: items.map(({
      image,
      ...rest
    }) => ({
      ...rest,
      hasImage: !!image // Don't export full base64 images — too large
    })),
    settings: {
      timezone: settings.timezone,
      customCategories: settings.customCategories
    }
  };
  const blob = new Blob([JSON.stringify(exportObj, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stash-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Full export including images (larger file)
const exportDataFull = (items, settings) => {
  const exportObj = {
    exportDate: new Date().toISOString(),
    version: APP_VERSION,
    // Fix #17: references shared constant
    itemCount: items.length,
    items: items,
    settings: {
      timezone: settings.timezone,
      customCategories: settings.customCategories
    }
  };
  const blob = new Blob([JSON.stringify(exportObj, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stash-full-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// ============================================================
// IMAGE VIEWER
// ============================================================
// Fix #12 + #13: Added ARIA dialog attributes and Escape key handler for accessibility
const ImageViewer = ({
  src,
  onClose,
  theme
}) => /*#__PURE__*/React.createElement("div", {
  onClick: onClose,
  onKeyDown: e => {
    if (e.key === "Escape") onClose();
  },
  tabIndex: -1,
  ref: el => el && el.focus(),
  role: "dialog",
  "aria-modal": "true",
  "aria-label": "Image viewer",
  style: {
    position: "fixed",
    inset: 0,
    background: theme.overlayBg,
    backdropFilter: "blur(20px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    cursor: "zoom-out",
    animation: "softFadeIn 0.3s ease",
    outline: "none"
  }
}, /*#__PURE__*/React.createElement("img", {
  src: src,
  alt: "Enlarged",
  style: {
    maxWidth: "88vw",
    maxHeight: "85vh",
    borderRadius: "16px",
    boxShadow: theme.shadowImage
  }
}), /*#__PURE__*/React.createElement("div", {
  style: {
    position: "absolute",
    top: "24px",
    right: "28px",
    color: theme.textMuted,
    fontSize: "13px",
    fontFamily: "'Lora', serif",
    fontStyle: "italic"
  }
}, "tap anywhere to close"));

// ============================================================
// SETTINGS PANEL
// 
// This introduces "conditional rendering" — the panel only
// shows when settingsOpen is true. It slides in with an animation.
// ============================================================
// ============================================================
// CUSTOM CATEGORY FORM
// A mini form inside settings to create new categories
// ============================================================
const CustomCategoryForm = ({
  onAdd,
  theme
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState("●");
  const [keywords, setKeywords] = useState("");
  const handleAdd = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const kwList = keywords.split(/[,\s]+/).map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
    onAdd({
      label: trimmed,
      icon,
      keywords: kwList
    });
    setLabel("");
    setIcon("●");
    setKeywords("");
    setIsOpen(false);
  };
  if (!isOpen) {
    return /*#__PURE__*/React.createElement("button", {
      onClick: () => setIsOpen(true),
      style: {
        background: "none",
        border: `1px dashed ${theme.border}`,
        color: theme.textMuted,
        cursor: "pointer",
        borderRadius: "10px",
        padding: "8px 14px",
        width: "100%",
        fontSize: "13px",
        fontFamily: "'DM Sans', sans-serif",
        fontStyle: "italic",
        transition: "all 0.2s ease"
      },
      onMouseEnter: e => {
        e.currentTarget.style.borderColor = theme.borderHover;
        e.currentTarget.style.color = theme.textSecondary;
      },
      onMouseLeave: e => {
        e.currentTarget.style.borderColor = theme.border;
        e.currentTarget.style.color = theme.textMuted;
      }
    }, "+ add category");
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: theme.hoverBg,
      borderRadius: "12px",
      padding: "14px",
      animation: "softFadeIn 0.2s ease"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "8px",
      marginBottom: "8px"
    }
  }, /*#__PURE__*/React.createElement("select", {
    value: icon,
    onChange: e => setIcon(e.target.value),
    style: {
      background: theme.cardBg,
      border: `1px solid ${theme.border}`,
      borderRadius: "8px",
      padding: "6px 8px",
      width: "48px",
      color: theme.textPrimary,
      fontSize: "14px",
      textAlign: "center",
      cursor: "pointer",
      appearance: "none",
      WebkitAppearance: "none"
    }
  }, ["●", "★", "♦", "▲", "■", "♥", "⬟", "◆", "⊕", "⌂"].map(i => /*#__PURE__*/React.createElement("option", {
    key: i,
    value: i
  }, i))), /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: label,
    onChange: e => setLabel(e.target.value),
    placeholder: "Category name",
    maxLength: 20,
    style: {
      flex: 1,
      background: theme.cardBg,
      border: `1px solid ${theme.border}`,
      borderRadius: "8px",
      padding: "6px 12px",
      color: theme.textPrimary,
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      outline: "none"
    }
  })), /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: keywords,
    onChange: e => setKeywords(e.target.value),
    placeholder: "Auto-detect keywords (comma separated)",
    style: {
      width: "100%",
      background: theme.cardBg,
      border: `1px solid ${theme.border}`,
      borderRadius: "8px",
      padding: "6px 12px",
      marginBottom: "10px",
      color: theme.textMuted,
      fontSize: "12px",
      fontFamily: "'DM Sans', sans-serif",
      outline: "none"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "8px"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: handleAdd,
    disabled: !label.trim(),
    style: {
      background: label.trim() ? theme.accentGradient : theme.disabledBg,
      border: "none",
      color: label.trim() ? "#FAF7F2" : theme.disabledText,
      borderRadius: "8px",
      padding: "6px 16px",
      fontSize: "12px",
      fontFamily: "'DM Sans', sans-serif",
      fontWeight: 500,
      cursor: label.trim() ? "pointer" : "default"
    }
  }, "Create"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setIsOpen(false);
      setLabel("");
      setKeywords("");
    },
    style: {
      background: "none",
      border: `1px solid ${theme.border}`,
      color: theme.textMuted,
      borderRadius: "8px",
      padding: "6px 16px",
      fontSize: "12px",
      fontFamily: "'DM Sans', sans-serif",
      cursor: "pointer"
    }
  }, "Cancel")));
};
const SettingsPanel = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  theme,
  itemCount,
  completedCount,
  onExport,
  onExportFull,
  onImport,
  onLogout,
  onSaveDigestSettings
}) => {
  // Change Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");

  // Delete Account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const handleChangePassword = async e => {
    e.preventDefault();
    setPwError("");
    setPwSuccess("");

    // Client-side validation
    if (newPassword.length < 8) {
      setPwError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError("New passwords do not match");
      return;
    }
    setPwLoading(true);
    try {
      const data = await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword,
          newPassword
        })
      });
      // The server sets a fresh httpOnly cookie automatically —
      // no need to store the token in localStorage anymore.
      setPwSuccess("Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPwSuccess(""), 3000);
    } catch (err) {
      setPwError(err.message);
    } finally {
      setPwLoading(false);
    }
  };
  const handleDeleteAccount = async () => {
    setDeleteError("");
    setDeleteLoading(true);
    try {
      await apiFetch("/api/auth/account", {
        method: "DELETE",
        body: JSON.stringify({
          password: deletePassword
        })
      });
      // Clear login indicator and redirect to login
      // (the server already cleared the httpOnly cookie)
      localStorage.removeItem("stash-token");
      localStorage.removeItem("stash-logged-in");
      if (onLogout) onLogout();
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleteLoading(false);
    }
  };
  if (!isOpen) return null;
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    onKeyDown: e => {
      if (e.key === "Escape") onClose();
    },
    tabIndex: -1,
    ref: el => el && el.focus(),
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "Settings",
    style: {
      position: "fixed",
      inset: 0,
      background: theme.overlayBg,
      backdropFilter: "blur(16px)",
      zIndex: 900,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      animation: "softFadeIn 0.25s ease",
      outline: "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      background: theme.settingsBg,
      borderRadius: "24px",
      border: `1px solid ${theme.border}`,
      padding: "36px 32px",
      width: "92%",
      maxWidth: "420px",
      maxHeight: "85vh",
      overflowY: "auto",
      boxShadow: theme.shadowHover,
      animation: "settingsIn 0.35s ease"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "28px"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "22px",
      fontWeight: 400,
      margin: 0,
      color: theme.textSecondary
    }
  }, "Settings"), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    "aria-label": "Close",
    style: {
      background: "none",
      border: "none",
      color: theme.textGhost,
      fontSize: "20px",
      cursor: "pointer",
      padding: "4px 8px",
      borderRadius: "8px",
      transition: "all 0.2s ease"
    },
    onMouseEnter: e => {
      e.currentTarget.style.color = theme.textMuted;
      e.currentTarget.style.background = theme.hoverBg;
    },
    onMouseLeave: e => {
      e.currentTarget.style.color = theme.textGhost;
      e.currentTarget.style.background = "none";
    }
  }, "\xD7")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "16px 0",
      borderBottom: `1px solid ${theme.border}`
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "14.5px",
      color: theme.textPrimary,
      fontWeight: 500,
      marginBottom: "3px"
    }
  }, "Dark mode"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "12.5px",
      color: theme.textFaint,
      fontStyle: "italic"
    }
  }, "Easier on the eyes at night")), /*#__PURE__*/React.createElement("button", {
    onClick: () => onUpdateSettings({
      ...settings,
      darkMode: !settings.darkMode
    }),
    style: {
      width: "48px",
      height: "28px",
      borderRadius: "14px",
      background: settings.darkMode ? theme.checkColor : theme.disabledBg,
      border: "none",
      cursor: "pointer",
      position: "relative",
      transition: "background 0.3s ease",
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "22px",
      height: "22px",
      borderRadius: "50%",
      background: "#FFFFFF",
      position: "absolute",
      top: "3px",
      left: settings.darkMode ? "23px" : "3px",
      transition: "left 0.3s ease",
      boxShadow: "0 1px 4px rgba(0,0,0,0.15)"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "16px 0",
      borderBottom: `1px solid ${theme.border}`
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "14.5px",
      color: theme.textPrimary,
      fontWeight: 500,
      marginBottom: "3px"
    }
  }, "Auto-archive completed"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "12.5px",
      color: theme.textFaint,
      fontStyle: "italic"
    }
  }, "Hide checked-off items after a while")), /*#__PURE__*/React.createElement("select", {
    value: settings.autoArchiveDays,
    onChange: e => onUpdateSettings({
      ...settings,
      autoArchiveDays: Number(e.target.value)
    }),
    style: {
      background: theme.hoverBg,
      border: `1px solid ${theme.border}`,
      borderRadius: "10px",
      padding: "7px 12px",
      color: theme.textSecondary,
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      cursor: "pointer",
      appearance: "none",
      WebkitAppearance: "none",
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: 0
  }, "Never"), /*#__PURE__*/React.createElement("option", {
    value: 1
  }, "After 1 day"), /*#__PURE__*/React.createElement("option", {
    value: 7
  }, "After 7 days"), /*#__PURE__*/React.createElement("option", {
    value: 30
  }, "After 30 days"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "16px 0",
      borderBottom: `1px solid ${theme.border}`
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "14.5px",
      color: theme.textPrimary,
      fontWeight: 500,
      marginBottom: "3px"
    }
  }, "Show completed items"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "12.5px",
      color: theme.textFaint,
      fontStyle: "italic"
    }
  }, "Keep checked-off items visible in your feed")), /*#__PURE__*/React.createElement("button", {
    onClick: () => onUpdateSettings({
      ...settings,
      showCompleted: !settings.showCompleted
    }),
    style: {
      width: "48px",
      height: "28px",
      borderRadius: "14px",
      background: settings.showCompleted ? theme.checkColor : theme.disabledBg,
      border: "none",
      cursor: "pointer",
      position: "relative",
      transition: "background 0.3s ease",
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "22px",
      height: "22px",
      borderRadius: "50%",
      background: "#FFFFFF",
      position: "absolute",
      top: "3px",
      left: settings.showCompleted ? "23px" : "3px",
      transition: "left 0.3s ease",
      boxShadow: "0 1px 4px rgba(0,0,0,0.15)"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "16px 0",
      borderBottom: `1px solid ${theme.border}`
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "14.5px",
      color: theme.textPrimary,
      fontWeight: 500,
      marginBottom: "3px"
    }
  }, "Timezone"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "12.5px",
      color: theme.textFaint,
      fontStyle: "italic"
    }
  }, "Timestamps display in 24-hour format")), /*#__PURE__*/React.createElement("select", {
    value: settings.timezone,
    onChange: e => onUpdateSettings({
      ...settings,
      timezone: e.target.value
    }),
    style: {
      background: theme.hoverBg,
      border: `1px solid ${theme.border}`,
      borderRadius: "10px",
      padding: "7px 12px",
      color: theme.textSecondary,
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      cursor: "pointer",
      appearance: "none",
      WebkitAppearance: "none",
      flexShrink: 0
    }
  }, timezoneOptions.map(tz => /*#__PURE__*/React.createElement("option", {
    key: tz.value,
    value: tz.value
  }, tz.label)))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "16px 0",
      borderBottom: `1px solid ${theme.border}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "14.5px",
      color: theme.textPrimary,
      fontWeight: 500,
      marginBottom: "3px"
    }
  }, "Custom categories"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "12.5px",
      color: theme.textFaint,
      fontStyle: "italic",
      marginBottom: "12px"
    }
  }, "Create your own with auto-detect keywords"), settings.customCategories.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      marginBottom: "12px"
    }
  }, settings.customCategories.map(cat => {
    const colors = getTypeColors(cat.id, theme, settings.customCategories);
    return /*#__PURE__*/React.createElement("div", {
      key: cat.id,
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: theme.hoverBg,
        borderRadius: "10px",
        padding: "8px 12px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: "8px"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: "11px",
        color: colors.color,
        background: colors.bg,
        padding: "3px 10px",
        borderRadius: "20px",
        fontFamily: "'DM Sans', sans-serif",
        fontWeight: 500
      }
    }, cat.label), cat.keywords.length > 0 && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: "11px",
        color: theme.textGhost,
        fontFamily: "'DM Sans', sans-serif",
        fontStyle: "italic"
      }
    }, cat.keywords.slice(0, 3).join(", "), cat.keywords.length > 3 ? "…" : "")), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        onUpdateSettings({
          ...settings,
          customCategories: settings.customCategories.filter(c => c.id !== cat.id)
        });
      },
      style: {
        background: "none",
        border: "none",
        color: theme.textGhost,
        cursor: "pointer",
        fontSize: "14px",
        padding: "2px 6px",
        borderRadius: "6px",
        transition: "all 0.2s ease"
      },
      onMouseEnter: e => {
        e.currentTarget.style.color = theme.deleteColor;
      },
      onMouseLeave: e => {
        e.currentTarget.style.color = theme.textGhost;
      }
    }, "\xD7"));
  })), /*#__PURE__*/React.createElement(CustomCategoryForm, {
    onAdd: cat => {
      // Fix #16: Prevent custom category IDs from colliding with
      // built-in types (e.g. a category called "Note" would clash
      // with the built-in "note" type) or existing custom categories
      const builtInTypes = ["note", "link", "task", "event", "contact", "address", "code", "photo", "finance", "recipe", "health", "recommended", "reading", "food", "idea", "person", "travel", "work", "money", "media"];
      let newId = cat.label.toLowerCase().replace(/\s+/g, "_");
      if (builtInTypes.includes(newId)) {
        newId = "custom_" + newId; // prefix to avoid collision
      }
      // Also check for duplicates against existing custom categories
      if (settings.customCategories.some(c => c.id === newId)) {
        alert(`A category with the ID "${newId}" already exists.`);
        return;
      }
      onUpdateSettings({
        ...settings,
        customCategories: [...settings.customCategories, {
          ...cat,
          id: newId,
          colorIndex: settings.customCategories.length
        }]
      });
    },
    theme: theme
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "20px 0 4px",
      display: "flex",
      gap: "24px"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "24px",
      color: theme.textSecondary,
      fontWeight: 400
    }
  }, itemCount), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "12px",
      color: theme.textFaint,
      fontStyle: "italic"
    }
  }, "stashed")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "24px",
      color: theme.checkColor,
      fontWeight: 400
    }
  }, completedCount), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "12px",
      color: theme.textFaint,
      fontStyle: "italic"
    }
  }, "completed"))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "16px 0",
      borderTop: `1px solid ${theme.border}`,
      marginTop: "16px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "14.5px",
      color: theme.textPrimary,
      fontWeight: 500,
      marginBottom: "3px"
    }
  }, "Email Digest"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "12.5px",
      color: theme.textFaint,
      fontStyle: "italic",
      marginBottom: "16px"
    }
  }, "Get a summary of your recent stashes by email"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: "16px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "12.5px",
      color: theme.textMuted,
      marginBottom: "8px"
    }
  }, "Frequency"), [{
    value: "daily",
    label: "Daily"
  }, {
    value: "weekly",
    label: "Weekly"
  }, {
    value: "none",
    label: "Off"
  }].map(opt => /*#__PURE__*/React.createElement("label", {
    key: opt.value,
    style: {
      display: "inline-flex",
      alignItems: "center",
      marginRight: "16px",
      cursor: "pointer",
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      color: theme.textSecondary
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "radio",
    name: "digestFrequency",
    value: opt.value,
    checked: settings.digestFrequency === opt.value,
    onChange: () => {
      // Update local state immediately (for instant UI feedback)
      onUpdateSettings({
        ...settings,
        digestFrequency: opt.value
      });
      // Also save to server (for the digest worker to read)
      onSaveDigestSettings({
        digest_frequency: opt.value
      });
    },
    style: {
      marginRight: "6px"
    }
  }), opt.label))), settings.digestFrequency !== "none" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: "16px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "12.5px",
      color: theme.textMuted,
      marginBottom: "8px"
    }
  }, "Send at"), /*#__PURE__*/React.createElement("select", {
    value: settings.digestTime,
    onChange: e => {
      onUpdateSettings({
        ...settings,
        digestTime: e.target.value
      });
      onSaveDigestSettings({
        digest_time: e.target.value
      });
    },
    style: {
      background: theme.hoverBg,
      border: `1px solid ${theme.border}`,
      borderRadius: "10px",
      padding: "7px 12px",
      color: theme.textSecondary,
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      cursor: "pointer",
      appearance: "none",
      WebkitAppearance: "none",
      width: "100%",
      maxWidth: "200px"
    }
  }, DIGEST_TIMES.map(t => /*#__PURE__*/React.createElement("option", {
    key: t,
    value: t
  }, parseInt(t) === 0 ? "12:00 AM" : parseInt(t) < 12 ? `${parseInt(t)}:00 AM` : parseInt(t) === 12 ? "12:00 PM" : `${parseInt(t) - 12}:00 PM`)))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: "4px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "12.5px",
      color: theme.textMuted,
      marginBottom: "8px"
    }
  }, "Timezone"), /*#__PURE__*/React.createElement("select", {
    value: settings.digestTimezone,
    onChange: e => {
      onUpdateSettings({
        ...settings,
        digestTimezone: e.target.value
      });
      onSaveDigestSettings({
        timezone: e.target.value
      });
    },
    style: {
      background: theme.hoverBg,
      border: `1px solid ${theme.border}`,
      borderRadius: "10px",
      padding: "7px 12px",
      color: theme.textSecondary,
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      cursor: "pointer",
      appearance: "none",
      WebkitAppearance: "none",
      width: "100%",
      maxWidth: "280px"
    }
  }, DIGEST_TIMEZONES.map(tz => /*#__PURE__*/React.createElement("option", {
    key: tz.value,
    value: tz.value
  }, tz.label)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "16px 0 4px",
      borderTop: `1px solid ${theme.border}`,
      marginTop: "16px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "14.5px",
      color: theme.textPrimary,
      fontWeight: 500,
      marginBottom: "3px"
    }
  }, "Export your data"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "12.5px",
      color: theme.textFaint,
      fontStyle: "italic",
      marginBottom: "12px"
    }
  }, "Download a backup of all your stashes"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "8px"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onExport,
    style: {
      background: theme.hoverBg,
      border: `1px solid ${theme.border}`,
      color: theme.textSecondary,
      borderRadius: "10px",
      padding: "8px 16px",
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      cursor: "pointer",
      transition: "all 0.2s ease"
    },
    onMouseEnter: e => {
      e.currentTarget.style.borderColor = theme.borderHover;
    },
    onMouseLeave: e => {
      e.currentTarget.style.borderColor = theme.border;
    }
  }, "Text backup"), /*#__PURE__*/React.createElement("button", {
    onClick: onExportFull,
    style: {
      background: theme.hoverBg,
      border: `1px solid ${theme.border}`,
      color: theme.textSecondary,
      borderRadius: "10px",
      padding: "8px 16px",
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      cursor: "pointer",
      transition: "all 0.2s ease"
    },
    onMouseEnter: e => {
      e.currentTarget.style.borderColor = theme.borderHover;
    },
    onMouseLeave: e => {
      e.currentTarget.style.borderColor = theme.border;
    }
  }, "Full backup (with images)"))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "16px 0 4px",
      borderTop: `1px solid ${theme.border}`,
      marginTop: "16px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "14.5px",
      color: theme.textPrimary,
      fontWeight: 500,
      marginBottom: "3px"
    }
  }, "Import backup"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "12.5px",
      color: theme.textFaint,
      fontStyle: "italic",
      marginBottom: "12px"
    }
  }, "Restore from a previously exported backup file"), /*#__PURE__*/React.createElement("label", {
    style: {
      display: "inline-block",
      background: theme.hoverBg,
      border: `1px solid ${theme.border}`,
      color: theme.textSecondary,
      borderRadius: "10px",
      padding: "8px 16px",
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      cursor: "pointer",
      transition: "all 0.2s ease"
    }
  }, "Choose file\u2026", /*#__PURE__*/React.createElement("input", {
    type: "file",
    accept: ".json",
    style: {
      display: "none"
    },
    onChange: e => {
      const file = e.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = evt => {
          try {
            const data = JSON.parse(evt.target.result);
            onImport(data);
          } catch (err) {
            alert("Couldn't read that file. Make sure it's a Stash backup (.json).");
          }
        };
        reader.readAsText(file);
      }
      e.target.value = "";
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "16px 0 4px",
      borderTop: `1px solid ${theme.border}`,
      marginTop: "16px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "14.5px",
      color: theme.textPrimary,
      fontWeight: 500,
      marginBottom: "3px"
    }
  }, "Change password"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "12.5px",
      color: theme.textFaint,
      fontStyle: "italic",
      marginBottom: "14px"
    }
  }, "Update your account password"), /*#__PURE__*/React.createElement("form", {
    onSubmit: handleChangePassword
  }, /*#__PURE__*/React.createElement("input", {
    type: "password",
    value: currentPassword,
    onChange: e => {
      setCurrentPassword(e.target.value);
      setPwError("");
    },
    placeholder: "Current password",
    required: true,
    autoComplete: "current-password",
    style: {
      width: "100%",
      padding: "10px 12px",
      borderRadius: "10px",
      border: `1px solid ${theme.border}`,
      background: theme.inputBg,
      color: theme.textPrimary,
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "13px",
      outline: "none",
      boxSizing: "border-box",
      marginBottom: "8px"
    }
  }), /*#__PURE__*/React.createElement("input", {
    type: "password",
    value: newPassword,
    onChange: e => {
      setNewPassword(e.target.value);
      setPwError("");
    },
    placeholder: "New password (8+ characters)",
    required: true,
    autoComplete: "new-password",
    style: {
      width: "100%",
      padding: "10px 12px",
      borderRadius: "10px",
      border: `1px solid ${theme.border}`,
      background: theme.inputBg,
      color: theme.textPrimary,
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "13px",
      outline: "none",
      boxSizing: "border-box",
      marginBottom: "8px"
    }
  }), /*#__PURE__*/React.createElement("input", {
    type: "password",
    value: confirmPassword,
    onChange: e => {
      setConfirmPassword(e.target.value);
      setPwError("");
    },
    placeholder: "Confirm new password",
    required: true,
    autoComplete: "new-password",
    style: {
      width: "100%",
      padding: "10px 12px",
      borderRadius: "10px",
      border: `1px solid ${theme.border}`,
      background: theme.inputBg,
      color: theme.textPrimary,
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "13px",
      outline: "none",
      boxSizing: "border-box",
      marginBottom: "10px"
    }
  }), pwError && /*#__PURE__*/React.createElement("div", {
    style: {
      color: theme.deleteColor,
      fontSize: "12.5px",
      fontFamily: "'DM Sans', sans-serif",
      marginBottom: "8px"
    }
  }, pwError), pwSuccess && /*#__PURE__*/React.createElement("div", {
    style: {
      color: theme.checkColor,
      fontSize: "12.5px",
      fontFamily: "'DM Sans', sans-serif",
      marginBottom: "8px"
    }
  }, pwSuccess), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    disabled: pwLoading,
    style: {
      background: pwLoading ? theme.disabledBg : theme.hoverBg,
      border: `1px solid ${theme.border}`,
      color: pwLoading ? theme.disabledText : theme.textSecondary,
      borderRadius: "10px",
      padding: "8px 16px",
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      cursor: pwLoading ? "default" : "pointer",
      transition: "all 0.2s ease"
    }
  }, pwLoading ? "Changing..." : "Change password"))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "16px",
      borderTop: `1px solid ${theme.border}`,
      marginTop: "20px",
      border: `1px solid ${theme.deleteColor}`,
      borderRadius: "14px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "14.5px",
      color: theme.deleteColor,
      fontWeight: 500,
      marginBottom: "3px"
    }
  }, "Danger zone"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "12.5px",
      color: theme.textFaint,
      fontStyle: "italic",
      marginBottom: "12px"
    }
  }, "Irreversible actions"), !showDeleteConfirm ? /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowDeleteConfirm(true),
    style: {
      background: "none",
      border: `1px solid ${theme.deleteColor}`,
      color: theme.deleteColor,
      borderRadius: "10px",
      padding: "8px 16px",
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      cursor: "pointer",
      transition: "background 0.2s ease"
    },
    onMouseEnter: e => e.currentTarget.style.background = theme.deleteBg,
    onMouseLeave: e => e.currentTarget.style.background = "none"
  }, "Delete account") : /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "13px",
      color: theme.deleteColor,
      marginBottom: "12px",
      lineHeight: 1.5
    }
  }, "This will permanently delete your account and all your stashes. This cannot be undone."), /*#__PURE__*/React.createElement("input", {
    type: "password",
    value: deletePassword,
    onChange: e => {
      setDeletePassword(e.target.value);
      setDeleteError("");
    },
    placeholder: "Enter your password to confirm",
    autoComplete: "current-password",
    style: {
      width: "100%",
      padding: "10px 12px",
      borderRadius: "10px",
      border: `1px solid ${theme.deleteColor}`,
      background: theme.inputBg,
      color: theme.textPrimary,
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "13px",
      outline: "none",
      boxSizing: "border-box",
      marginBottom: "10px"
    }
  }), deleteError && /*#__PURE__*/React.createElement("div", {
    style: {
      color: theme.deleteColor,
      fontSize: "12.5px",
      fontFamily: "'DM Sans', sans-serif",
      marginBottom: "8px"
    }
  }, deleteError), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "8px"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setShowDeleteConfirm(false);
      setDeletePassword("");
      setDeleteError("");
    },
    style: {
      flex: 1,
      padding: "10px",
      borderRadius: "10px",
      border: `1px solid ${theme.border}`,
      background: "none",
      color: theme.textSecondary,
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "13px",
      cursor: "pointer"
    }
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    onClick: handleDeleteAccount,
    disabled: !deletePassword || deleteLoading,
    style: {
      flex: 1,
      padding: "10px",
      borderRadius: "10px",
      border: "none",
      background: !deletePassword || deleteLoading ? theme.disabledBg : theme.deleteColor,
      color: !deletePassword || deleteLoading ? theme.disabledText : "#FFFFFF",
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "13px",
      fontWeight: 500,
      cursor: !deletePassword || deleteLoading ? "default" : "pointer"
    }
  }, deleteLoading ? "Deleting..." : "Delete my account")))), onLogout && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "28px",
      paddingTop: "20px",
      borderTop: `1px solid ${theme.border}`
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onLogout,
    style: {
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
      transition: "background 0.2s ease"
    },
    onMouseEnter: e => e.currentTarget.style.background = theme.deleteBg,
    onMouseLeave: e => e.currentTarget.style.background = "none"
  }, "Log out"))));
};

// ============================================================
// HIGHLIGHT TEXT
//
// Wraps matching portions of text in a highlighted <mark> tag.
// Used when the search bar has a query — matching text gets a
// colored background so you can see exactly why each card appeared.
//
// How it works:
// 1. Split the text using the search query as a delimiter
// 2. The parts that DON'T match render as plain text
// 3. The parts that DO match render inside a <mark> tag
// 4. The regex uses "gi" flags: g = all matches, i = case-insensitive
// ============================================================
const HighlightText = ({
  text,
  query,
  theme
}) => {
  // If there's no search query or no text, just return the text as-is.
  // This means highlighting has ZERO cost when nobody is searching.
  if (!query || !text) return text || null;

  // Escape special regex characters in the query so searching for
  // "test (1)" doesn't break — the parens would be regex syntax otherwise
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');

  // Split the text on the search query. The capturing group "()" in the
  // regex means the matched parts are KEPT in the resulting array.
  // Example: "Hello World".split(/(World)/gi) => ["Hello ", "World", ""]
  const parts = String(text).split(regex);
  if (parts.length === 1) return text; // no match found, return plain text

  return parts.map((part, i) =>
  // regex.test() checks if this part is a match (case-insensitive).
  // NOTE: We recreate the test each time because regex with "g" flag
  // has internal state (lastIndex). Using a fresh test each iteration
  // avoids that gotcha.
  new RegExp(`^${escaped}$`, 'i').test(part) ? /*#__PURE__*/React.createElement("mark", {
    key: i,
    style: {
      backgroundColor: theme?.accent ? theme.accent + '33' : '#C9A84C33',
      color: 'inherit',
      borderRadius: '2px',
      padding: '0 2px'
    }
  }, part) : part);
};

// ============================================================
// REMINDER PICKER
//
// A small modal that appears when you click "Remind" on a card.
// Offers preset quick-pick times (1hr, 3hr, tomorrow, next week)
// plus a custom date/time input. Using presets is much faster
// than manually picking a date — most reminders are "soon."
//
// NEW CONCEPT: "Notification API"
// Browsers can show native notifications (the ones that pop up
// in your OS notification center). We must ASK for permission
// first. If the user denies it, reminders still work internally
// but won't show a system notification.
// ============================================================
const ReminderPicker = ({
  onPick,
  onClose,
  theme
}) => {
  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState("");

  // Presets give users one-tap options for common reminder intervals.
  // Each preset either uses a millisecond offset (ms) or a getDate()
  // function for absolute times (like "tomorrow at 9 AM").
  const presets = [{
    label: "In 1 hour",
    ms: 60 * 60 * 1000
  }, {
    label: "In 3 hours",
    ms: 3 * 60 * 60 * 1000
  }, {
    label: "Tomorrow 9 AM",
    getDate: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    }
  }, {
    label: "Next week",
    getDate: () => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      d.setHours(9, 0, 0, 0);
      return d;
    }
  }];
  return (
    /*#__PURE__*/
    // Outer overlay — clicking the backdrop closes the picker
    React.createElement("div", {
      onClick: onClose,
      style: {
        position: "fixed",
        inset: 0,
        background: theme.overlayBg,
        backdropFilter: "blur(8px)",
        zIndex: 950,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: "softFadeIn 0.2s ease"
      }
    }, /*#__PURE__*/React.createElement("div", {
      onClick: e => e.stopPropagation(),
      style: {
        background: theme.settingsBg,
        borderRadius: "20px",
        border: `1px solid ${theme.border}`,
        padding: "28px 24px",
        width: "92%",
        maxWidth: "340px",
        boxShadow: theme.shadowHover,
        animation: "settingsIn 0.3s ease"
      }
    }, /*#__PURE__*/React.createElement("h3", {
      style: {
        fontFamily: "'Lora', serif",
        fontSize: "18px",
        fontWeight: 400,
        color: theme.textSecondary,
        margin: "0 0 18px"
      }
    }, "Set Reminder"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        marginBottom: "18px"
      }
    }, presets.map(preset => /*#__PURE__*/React.createElement("button", {
      key: preset.label,
      onClick: () => {
        // If the preset has a getDate function, use it;
        // otherwise add the ms offset to "right now"
        const date = preset.getDate ? preset.getDate() : new Date(Date.now() + preset.ms);
        onPick(date.toISOString());
      },
      style: {
        background: theme.hoverBg,
        border: `1px solid ${theme.border}`,
        color: theme.textSecondary,
        borderRadius: "10px",
        padding: "10px 16px",
        fontSize: "13px",
        fontFamily: "'DM Sans', sans-serif",
        cursor: "pointer",
        textAlign: "left",
        transition: "all 0.2s ease"
      },
      onMouseEnter: e => {
        e.currentTarget.style.borderColor = theme.borderHover;
      },
      onMouseLeave: e => {
        e.currentTarget.style.borderColor = theme.border;
      }
    }, preset.label))), /*#__PURE__*/React.createElement("div", {
      style: {
        borderTop: `1px solid ${theme.border}`,
        paddingTop: "16px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "12px",
        color: theme.textMuted,
        marginBottom: "8px",
        fontWeight: 500
      }
    }, "Custom time"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: "8px",
        marginBottom: "10px"
      }
    }, /*#__PURE__*/React.createElement("input", {
      type: "date",
      value: customDate,
      onChange: e => setCustomDate(e.target.value),
      style: {
        flex: 1,
        background: theme.hoverBg,
        border: `1px solid ${theme.border}`,
        borderRadius: "8px",
        padding: "7px 10px",
        color: theme.textPrimary,
        fontSize: "12px",
        fontFamily: "'DM Sans', sans-serif"
      }
    }), /*#__PURE__*/React.createElement("input", {
      type: "time",
      value: customTime,
      onChange: e => setCustomTime(e.target.value),
      style: {
        width: "110px",
        background: theme.hoverBg,
        border: `1px solid ${theme.border}`,
        borderRadius: "8px",
        padding: "7px 10px",
        color: theme.textPrimary,
        fontSize: "12px",
        fontFamily: "'DM Sans', sans-serif"
      }
    })), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        if (customDate && customTime) {
          // Combine date + time into a full ISO string
          const parsed = new Date(`${customDate}T${customTime}`);
          if (isNaN(parsed.getTime())) return; // guard against invalid date
          onPick(parsed.toISOString());
        }
      },
      disabled: !customDate || !customTime,
      style: {
        background: customDate && customTime ? theme.accentGradient : theme.disabledBg,
        border: "none",
        color: customDate && customTime ? "#FAF7F2" : theme.disabledText,
        borderRadius: "10px",
        padding: "8px 18px",
        fontSize: "13px",
        fontFamily: "'DM Sans', sans-serif",
        fontWeight: 500,
        cursor: customDate && customTime ? "pointer" : "default"
      }
    }, "Set reminder")), /*#__PURE__*/React.createElement("button", {
      onClick: onClose,
      style: {
        display: "block",
        margin: "16px auto 0",
        background: "none",
        border: "none",
        color: theme.textGhost,
        fontSize: "13px",
        fontFamily: "'DM Sans', sans-serif",
        cursor: "pointer"
      }
    }, "Cancel")))
  );
};

// ============================================================
// STASH CARD — with inline editing!
//
// NEW CONCEPT: "Inline editing"
// Instead of opening a separate edit screen (like a modal or
// new page), we transform the card ITSELF into an editable
// state. The content text becomes a textarea, tags become
// editable, and Save/Cancel buttons appear.
//
// This uses a LOCAL state (isEditing) inside the component.
// The card manages its own edit mode independently — this is
// called "component-level state" vs "app-level state."
// ============================================================
const StashCard = ({
  item,
  onDelete,
  onToggleComplete,
  onEdit,
  onViewImage,
  onTogglePin,
  onSetReminder,
  onScanCard,
  isScanning,
  theme,
  timezone,
  customCategories,
  isSlidingOut,
  bulkMode,
  isSelected,
  onToggleBulkSelect,
  searchQuery
}) => {
  const typeInfo = getTypeInfo(item.type, customCategories);
  const typeColors = getTypeColors(item.type, theme, customCategories);
  const isCompleted = item.completed;

  // LOCAL state — only this card knows if it's being edited
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(item.content);
  const [editTags, setEditTags] = useState(item.tags.join(", "));
  const [copied, setCopied] = useState(false);
  const editRef = useRef(null);
  const isContact = item.type === "contact" || item.type === "person" || item.ocrData;
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(item.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = item.content;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // When entering edit mode, focus the textarea
  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.focus();
      // Move cursor to end of text
      editRef.current.selectionStart = editRef.current.value.length;
    }
  }, [isEditing]);
  const startEditing = () => {
    if (isCompleted) return; // don't allow editing completed items
    setEditContent(item.content);
    setEditTags(item.tags.join(", "));
    setIsEditing(true);
  };
  const cancelEditing = () => {
    setIsEditing(false);
    setEditContent(item.content);
    setEditTags(item.tags.join(", "));
  };
  const saveEdit = () => {
    const newContent = editContent.trim();
    if (!newContent && !item.image) {
      cancelEditing();
      return;
    }

    // Parse tags: support both "tag1, tag2" and "#tag1 #tag2" formats
    const newTags = editTags.split(/[,\s]+/).map(t => t.replace(/^#/, "").trim().toLowerCase()).filter(t => t.length > 0);
    onEdit(item.id, {
      content: newContent,
      tags: newTags,
      type: item.image ? "photo" : detectType(newContent, customCategories)
    });
    setIsEditing(false);
  };
  const handleEditKeyDown = e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      saveEdit();
    }
    if (e.key === "Escape") {
      cancelEditing();
    }
  };
  return /*#__PURE__*/React.createElement("div", {
    onClick: bulkMode ? () => onToggleBulkSelect(item.id) : undefined,
    style: {
      background: isEditing ? theme.cardBg : isSelected ? theme.pageBg === "#1C1A17" ? "#2A2724" : "#F0EDE6" : isCompleted ? theme.completedBg : theme.cardBg,
      borderRadius: "16px",
      padding: "16px 18px",
      marginBottom: "8px",
      border: `1px solid ${isSelected ? theme.accent + "66" : isEditing ? theme.borderHover : item.pinned ? theme.checkColor + "44" : theme.border}`,
      /* Smooth transitions for hover effects (shadow lift + color shifts) */
      transition: "box-shadow 0.2s ease, transform 0.2s ease, border-color 0.35s ease, background 0.35s ease",
      cursor: bulkMode ? "pointer" : "default",
      animation: isSlidingOut ? "slideOut 0.3s ease forwards" : "cardIn 0.4s ease forwards",
      position: "relative",
      opacity: isCompleted && !isSlidingOut ? 0.6 : 1,
      boxShadow: isEditing ? theme.shadowHover : isCompleted ? "none" : theme.shadowLight,
      /* Color-coded left border: pinned items use green, others use their type color */
      borderLeft: item.pinned && !isSelected ? `4px solid ${theme.checkColor}66` : `4px solid ${TYPE_COLORS[item.type] || '#C4B5A5'}`
    },
    onMouseEnter: e => {
      if (!isCompleted && !isEditing && !bulkMode) {
        e.currentTarget.style.boxShadow = theme.shadowHover;
        e.currentTarget.style.transform = "translateY(-1px)";
      }
    },
    onMouseLeave: e => {
      if (!isEditing && !bulkMode) {
        e.currentTarget.style.boxShadow = isCompleted ? "none" : theme.shadowLight;
        e.currentTarget.style.transform = "translateY(0)";
      }
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "14px",
      alignItems: "flex-start"
    }
  }, bulkMode ? /*#__PURE__*/React.createElement("div", {
    style: {
      width: "24px",
      height: "24px",
      borderRadius: "6px",
      border: `2px solid ${isSelected ? theme.accent : theme.borderHover}`,
      background: isSelected ? theme.accent : "transparent",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      marginTop: "2px",
      transition: "all 0.2s ease",
      color: isSelected ? "#FAF7F2" : "transparent",
      fontSize: "13px",
      fontWeight: 700
    }
  }, isSelected ? "✓" : "") : /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (isEditing) return;
      onToggleComplete(item.id);
    },
    title: isCompleted ? "Mark as active" : "Mark as done",
    style: {
      width: "24px",
      height: "24px",
      borderRadius: "50%",
      border: isCompleted ? `2px solid ${theme.checkColor}` : `2px solid ${theme.borderHover}`,
      background: isCompleted ? theme.checkBg : "transparent",
      cursor: isEditing ? "default" : "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      marginTop: "2px",
      transition: "all 0.25s ease",
      color: isCompleted ? theme.checkColor : "transparent",
      fontSize: "12px",
      opacity: isEditing ? 0.4 : 1
    },
    onMouseEnter: e => {
      if (!isCompleted && !isEditing) {
        e.currentTarget.style.borderColor = theme.checkColor;
        e.currentTarget.style.background = theme.checkBg;
        e.currentTarget.style.color = theme.checkColor;
      }
    },
    onMouseLeave: e => {
      if (!isCompleted && !isEditing) {
        e.currentTarget.style.borderColor = theme.borderHover;
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "transparent";
      }
    }
  }, "\u2713"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      marginBottom: "8px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "11px",
      // Use the theme-aware color for text (brighter in dark mode for contrast)
      // but TYPE_COLORS for the background tint (decorative, contrast less critical)
      color: typeColors.color,
      background: `${TYPE_COLORS[item.type] || typeColors.color}22`,
      padding: "4px 12px",
      borderRadius: "24px",
      fontFamily: "'DM Sans', sans-serif",
      fontWeight: 500,
      letterSpacing: "0.03em",
      opacity: isCompleted ? 0.6 : 1
    }
  }, typeInfo.label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "12px",
      color: theme.textGhost,
      fontFamily: "'Lora', serif",
      fontStyle: "italic"
    }
  }, formatDateTime(item.createdAt, timezone)), isCompleted && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "11px",
      color: theme.checkColor,
      fontFamily: "'DM Sans', sans-serif",
      fontStyle: "italic"
    }
  }, "done"), item.pinned && !isCompleted && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "11px",
      color: theme.textMuted,
      fontFamily: "'DM Sans', sans-serif",
      fontStyle: "italic"
    }
  }, "pinned"), item.ocrData && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "11px",
      color: theme.textMuted,
      fontFamily: "'DM Sans', sans-serif",
      fontStyle: "italic"
    }
  }, "scanned"), item.reminder && !isCompleted && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "11px",
      color: new Date(item.reminder) <= new Date() ? theme.deleteColor : theme.textMuted,
      fontFamily: "'DM Sans', sans-serif",
      fontStyle: "italic"
    }
  }, "\u23F0 ", new Date(item.reminder).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  }))), item.image && /*#__PURE__*/React.createElement("div", {
    onClick: () => !isEditing && onViewImage(item.image),
    style: {
      marginBottom: "10px",
      cursor: isEditing ? "default" : "zoom-in",
      borderRadius: "12px",
      overflow: "hidden",
      maxWidth: "280px",
      border: `1px solid ${theme.border}`,
      transition: "all 0.3s ease",
      opacity: isCompleted ? 0.7 : 1,
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: item.image,
    alt: item.content || "Stashed image",
    style: {
      width: "100%",
      display: "block",
      maxHeight: "200px",
      objectFit: "cover"
    }
  }), isScanning && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: "rgba(0, 0, 0, 0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "12px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#FFFFFF",
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      fontWeight: 500,
      animation: "gentlePulse 1.5s ease infinite"
    }
  }, "Scanning..."))), isEditing ?
  /*#__PURE__*/
  // --- EDIT MODE ---
  React.createElement("div", {
    style: {
      animation: "softFadeIn 0.2s ease"
    }
  }, /*#__PURE__*/React.createElement("textarea", {
    ref: editRef,
    value: editContent,
    onChange: e => setEditContent(e.target.value),
    onKeyDown: handleEditKeyDown,
    rows: 2,
    style: {
      width: "100%",
      background: theme.hoverBg,
      border: `1px solid ${theme.border}`,
      borderRadius: "10px",
      color: theme.textPrimary,
      fontSize: "15px",
      fontFamily: "'Lora', serif",
      padding: "10px 14px",
      resize: "vertical",
      lineHeight: "1.6",
      minHeight: "44px",
      outline: "none"
    },
    onInput: e => {
      e.target.style.height = "auto";
      e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "8px"
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: editTags,
    onChange: e => setEditTags(e.target.value),
    onKeyDown: handleEditKeyDown,
    placeholder: "tags (comma or space separated)",
    style: {
      width: "100%",
      background: theme.hoverBg,
      border: `1px solid ${theme.border}`,
      borderRadius: "10px",
      color: theme.textMuted,
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      padding: "8px 14px",
      outline: "none"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "8px",
      marginTop: "12px"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: saveEdit,
    style: {
      background: theme.accentGradient,
      border: "none",
      color: "#FAF7F2",
      borderRadius: "10px",
      padding: "7px 18px",
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      fontWeight: 500,
      cursor: "pointer",
      transition: "all 0.2s ease"
    }
  }, "Save"), /*#__PURE__*/React.createElement("button", {
    onClick: cancelEditing,
    style: {
      background: "none",
      border: `1px solid ${theme.border}`,
      color: theme.textMuted,
      borderRadius: "10px",
      padding: "7px 18px",
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      cursor: "pointer",
      transition: "all 0.2s ease"
    },
    onMouseEnter: e => {
      e.currentTarget.style.borderColor = theme.borderHover;
    },
    onMouseLeave: e => {
      e.currentTarget.style.borderColor = theme.border;
    }
  }, "Cancel")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "8px",
      fontSize: "11px",
      color: theme.textGhost,
      fontFamily: "'DM Sans', sans-serif",
      fontStyle: "italic"
    }
  }, "enter to save \xB7 esc to cancel")) :
  /*#__PURE__*/
  // --- DISPLAY MODE (click content to edit) ---
  // Type-specific layouts: different stash types get tailored card displays.
  // Links show clickable URLs, contacts show structured fields, everything
  // else uses the default text layout. This makes each type more useful at a glance.
  React.createElement("div", null, item.type === "link" && item.content && !isEditing && (() => {
    // This regex finds URLs starting with http:// or https://
    // The "g" flag means "global" — find ALL matches, not just the first one
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    // split() with a regex that has capture groups keeps the matched parts
    // in the array. So "check out https://example.com cool" becomes:
    // ["check out ", "https://example.com", " cool"]
    const parts = item.content.split(urlRegex);
    return /*#__PURE__*/React.createElement("p", {
      onClick: startEditing,
      style: {
        margin: 0,
        color: theme.textPrimary,
        fontSize: "15.5px",
        lineHeight: "1.65",
        fontFamily: "'Lora', serif",
        wordBreak: "break-word",
        whiteSpace: "pre-wrap",
        textDecoration: isCompleted ? "line-through" : "none",
        textDecorationColor: theme.textGhost,
        cursor: isCompleted ? "default" : "text",
        borderRadius: "6px",
        padding: "2px 0",
        transition: "background 0.2s ease"
      },
      onMouseEnter: e => {
        if (!isCompleted) e.currentTarget.style.background = theme.hoverBg;
      },
      onMouseLeave: e => {
        e.currentTarget.style.background = "transparent";
      },
      title: isCompleted ? "" : "Click to edit"
    }, parts.map((part, i) => {
      // IMPORTANT: Regex with the "g" flag remembers where it left off
      // via .lastIndex. We must reset it before each .test() call,
      // otherwise it alternates between true/false unexpectedly.
      urlRegex.lastIndex = 0;
      return urlRegex.test(part) ? /*#__PURE__*/React.createElement("a", {
        key: i,
        href: part,
        target: "_blank",
        rel: "noopener noreferrer",
        onClick: e => e.stopPropagation(),
        style: {
          color: theme.types?.link?.color || "#7E9BB5",
          textDecoration: "underline",
          textDecorationColor: (theme.types?.link?.color || "#7E9BB5") + "44",
          textUnderlineOffset: "3px"
        }
      }, /*#__PURE__*/React.createElement(HighlightText, {
        text: part,
        query: searchQuery,
        theme: theme
      })) : /*#__PURE__*/React.createElement(HighlightText, {
        key: i,
        text: part,
        query: searchQuery,
        theme: theme
      });
    }));
  })(), (item.type === "contact" || item.type === "person") && item.ocrData && !isEditing && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "4px"
    }
  }, item.ocrData.name && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "17px",
      fontFamily: "'Lora', serif",
      fontWeight: 500,
      color: theme.textPrimary,
      marginBottom: "6px"
    }
  }, /*#__PURE__*/React.createElement(HighlightText, {
    text: item.ocrData.name,
    query: searchQuery,
    theme: theme
  })), item.ocrData.title && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "13.5px",
      fontFamily: "'DM Sans', sans-serif",
      color: theme.textSecondary,
      marginBottom: "2px"
    }
  }, /*#__PURE__*/React.createElement(HighlightText, {
    text: item.ocrData.title,
    query: searchQuery,
    theme: theme
  }), item.ocrData.company && /*#__PURE__*/React.createElement("span", null, " at ", /*#__PURE__*/React.createElement(HighlightText, {
    text: item.ocrData.company,
    query: searchQuery,
    theme: theme
  }))), !item.ocrData.title && item.ocrData.company && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "13.5px",
      fontFamily: "'DM Sans', sans-serif",
      color: theme.textSecondary,
      marginBottom: "2px"
    }
  }, /*#__PURE__*/React.createElement(HighlightText, {
    text: item.ocrData.company,
    query: searchQuery,
    theme: theme
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      marginTop: "8px"
    }
  }, item.ocrData.phone && /*#__PURE__*/React.createElement("a", {
    href: `tel:${item.ocrData.phone.replace(/[^\d+\-() ]/g, "")}`,
    onClick: e => e.stopPropagation(),
    style: {
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      color: theme.textMuted,
      textDecoration: "none",
      display: "flex",
      alignItems: "center",
      gap: "8px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "11px",
      opacity: 0.6
    }
  }, "\u260E"), item.ocrData.phone), item.ocrData.email && /*#__PURE__*/React.createElement("a", {
    href: `mailto:${item.ocrData.email.split("?")[0]}`,
    onClick: e => e.stopPropagation(),
    style: {
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      color: theme.textMuted,
      textDecoration: "none",
      display: "flex",
      alignItems: "center",
      gap: "8px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "11px",
      opacity: 0.6
    }
  }, "\u2709"), item.ocrData.email), item.ocrData.website && /*#__PURE__*/React.createElement("a", {
    href: item.ocrData.website.startsWith("http") ? item.ocrData.website : `https://${item.ocrData.website}`,
    target: "_blank",
    rel: "noopener noreferrer",
    onClick: e => e.stopPropagation(),
    style: {
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      color: theme.textMuted,
      textDecoration: "none",
      display: "flex",
      alignItems: "center",
      gap: "8px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "11px",
      opacity: 0.6
    }
  }, "\u2197"), item.ocrData.website), item.ocrData.address && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      color: theme.textGhost,
      display: "flex",
      alignItems: "center",
      gap: "8px",
      marginTop: "2px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "11px",
      opacity: 0.6
    }
  }, "\u25C7"), item.ocrData.address))), item.content && !(item.type === "link" && !isEditing) && !((item.type === "contact" || item.type === "person") && item.ocrData && !isEditing) && /*#__PURE__*/React.createElement("p", {
    onClick: startEditing,
    style: {
      margin: 0,
      color: theme.textPrimary,
      fontSize: "15.5px",
      lineHeight: "1.65",
      fontFamily: "'Lora', serif",
      wordBreak: "break-word",
      whiteSpace: "pre-wrap",
      textDecoration: isCompleted ? "line-through" : "none",
      textDecorationColor: theme.textGhost,
      cursor: isCompleted ? "default" : "text",
      borderRadius: "6px",
      padding: "2px 0",
      transition: "background 0.2s ease"
    },
    onMouseEnter: e => {
      if (!isCompleted) e.currentTarget.style.background = theme.hoverBg;
    },
    onMouseLeave: e => {
      e.currentTarget.style.background = "transparent";
    },
    title: isCompleted ? "" : "Click to edit"
  }, /*#__PURE__*/React.createElement(HighlightText, {
    text: item.content,
    query: searchQuery,
    theme: theme
  })), item.tags && item.tags.length > 0 && /*#__PURE__*/React.createElement("div", {
    onClick: startEditing,
    style: {
      display: "flex",
      gap: "6px",
      marginTop: "10px",
      flexWrap: "wrap",
      cursor: isCompleted ? "default" : "pointer"
    }
  }, item.tags.map(tag => /*#__PURE__*/React.createElement("span", {
    key: tag,
    style: {
      fontSize: "11.5px",
      color: theme.textMuted,
      background: theme.hoverBg,
      padding: "3px 10px",
      borderRadius: "8px",
      fontFamily: "'DM Sans', sans-serif"
    }
  }, "#", /*#__PURE__*/React.createElement(HighlightText, {
    text: tag,
    query: searchQuery,
    theme: theme
  })))), isContact && item.content && !isEditing && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "8px",
      marginTop: "12px",
      animation: "softFadeIn 0.2s ease"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: e => {
      e.stopPropagation();
      copyToClipboard();
    },
    style: {
      background: copied ? theme.checkBg : theme.hoverBg,
      border: `1px solid ${copied ? theme.checkColor + "44" : theme.border}`,
      color: copied ? theme.checkColor : theme.textMuted,
      borderRadius: "10px",
      padding: "6px 14px",
      fontSize: "12px",
      fontFamily: "'DM Sans', sans-serif",
      cursor: "pointer",
      transition: "all 0.25s ease",
      fontWeight: 500
    },
    onMouseEnter: e => {
      if (!copied) {
        e.currentTarget.style.borderColor = theme.borderHover;
        e.currentTarget.style.color = theme.textSecondary;
      }
    },
    onMouseLeave: e => {
      if (!copied) {
        e.currentTarget.style.borderColor = theme.border;
        e.currentTarget.style.color = theme.textMuted;
      }
    }
  }, copied ? "Copied" : "Copy info")), !item.content && !isCompleted && /*#__PURE__*/React.createElement("button", {
    onClick: startEditing,
    style: {
      background: "none",
      border: "none",
      color: theme.textGhost,
      cursor: "pointer",
      fontSize: "13px",
      fontFamily: "'Lora', serif",
      fontStyle: "italic",
      padding: "4px 0",
      transition: "color 0.2s ease"
    },
    onMouseEnter: e => {
      e.currentTarget.style.color = theme.textMuted;
    },
    onMouseLeave: e => {
      e.currentTarget.style.color = theme.textGhost;
    }
  }, "+ add a note\u2026"))), !isEditing && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "2px",
      flexShrink: 0,
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onTogglePin(item.id),
    style: {
      background: item.pinned ? theme.checkBg : "none",
      border: "none",
      color: item.pinned ? theme.checkColor : theme.textGhost,
      cursor: "pointer",
      fontSize: "11px",
      padding: "4px 8px",
      borderRadius: "6px",
      transition: "all 0.25s ease",
      fontFamily: "'DM Sans', sans-serif",
      fontWeight: 500
    },
    onMouseEnter: e => {
      if (!item.pinned) {
        e.currentTarget.style.color = theme.textMuted;
        e.currentTarget.style.background = theme.hoverBg;
      }
    },
    onMouseLeave: e => {
      if (!item.pinned) {
        e.currentTarget.style.color = theme.textGhost;
        e.currentTarget.style.background = "none";
      }
    },
    title: item.pinned ? "Unpin" : "Pin to top"
  }, item.pinned ? "Pinned" : "Pin"), /*#__PURE__*/React.createElement("button", {
    onClick: e => {
      e.stopPropagation();
      // If already has a reminder, clicking again clears it
      if (item.reminder) {
        onSetReminder(item.id, null);
      } else {
        onSetReminder(item.id, "pick");
      }
    },
    style: {
      background: item.reminder ? theme.checkBg : "none",
      border: "none",
      color: item.reminder ? theme.checkColor : theme.textGhost,
      cursor: "pointer",
      fontSize: "11px",
      padding: "4px 8px",
      borderRadius: "6px",
      transition: "all 0.25s ease",
      fontFamily: "'DM Sans', sans-serif",
      fontWeight: 500
    },
    onMouseEnter: e => {
      if (!item.reminder) {
        e.currentTarget.style.color = theme.textMuted;
        e.currentTarget.style.background = theme.hoverBg;
      }
    },
    onMouseLeave: e => {
      if (!item.reminder) {
        e.currentTarget.style.color = theme.textGhost;
        e.currentTarget.style.background = "none";
      }
    },
    title: item.reminder ? `Reminder: ${new Date(item.reminder).toLocaleString()}` : "Set reminder"
  }, item.reminder ? "\u23F0" : "Remind"), item.image && !item.ocrData && /*#__PURE__*/React.createElement("button", {
    onClick: () => onScanCard(item.id),
    disabled: isScanning,
    style: {
      background: "none",
      border: "none",
      color: isScanning ? theme.textMuted : theme.textGhost,
      cursor: isScanning ? "wait" : "pointer",
      fontSize: "11px",
      padding: "4px 8px",
      borderRadius: "6px",
      transition: "all 0.25s ease",
      fontFamily: "'DM Sans', sans-serif",
      fontWeight: 500,
      animation: isScanning ? "gentlePulse 1.5s ease infinite" : "none"
    },
    onMouseEnter: e => {
      if (!isScanning) {
        e.currentTarget.style.color = theme.textMuted;
        e.currentTarget.style.background = theme.hoverBg;
      }
    },
    onMouseLeave: e => {
      if (!isScanning) {
        e.currentTarget.style.color = theme.textGhost;
        e.currentTarget.style.background = "none";
      }
    }
  }, isScanning ? "Scanning…" : "Scan"), /*#__PURE__*/React.createElement("button", {
    onClick: () => onDelete(item.id),
    style: {
      background: "none",
      border: "none",
      color: theme.textGhost,
      cursor: "pointer",
      fontSize: "15px",
      padding: "3px 7px",
      borderRadius: "6px",
      transition: "all 0.25s ease",
      lineHeight: 1
    },
    onMouseEnter: e => {
      e.currentTarget.style.color = theme.deleteColor;
      e.currentTarget.style.background = theme.deleteBg;
    },
    onMouseLeave: e => {
      e.currentTarget.style.color = theme.textGhost;
      e.currentTarget.style.background = "none";
    },
    title: "Remove",
    "aria-label": "Close"
  }, "\xD7"))));
};

// ============================================================
// ANALYTICS DASHBOARD
//
// Shows visual stats about your stash collection. All data is
// computed client-side from the items array — no extra API calls.
//
// NEW CONCEPT: "Computed/derived data"
// Instead of storing stats separately, we COMPUTE them from
// the source data (items array) every time the component renders.
// This is a core React pattern — single source of truth.
// The items array IS the truth; stats are just a different view.
//
// NEW CONCEPT: "CSS-only charts"
// We use simple div widths and heights to create bar charts
// without any charting library. A bar's width is proportional
// to its value divided by the max value — basic math that
// creates a clean visual.
// ============================================================
const AnalyticsDashboard = ({
  isOpen,
  onClose,
  items,
  theme,
  customCategories
}) => {
  // If the modal isn't open, render nothing at all.
  // This is a common "early return" pattern — avoids wrapping
  // the entire component in a conditional.
  if (!isOpen) return null;

  // ── Compute all stats from items ──
  // We derive everything from the items array each render.
  // No separate "stats" state needed — if items change, stats
  // automatically update on the next render.

  // 1. Stashes by type (for horizontal bar chart)
  // We count how many items belong to each type, then sort
  // descending so the most common type appears first.
  const typeStats = {};
  items.forEach(item => {
    typeStats[item.type] = (typeStats[item.type] || 0) + 1;
  });
  const sortedTypes = Object.entries(typeStats).sort((a, b) => b[1] - a[1]);
  const maxTypeCount = sortedTypes.length > 0 ? sortedTypes[0][1] : 1;

  // 2. Activity over last 30 days (for sparkline-style chart)
  // We create a "bucket" for each of the last 30 days, then
  // count how many items were created on each day.
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const dailyActivity = {};
  for (let d = new Date(thirtyDaysAgo); d <= now; d.setDate(d.getDate() + 1)) {
    dailyActivity[d.toISOString().slice(0, 10)] = 0;
  }
  items.forEach(item => {
    const day = new Date(item.createdAt).toISOString().slice(0, 10);
    if (dailyActivity[day] !== undefined) {
      dailyActivity[day]++;
    }
  });
  const activityValues = Object.values(dailyActivity);
  const maxDaily = Math.max(...activityValues, 1);

  // 3. Most used tags (top 10)
  // Flatten all tags from all items into a single count map,
  // then take the top 10 most frequently used.
  const tagCounts = {};
  items.forEach(item => {
    (item.tags || []).forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  // 4. Summary stats
  const totalItems = items.length;
  const completedCount = items.filter(i => i.completed).length;
  const completionRate = totalItems > 0 ? Math.round(completedCount / totalItems * 100) : 0;
  const pinnedCount = items.filter(i => i.pinned).length;
  const withImages = items.filter(i => i.image).length;
  // Average stashes per day: total items / number of days since first stash
  const avgPerDay = totalItems > 0 ? (totalItems / Math.max(1, Math.ceil((now - new Date(items[items.length - 1]?.createdAt || now)) / (1000 * 60 * 60 * 24)))).toFixed(1) : "0";

  // 5. Streak — consecutive days with at least one stash
  // We walk backwards from today, checking each day. The moment
  // we hit a day with no stashes, the streak is broken.
  const daySet = new Set();
  items.forEach(item => daySet.add(new Date(item.createdAt).toISOString().slice(0, 10)));
  let streak = 0;
  for (let d = new Date(); streak < 365; d.setDate(d.getDate() - 1)) {
    if (daySet.has(d.toISOString().slice(0, 10))) {
      streak++;
    } else {
      break;
    }
  }
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    onKeyDown: e => {
      if (e.key === "Escape") onClose();
    },
    tabIndex: -1,
    ref: el => el && el.focus(),
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "Analytics",
    style: {
      position: "fixed",
      inset: 0,
      background: theme.overlayBg,
      backdropFilter: "blur(16px)",
      zIndex: 900,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      animation: "softFadeIn 0.25s ease",
      outline: "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      background: theme.settingsBg,
      borderRadius: "24px",
      border: `1px solid ${theme.border}`,
      padding: "36px 32px",
      width: "92%",
      maxWidth: "480px",
      maxHeight: "85vh",
      overflowY: "auto",
      boxShadow: theme.shadowHover,
      animation: "settingsIn 0.35s ease"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "28px"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "22px",
      fontWeight: 400,
      margin: 0,
      color: theme.textSecondary
    }
  }, "Your Stats"), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    "aria-label": "Close",
    style: {
      background: "none",
      border: "none",
      color: theme.textGhost,
      fontSize: "20px",
      cursor: "pointer",
      padding: "4px 8px",
      borderRadius: "8px",
      transition: "all 0.2s ease"
    },
    onMouseEnter: e => {
      e.currentTarget.style.color = theme.textMuted;
      e.currentTarget.style.background = theme.hoverBg;
    },
    onMouseLeave: e => {
      e.currentTarget.style.color = theme.textGhost;
      e.currentTarget.style.background = "none";
    }
  }, "\xD7")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: "12px",
      marginBottom: "28px"
    }
  }, [{
    value: totalItems,
    label: "Total",
    color: theme.textSecondary
  }, {
    value: completedCount,
    label: "Done",
    color: theme.checkColor
  }, {
    value: `${streak}d`,
    label: "Streak",
    color: theme.accent
  }].map(stat => /*#__PURE__*/React.createElement("div", {
    key: stat.label,
    style: {
      textAlign: "center",
      padding: "14px 8px",
      background: theme.hoverBg,
      borderRadius: "14px",
      border: `1px solid ${theme.border}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "26px",
      color: stat.color,
      fontWeight: 400
    }
  }, stat.value), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "11px",
      color: theme.textFaint,
      fontStyle: "italic"
    }
  }, stat.label)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "16px",
      marginBottom: "24px",
      justifyContent: "center"
    }
  }, [{
    value: pinnedCount,
    label: "pinned"
  }, {
    value: withImages,
    label: "photos"
  }, {
    value: avgPerDay,
    label: "per day"
  }, {
    value: `${completionRate}%`,
    label: "done"
  }].map(s => /*#__PURE__*/React.createElement("div", {
    key: s.label,
    style: {
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "18px",
      color: theme.textSecondary
    }
  }, s.value), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "10px",
      color: theme.textGhost,
      fontStyle: "italic"
    }
  }, s.label)))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: "24px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "13px",
      color: theme.textMuted,
      fontWeight: 500,
      marginBottom: "10px"
    }
  }, "Last 30 days"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-end",
      gap: "2px",
      height: "60px",
      padding: "0 2px"
    }
  }, activityValues.map((count, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: 1,
      minWidth: "4px",
      height: `${Math.max(2, count / maxDaily * 100)}%`,
      background: count > 0 ? theme.accent : theme.border,
      borderRadius: "2px 2px 0 0",
      opacity: count > 0 ? 0.7 : 0.3,
      transition: "height 0.3s ease"
    },
    title: `${Object.keys(dailyActivity)[i]}: ${count} stashes`
  })))), sortedTypes.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: "24px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "13px",
      color: theme.textMuted,
      fontWeight: 500,
      marginBottom: "10px"
    }
  }, "By type"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "6px"
    }
  }, sortedTypes.map(([type, count]) => {
    const typeColor = TYPE_COLORS[type] || theme.textMuted;
    const info = getTypeInfo(type, customCategories);
    return /*#__PURE__*/React.createElement("div", {
      key: type,
      style: {
        display: "flex",
        alignItems: "center",
        gap: "10px"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "12px",
        color: theme.textMuted,
        width: "80px",
        textAlign: "right"
      }
    }, info.label), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        height: "18px",
        background: theme.hoverBg,
        borderRadius: "4px",
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: `${count / maxTypeCount * 100}%`,
        height: "100%",
        background: typeColor,
        borderRadius: "4px",
        opacity: 0.7,
        transition: "width 0.5s ease",
        minWidth: "8px"
      }
    })), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "12px",
        color: theme.textGhost,
        width: "30px"
      }
    }, count));
  }))), topTags.length > 0 && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "13px",
      color: theme.textMuted,
      fontWeight: 500,
      marginBottom: "10px"
    }
  }, "Top tags"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "6px",
      flexWrap: "wrap"
    }
  }, topTags.map(([tag, count]) => /*#__PURE__*/React.createElement("span", {
    key: tag,
    style: {
      fontSize: "12px",
      color: theme.textSecondary,
      background: theme.hoverBg,
      padding: "4px 12px",
      borderRadius: "20px",
      fontFamily: "'DM Sans', sans-serif",
      border: `1px solid ${theme.border}`
    }
  }, "#", tag, " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: theme.textGhost,
      fontSize: "11px"
    }
  }, count)))))));
};

// ============================================================
// EMPTY STATE
// ============================================================
const EmptyState = ({
  theme
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    textAlign: "center",
    padding: "72px 24px"
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    width: "64px",
    height: "64px",
    borderRadius: "50%",
    background: theme.hoverBg,
    margin: "0 auto 20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "24px",
    color: theme.textGhost,
    border: `1px solid ${theme.border}`
  }
}, "\u2727"), /*#__PURE__*/React.createElement("p", {
  style: {
    fontFamily: "'Lora', serif",
    fontSize: "21px",
    color: theme.textSecondary,
    margin: "0 0 8px"
  }
}, "Your stash is empty"), /*#__PURE__*/React.createElement("p", {
  style: {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: "14px",
    color: theme.textFaint,
    margin: 0,
    lineHeight: 1.6
  }
}, "Type a thought, drop a photo, or save a link", /*#__PURE__*/React.createElement("br", null), "\u2014 everything goes here"));

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
const LoginScreen = ({
  onLogin,
  theme,
  initialError
}) => {
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError || "");
  const [loading, setLoading] = useState(false);

  // Forgot Password state
  // forgotStep: null = not in forgot flow, 1 = enter email, 2 = enter code + new password
  const [forgotStep, setForgotStep] = useState(null);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotCode, setForgotCode] = useState("");
  const [forgotNewPassword, setForgotNewPassword] = useState("");
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState("");

  // Step 1: Request a reset code
  const handleForgotSubmitEmail = async e => {
    e.preventDefault();
    setForgotError("");
    setForgotLoading(true);
    try {
      await fetch(`${BACKEND_URL}/api/auth/forgot-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: forgotEmail
        })
      }).then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Something went wrong");
      });
      // Move to step 2 regardless (server won't reveal if email exists)
      setForgotStep(2);
    } catch (err) {
      if (err instanceof TypeError) {
        setForgotError("Unable to reach the server. Check your connection.");
      } else {
        setForgotError(err.message);
      }
    } finally {
      setForgotLoading(false);
    }
  };

  // Step 2: Submit code + new password
  const handleForgotReset = async e => {
    e.preventDefault();
    setForgotError("");
    if (forgotNewPassword.length < 8) {
      setForgotError("Password must be at least 8 characters");
      return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      setForgotError("Passwords do not match");
      return;
    }
    setForgotLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/reset-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "include",
        // Receive the httpOnly cookie from the server
        body: JSON.stringify({
          email: forgotEmail,
          code: forgotCode,
          newPassword: forgotNewPassword
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      // Store the JWT so apiFetch can send it as a Bearer header.
      // This is the fallback for browsers that block cross-site cookies.
      localStorage.setItem("stash-token", data.token);
      onLogin(data.token, data.user);
    } catch (err) {
      if (err instanceof TypeError) {
        setForgotError("Unable to reach the server. Check your connection.");
      } else {
        setForgotError(err.message);
      }
    } finally {
      setForgotLoading(false);
    }
  };

  // Reset the forgot flow and go back to login
  const exitForgotFlow = () => {
    setForgotStep(null);
    setForgotEmail("");
    setForgotCode("");
    setForgotNewPassword("");
    setForgotConfirmPassword("");
    setForgotError("");
  };
  const handleSubmit = async e => {
    e.preventDefault();
    setError("");
    setLoading(true);

    // Fix #4: Client-side password validation — catch short passwords
    // before sending to the server (faster feedback for the user)
    if (authMode === "signup" && password.length < 8) {
      setError("Password must be at least 8 characters");
      setLoading(false);
      return;
    }
    try {
      const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const response = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "include",
        // Receive the httpOnly cookie from the server
        body: JSON.stringify({
          email,
          password
        })
      });
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error("Server returned an unexpected response. Try again in a moment.");
      }
      if (!response.ok) {
        throw new Error(data.error || "Something went wrong");
      }

      // Store the JWT so apiFetch can send it as a Bearer header.
      // This is the fallback for browsers that block cross-site cookies.
      localStorage.setItem("stash-token", data.token);
      onLogin(data.token, data.user);
    } catch (err) {
      if (err instanceof TypeError) {
        setError("Unable to reach the server. Check your connection and try again.");
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // ---------- Forgot Password Flow ----------
  if (forgotStep) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        minHeight: "100vh",
        background: theme.pageBg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'DM Sans', sans-serif",
        transition: "background 0.4s ease"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: "92%",
        maxWidth: "380px",
        animation: "softFadeIn 0.6s ease"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "center",
        marginBottom: "36px"
      }
    }, /*#__PURE__*/React.createElement("h1", {
      style: {
        fontFamily: "'Lora', serif",
        fontSize: "36px",
        fontWeight: 400,
        color: theme.textSecondary,
        letterSpacing: "-0.02em",
        margin: "0 0 6px"
      }
    }, "Stash"), /*#__PURE__*/React.createElement("p", {
      style: {
        fontFamily: "'Lora', serif",
        fontSize: "14px",
        color: theme.textGhost,
        fontStyle: "italic",
        margin: 0
      }
    }, "reset your password")), /*#__PURE__*/React.createElement("div", {
      style: {
        background: theme.cardBg,
        borderRadius: "20px",
        border: `1px solid ${theme.border}`,
        padding: "32px 28px",
        boxShadow: theme.shadowMedium
      }
    }, forgotStep === 1 && /*#__PURE__*/React.createElement("form", {
      onSubmit: handleForgotSubmitEmail
    }, /*#__PURE__*/React.createElement("p", {
      style: {
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "13.5px",
        color: theme.textSecondary,
        marginBottom: "18px",
        lineHeight: 1.5
      }
    }, "Enter your email to receive a reset code"), /*#__PURE__*/React.createElement("input", {
      type: "email",
      value: forgotEmail,
      onChange: e => {
        setForgotEmail(e.target.value);
        setForgotError("");
      },
      placeholder: "you@example.com",
      required: true,
      autoComplete: "email",
      style: {
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
        marginBottom: "18px"
      }
    }), forgotError && /*#__PURE__*/React.createElement("div", {
      style: {
        color: theme.deleteColor,
        fontSize: "13px",
        fontFamily: "'DM Sans', sans-serif",
        marginBottom: "14px",
        textAlign: "center"
      }
    }, forgotError), /*#__PURE__*/React.createElement("button", {
      type: "submit",
      disabled: forgotLoading,
      style: {
        width: "100%",
        padding: "13px",
        borderRadius: "12px",
        border: "none",
        background: forgotLoading ? theme.disabledBg : theme.accentGradient,
        color: forgotLoading ? theme.disabledText : "#FFFFFF",
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "15px",
        fontWeight: 500,
        cursor: forgotLoading ? "default" : "pointer"
      }
    }, forgotLoading ? "Sending..." : "Send reset code")), forgotStep === 2 && /*#__PURE__*/React.createElement("form", {
      onSubmit: handleForgotReset
    }, /*#__PURE__*/React.createElement("p", {
      style: {
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "13.5px",
        color: theme.textSecondary,
        marginBottom: "18px",
        lineHeight: 1.5
      }
    }, "Enter the 6-digit code sent to your email"), /*#__PURE__*/React.createElement("input", {
      type: "text",
      value: forgotCode,
      onChange: e => {
        setForgotCode(e.target.value.replace(/\D/g, "").slice(0, 6));
        setForgotError("");
      },
      placeholder: "000000",
      maxLength: 6,
      required: true,
      style: {
        width: "100%",
        padding: "12px 14px",
        borderRadius: "12px",
        border: `1px solid ${theme.border}`,
        background: theme.inputBg,
        color: theme.textPrimary,
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "20px",
        letterSpacing: "0.3em",
        textAlign: "center",
        outline: "none",
        boxSizing: "border-box",
        marginBottom: "14px"
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: "14px"
      }
    }, /*#__PURE__*/React.createElement("label", {
      style: {
        display: "block",
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "13px",
        fontWeight: 500,
        color: theme.textMuted,
        marginBottom: "6px"
      }
    }, "New password"), /*#__PURE__*/React.createElement("input", {
      type: "password",
      value: forgotNewPassword,
      onChange: e => {
        setForgotNewPassword(e.target.value);
        setForgotError("");
      },
      placeholder: "8+ characters",
      required: true,
      autoComplete: "new-password",
      style: {
        width: "100%",
        padding: "12px 14px",
        borderRadius: "12px",
        border: `1px solid ${theme.border}`,
        background: theme.inputBg,
        color: theme.textPrimary,
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "15px",
        outline: "none",
        boxSizing: "border-box"
      }
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: "18px"
      }
    }, /*#__PURE__*/React.createElement("label", {
      style: {
        display: "block",
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "13px",
        fontWeight: 500,
        color: theme.textMuted,
        marginBottom: "6px"
      }
    }, "Confirm new password"), /*#__PURE__*/React.createElement("input", {
      type: "password",
      value: forgotConfirmPassword,
      onChange: e => {
        setForgotConfirmPassword(e.target.value);
        setForgotError("");
      },
      placeholder: "Repeat password",
      required: true,
      autoComplete: "new-password",
      style: {
        width: "100%",
        padding: "12px 14px",
        borderRadius: "12px",
        border: `1px solid ${theme.border}`,
        background: theme.inputBg,
        color: theme.textPrimary,
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "15px",
        outline: "none",
        boxSizing: "border-box"
      }
    })), forgotError && /*#__PURE__*/React.createElement("div", {
      style: {
        color: theme.deleteColor,
        fontSize: "13px",
        fontFamily: "'DM Sans', sans-serif",
        marginBottom: "14px",
        textAlign: "center"
      }
    }, forgotError), /*#__PURE__*/React.createElement("button", {
      type: "submit",
      disabled: forgotLoading || forgotCode.length !== 6,
      style: {
        width: "100%",
        padding: "13px",
        borderRadius: "12px",
        border: "none",
        background: forgotLoading || forgotCode.length !== 6 ? theme.disabledBg : theme.accentGradient,
        color: forgotLoading || forgotCode.length !== 6 ? theme.disabledText : "#FFFFFF",
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "15px",
        fontWeight: 500,
        cursor: forgotLoading || forgotCode.length !== 6 ? "default" : "pointer"
      }
    }, forgotLoading ? "Resetting..." : "Reset password")), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "center",
        marginTop: "20px",
        fontSize: "13px",
        color: theme.textFaint,
        fontFamily: "'DM Sans', sans-serif"
      }
    }, /*#__PURE__*/React.createElement("span", {
      onClick: exitForgotFlow,
      style: {
        color: theme.accent,
        cursor: "pointer",
        fontWeight: 500
      }
    }, "Back to login")))));
  }

  // ---------- Normal Login / Signup ----------
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: "100vh",
      background: theme.pageBg,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'DM Sans', sans-serif",
      transition: "background 0.4s ease"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "92%",
      maxWidth: "380px",
      animation: "softFadeIn 0.6s ease"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      marginBottom: "36px"
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "36px",
      fontWeight: 400,
      color: theme.textSecondary,
      letterSpacing: "-0.02em",
      margin: "0 0 6px"
    }
  }, "Stash"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "14px",
      color: theme.textGhost,
      fontStyle: "italic",
      margin: 0
    }
  }, "your personal memory bank")), /*#__PURE__*/React.createElement("div", {
    style: {
      background: theme.cardBg,
      borderRadius: "20px",
      border: `1px solid ${theme.border}`,
      padding: "32px 28px",
      boxShadow: theme.shadowMedium
    }
  }, /*#__PURE__*/React.createElement("form", {
    onSubmit: handleSubmit
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: "18px"
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      display: "block",
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "13px",
      fontWeight: 500,
      color: theme.textMuted,
      marginBottom: "6px"
    }
  }, "Email"), /*#__PURE__*/React.createElement("input", {
    type: "email",
    value: email,
    onChange: e => {
      setEmail(e.target.value);
      setError("");
    },
    placeholder: "you@example.com",
    required: true,
    autoComplete: "email",
    style: {
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
      transition: "border-color 0.2s ease"
    },
    onFocus: e => e.target.style.borderColor = theme.borderHover,
    onBlur: e => e.target.style.borderColor = theme.border
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: "24px"
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      display: "block",
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "13px",
      fontWeight: 500,
      color: theme.textMuted,
      marginBottom: "6px"
    }
  }, "Password"), /*#__PURE__*/React.createElement("input", {
    type: "password",
    value: password,
    onChange: e => {
      setPassword(e.target.value);
      setError("");
    },
    placeholder: authMode === "signup" ? "8+ characters" : "",
    required: true,
    autoComplete: authMode === "login" ? "current-password" : "new-password",
    style: {
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
      transition: "border-color 0.2s ease"
    },
    onFocus: e => e.target.style.borderColor = theme.borderHover,
    onBlur: e => e.target.style.borderColor = theme.border
  })), error && /*#__PURE__*/React.createElement("div", {
    style: {
      color: theme.deleteColor,
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      marginBottom: "16px",
      textAlign: "center"
    }
  }, error), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    disabled: loading,
    style: {
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
      transition: "opacity 0.2s ease"
    }
  }, loading ? authMode === "login" ? "Logging in..." : "Creating account..." : authMode === "login" ? "Log in" : "Create account")), authMode === "login" && /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      marginTop: "14px",
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif"
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: () => {
      setForgotStep(1);
      setForgotEmail(email);
      setError("");
    },
    style: {
      color: theme.textFaint,
      cursor: "pointer"
    }
  }, "Forgot password?")), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      marginTop: authMode === "login" ? "10px" : "20px",
      fontSize: "13px",
      color: theme.textFaint,
      fontFamily: "'DM Sans', sans-serif"
    }
  }, authMode === "login" ? /*#__PURE__*/React.createElement("span", null, "Don't have an account?", " ", /*#__PURE__*/React.createElement("span", {
    onClick: () => {
      setAuthMode("signup");
      setError("");
    },
    style: {
      color: theme.accent,
      cursor: "pointer",
      fontWeight: 500
    }
  }, "Sign up")) : /*#__PURE__*/React.createElement("span", null, "Already have an account?", " ", /*#__PURE__*/React.createElement("span", {
    onClick: () => {
      setAuthMode("login");
      setError("");
    },
    style: {
      color: theme.accent,
      cursor: "pointer",
      fontWeight: 500
    }
  }, "Log in"))))));
};

// ============================================================
// MAIN APP
// ============================================================
function Stash() {
  // --- Auth state ---
  // The JWT is stored in localStorage as a fallback for browsers that
  // block cross-site cookies (like mobile Safari). The server also sets
  // an httpOnly cookie — whichever one reaches the server first wins.
  const [token, setToken] = useState(localStorage.getItem("stash-token"));
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(!!localStorage.getItem("stash-token"));
  const [authError, setAuthError] = useState("");
  // Email verification — tracks whether the user has verified their email.
  // Initialized from the user object returned by login/signup (which includes email_verified).
  const [emailVerified, setEmailVerified] = useState(true);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [verifySuccess, setVerifySuccess] = useState("");

  // Listen for auth-expired events from apiFetch
  useEffect(() => {
    const handleAuthExpired = () => {
      localStorage.removeItem("stash-token");
      localStorage.removeItem("stash-logged-in");
      setToken(null);
      setUser(null);
      setItems([]);
      setEmailVerified(true);
      setAuthError("Session expired. Please log in again.");
    };
    window.addEventListener("auth-expired", handleAuthExpired);
    return () => window.removeEventListener("auth-expired", handleAuthExpired);
  }, []);

  // Called by LoginScreen after successful login/signup
  const handleLogin = async (newToken, userData) => {
    setToken(newToken);
    setUser(userData);
    setAuthError("");
    setAuthLoading(true);
    // Track email verification status from the user object
    if (userData && userData.email_verified !== undefined) {
      setEmailVerified(userData.email_verified);
    }
    try {
      // Check for localStorage stashes to migrate
      const localData = localStorage.getItem("stash-items");
      if (localData) {
        let localStashes;
        try {
          localStashes = JSON.parse(localData);
        } catch (parseErr) {
          console.error("[Auth] Corrupt local data, skipping migration:", parseErr);
          localStorage.removeItem("stash-items");
          localStashes = [];
        }
        if (localStashes.length > 0) {
          try {
            await apiFetch("/api/stashes/import", {
              method: "POST",
              body: JSON.stringify({
                stashes: localStashes
              })
            });
            // Only clear localStorage after successful migration
            localStorage.removeItem("stash-items");
          } catch (importErr) {
            console.error("[Auth] Migration import failed, keeping local data:", importErr.message);
          }
        }
      }

      // Fetch all stashes from the server
      const data = await apiFetch("/api/stashes");
      setItems(data.stashes.map(mapServerStash));

      // Also load digest preferences so the Settings panel
      // shows saved choices instead of defaults
      loadDigestSettings();
    } catch (err) {
      console.error("[Auth] Failed to load stashes:", err.message);
      setAuthError("Logged in, but couldn't load your stashes. Please refresh to try again.");
    } finally {
      setAuthLoading(false);
      setIsLoading(false);
    }
  };
  const handleLogout = async () => {
    // Tell the server to clear the httpOnly cookie.
    // We use fetch() directly (not apiFetch) because apiFetch would
    // throw on a 401 and trigger the auth-expired event, which would
    // be redundant since we're already logging out intentionally.
    try {
      await fetch(`${BACKEND_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include"
      });
    } catch (err) {
      // If the server is unreachable, that's fine — we still clear
      // local state. The cookie will expire on its own (7 days).
      console.error("[Logout] Server unreachable:", err.message);
    }
    localStorage.removeItem("stash-token");
    localStorage.removeItem("stash-logged-in");
    setToken(null);
    setUser(null);
    setItems([]);
    setEmailVerified(true);
  };

  // Send a verification code to the user's email
  const sendVerificationCode = async () => {
    setVerifyLoading(true);
    setVerifyError("");
    try {
      await apiFetch("/api/auth/send-verification", {
        method: "POST"
      });
      setShowVerifyModal(true);
    } catch (err) {
      setVerifyError(err.message);
    } finally {
      setVerifyLoading(false);
    }
  };

  // Submit the 6-digit verification code
  const submitVerificationCode = async () => {
    setVerifyLoading(true);
    setVerifyError("");
    try {
      await apiFetch("/api/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({
          code: verifyCode
        })
      });
      setEmailVerified(true);
      setShowVerifyModal(false);
      setVerifyCode("");
      setVerifySuccess("Email verified successfully!");
      // Clear success message after 3 seconds
      setTimeout(() => setVerifySuccess(""), 3000);
    } catch (err) {
      setVerifyError(err.message);
    } finally {
      setVerifyLoading(false);
    }
  };

  // ============================================================
  // DIGEST SETTINGS — server-synced preferences
  //
  // These two functions talk to the backend settings API.
  // Unlike other settings (darkMode, etc.) which live only in
  // localStorage, digest preferences MUST be on the server
  // because the digest worker (a separate service) reads them
  // to know when and how to send your email summaries.
  // ============================================================

  // Load the user's digest preferences from the server.
  // Called when user logs in, so the Settings panel shows
  // their saved choices instead of defaults.
  const loadDigestSettings = async () => {
    try {
      const data = await apiFetch("/api/settings");
      if (data.success) {
        // Merge server values into local state — the spread (...prev)
        // keeps all other settings intact while updating just these three.
        setSettings(prev => ({
          ...prev,
          digestFrequency: data.settings.digest_frequency,
          digestTime: data.settings.digest_time,
          digestTimezone: data.settings.timezone
        }));
      }
    } catch (err) {
      console.error("Failed to load digest settings:", err.message);
    }
  };

  // Save a digest setting change to the server.
  // `changes` is an object like { digest_frequency: "weekly" }.
  // We send only the changed fields — the server's COALESCE
  // logic keeps the other fields unchanged.
  const saveDigestSettings = async changes => {
    try {
      await apiFetch("/api/settings", {
        method: "PUT",
        body: JSON.stringify(changes)
      });
    } catch (err) {
      console.error("Failed to save digest settings:", err.message);
    }
  };
  const [items, setItems] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingImage, setPendingImage] = useState(null);
  const [viewingImage, setViewingImage] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Analytics modal — shows charts and stats about the user's collection
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [completedExpanded, setCompletedExpanded] = useState(true);
  const [selectedType, setSelectedType] = useState("auto");
  const [sortOrder, setSortOrder] = useState("newest"); // "newest", "oldest"
  const [undoItem, setUndoItem] = useState(null); // recently deleted item for undo
  // Fix #10: useRef instead of useState for the timer — changing a timer ID
  // doesn't need a re-render, and refs are stable across renders
  const undoTimerRef = useRef(null);
  const [bulkMode, setBulkMode] = useState(false); // bulk select mode
  const [bulkSelected, setBulkSelected] = useState(new Set()); // selected item IDs

  // ── Advanced filter state ──────────────────────────────────
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  // New state for enhanced bulk operations:
  const [bulkTagInput, setBulkTagInput] = useState("");
  const [bulkRetypeOpen, setBulkRetypeOpen] = useState(false);
  const [slidingOut, setSlidingOut] = useState(new Set()); // items currently animating out
  const [confirmClearAll, setConfirmClearAll] = useState(false); // confirm before clearing completed
  // Reminder state — tracks which item's ReminderPicker modal is open.
  // null means no picker is showing; an item ID means "show picker for this card."
  const [reminderPickerId, setReminderPickerId] = useState(null);
  const [settings, setSettings] = useState({
    darkMode: false,
    autoArchiveDays: 0,
    showCompleted: true,
    timezone: "America/New_York",
    customCategories: [],
    // NEW: user-created categories [{id, label, icon, keywords: [], colorIndex}]
    // Email digest preferences — synced with the server so the
    // digest worker knows when/how to send summary emails.
    digestFrequency: "daily",
    digestTime: "08:00",
    digestTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"
  });
  const inputRef = useRef(null);
  const searchRef = useRef(null); // Ref for the search input — lets us focus it via keyboard shortcuts
  const dragCounterRef = useRef(0);
  // Fix #9: Store items in a ref so the auto-archive effect can read
  // current items without re-triggering itself (avoids infinite loop)
  const itemsRef = useRef(items);

  // Fix #9: Keep the ref in sync whenever items change
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // ── Keyboard shortcuts ──────────────────────────────────────
  // useEffect with a "keydown" listener on `document` lets us catch
  // keyboard events globally — no matter which element is focused.
  // The cleanup function (returned arrow fn) removes the listener
  // when the component unmounts, preventing memory leaks.
  useEffect(() => {
    const handleGlobalKeyDown = e => {
      // ── Ctrl+K / Cmd+K  →  Focus search bar ──
      // e.metaKey is true on Mac (⌘), e.ctrlKey on Windows/Linux
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault(); // stop browser from opening its own search/address bar
        searchRef.current?.focus();
        return;
      }

      // ── Ctrl+N / Cmd+N  →  Focus compose input ──
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault(); // stop browser from opening a new window
        inputRef.current?.focus();
        return;
      }

      // ── Escape  →  Close things in priority order ──
      // We only close ONE thing per press so the user can "peel back"
      // layers one at a time (image viewer → settings → search).
      // Note: ImageViewer and SettingsPanel already have their own
      // Escape handlers, but those only work when those elements have
      // focus. This global handler catches Escape from anywhere.
      if (e.key === "Escape") {
        if (reminderPickerId) {
          setReminderPickerId(null);
          return;
        }
        if (viewingImage) {
          setViewingImage(null);
          return;
        }
        if (analyticsOpen) {
          setAnalyticsOpen(false);
          return;
        }
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }
        if (searchQuery) {
          setSearchQuery("");
          return;
        }
        return;
      }

      // ── /  →  Quick-focus search (GitHub / YouTube style) ──
      // Only fires when the user is NOT already typing in an input,
      // textarea, or contenteditable element — otherwise pressing "/"
      // while composing a stash would steal focus.
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = e.target.tagName;
        const isEditable = tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable;
        if (!isEditable) {
          e.preventDefault(); // prevent "/" from being typed into the search bar
          searchRef.current?.focus();
        }
      }
    };
    document.addEventListener("keydown", handleGlobalKeyDown);
    // Cleanup: remove the listener when the component unmounts
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
    // The dependency array lists every piece of state the handler reads.
    // When any of these change, React re-creates the listener with fresh values.
  }, [viewingImage, analyticsOpen, settingsOpen, searchQuery, reminderPickerId]);

  // Current theme based on settings
  const theme = settings.darkMode ? themes.dark : themes.light;

  // Load data on mount
  useEffect(() => {
    const loadData = async () => {
      // Load settings from localStorage (stays local, not synced)
      try {
        const settingsResult = await window.storage.get("stash-settings");
        if (settingsResult?.value) setSettings(prev => ({
          ...prev,
          ...JSON.parse(settingsResult.value)
        }));
      } catch (e) {}

      // If we think we're logged in, try loading stashes from the server.
      // The actual auth is via the httpOnly cookie — the "token" state is
      // just our localStorage flag ("stash-logged-in") that says "try it."
      if (token) {
        try {
          const data = await apiFetch("/api/stashes");
          setItems(data.stashes.map(mapServerStash));
          // Also load digest preferences from the server so the
          // Settings panel shows the user's saved choices
          loadDigestSettings();
          setAuthLoading(false);
          setIsLoading(false);
        } catch (err) {
          // Cookie is invalid or expired — clear login indicator
          localStorage.removeItem("stash-token");
          localStorage.removeItem("stash-logged-in");
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

  // Items are now saved via API calls (addItem, editItem, deleteItem, etc.)
  // No localStorage save needed for items.

  // Save settings
  useEffect(() => {
    if (!isLoading) {
      (async () => {
        try {
          await window.storage.set("stash-settings", JSON.stringify(settings));
        } catch (e) {
          console.error("Settings save failed:", e);
        }
      })();
    }
  }, [settings, isLoading]);

  // Fix #9: Auto-archive uses itemsRef.current (the ref) instead of `items`
  // directly. If we put `items` in the dependency array, this effect would
  // run -> call setItems -> change items -> re-run the effect (infinite loop).
  // The ref lets us read the latest items without being a dependency.
  // Also added `token` to the dependency array since the effect uses it.
  useEffect(() => {
    if (settings.autoArchiveDays > 0 && !isLoading && token) {
      const now = Date.now();
      const threshold = settings.autoArchiveDays * 24 * 60 * 60 * 1000;
      const currentItems = itemsRef.current;
      const toArchive = currentItems.filter(item => item.completed && item.completedAt && now - new Date(item.completedAt).getTime() >= threshold);
      if (toArchive.length > 0) {
        setItems(prev => prev.filter(i => !toArchive.some(a => a.id === i.id)));
        // Sync to server
        toArchive.forEach(item => {
          apiFetch(`/api/stashes/${item.id}`, {
            method: "DELETE"
          }).catch(err => console.error("[Sync] Archive delete failed:", err.message));
        });
      }
    }
  }, [settings.autoArchiveDays, isLoading, token]);

  // Drag & drop
  const handleDragEnter = useCallback(e => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  }, []);
  const handleDragLeave = useCallback(e => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);
  const handleDragOver = useCallback(e => {
    e.preventDefault();
    e.stopPropagation();
  }, []);
  const handleDrop = useCallback(async e => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;
    const files = Array.from(e.dataTransfer.files);
    const imageFile = files.find(f => f.type.startsWith("image/"));
    if (imageFile) {
      const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
      if (imageFile.size > MAX_IMAGE_SIZE) {
        alert("Image too large. Maximum size is 10 MB.");
        return;
      }
      try {
        const base64 = await readFileAsBase64(imageFile);
        const compressed = await compressImage(base64);
        setPendingImage({
          data: compressed,
          fileName: imageFile.name
        });
        inputRef.current?.focus();
      } catch (err) {
        console.error("Image read failed:", err);
      }
    }
  }, []);
  const addItem = () => {
    const text = inputValue.trim();
    if (!text && !pendingImage) return;
    const tags = [];
    const tagMatches = (text || "").match(/#(\w+)/g);
    if (tagMatches) tagMatches.forEach(t => tags.push(t.slice(1).toLowerCase()));
    const cleanContent = text ? text.replace(/#\w+/g, "").trim() : "";

    // Determine type: manual override > photo > auto-detect
    let itemType;
    if (pendingImage && selectedType === "auto") {
      itemType = "photo";
    } else if (selectedType !== "auto") {
      itemType = selectedType;
    } else {
      itemType = detectType(cleanContent || text, settings.customCategories);
    }

    // Generate a unique ID up front so we can reference this item
    // later when the OCR results come back asynchronously
    const newId = generateId();

    // Capture the image data before we clear pendingImage below
    const imageData = pendingImage ? pendingImage.data : null;
    setItems(prev => [{
      id: newId,
      content: cleanContent || (pendingImage ? pendingImage.fileName : text),
      type: itemType,
      tags: pendingImage && tags.length === 0 ? ["photo"] : tags,
      image: imageData,
      createdAt: new Date().toISOString(),
      completed: false,
      completedAt: null,
      pinned: false
    }, ...prev]);
    // Sync to server
    apiFetch("/api/stashes", {
      method: "POST",
      body: JSON.stringify({
        id: newId,
        type: itemType,
        content: cleanContent || (pendingImage ? pendingImage.fileName : text),
        tags: pendingImage && tags.length === 0 ? ["photo"] : tags,
        image: imageData,
        createdAt: new Date().toISOString()
      })
    }).catch(err => console.error("[Sync] Create failed:", err.message));
    setInputValue("");
    setPendingImage(null);
    setSelectedType("auto"); // Reset to auto after stashing
    inputRef.current?.focus();

    // AUTO-SCAN: If this item has an image, automatically run OCR
    // in the background. The card appears immediately with the photo,
    // and we update it in place when results come back.
    if (imageData) {
      setScanningId(newId);
      extractBusinessCard(imageData).then(cardData => {
        setScanningId(null);
        if (cardData) {
          // OCR found contact info — update the item
          const formatted = formatCardInfo(cardData);
          const updatedTags = [...tags];
          if (!updatedTags.includes("business-card")) updatedTags.push("business-card");
          if (cardData.company && !updatedTags.includes(cardData.company.toLowerCase())) {
            updatedTags.push(cardData.company.toLowerCase().replace(/\s+/g, "-"));
          }
          // setItems uses a callback so we always work with the
          // latest state — this avoids overwriting any edits the
          // user made while OCR was running
          setItems(prev => prev.map(item => item.id === newId ? {
            ...item,
            content: formatted,
            type: "contact",
            tags: updatedTags,
            ocrData: cardData
          } : item));
          // Sync OCR results to server
          apiFetch(`/api/stashes/${newId}`, {
            method: "PUT",
            body: JSON.stringify({
              content: formatted,
              type: "contact",
              tags: updatedTags,
              ocrData: cardData
            })
          }).catch(err => console.error("[Sync] OCR update failed:", err.message));
        }
        // If cardData is null, the image wasn't a business card —
        // we just leave the item as a regular photo. No harm done.
      });
    }
  };

  // Fix #11: The server DELETE is now delayed until AFTER the undo window
  // expires. If the user clicks "undo", we cancel the timer so the DELETE
  // never fires. This avoids the old race condition where we'd delete on
  // the server immediately, then re-create on undo (fragile and lossy).
  const deleteItem = id => {
    const item = items.find(i => i.id === id);
    // Trigger slide-out animation
    setSlidingOut(prev => new Set(prev).add(id));
    setTimeout(() => {
      setSlidingOut(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setItems(prev => prev.filter(i => i.id !== id));

      // Set up undo — server DELETE happens only after the 5s undo window
      if (item) {
        setUndoItem({
          items: [item],
          label: "Deleted"
        });
        // Fix #10: use undoTimerRef instead of state
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        undoTimerRef.current = setTimeout(() => {
          setUndoItem(null);
          // NOW it's safe to delete on the server — undo window expired
          apiFetch(`/api/stashes/${id}`, {
            method: "DELETE"
          }).catch(err => console.error("[Sync] Delete failed:", err.message));
        }, 5000);
      } else {
        // No item found (shouldn't happen), delete immediately
        apiFetch(`/api/stashes/${id}`, {
          method: "DELETE"
        }).catch(err => console.error("[Sync] Delete failed:", err.message));
      }
    }, 300); // match animation duration
  };

  // Fix #11: Same deferred-delete pattern for bulk deletes
  const deleteMultiple = ids => {
    const deletedItems = items.filter(i => ids.has(i.id));
    // Trigger slide-out for all
    setSlidingOut(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });
    setTimeout(() => {
      setSlidingOut(new Set());
      setItems(prev => prev.filter(i => !ids.has(i.id)));
      setBulkSelected(new Set());
      setBulkMode(false);
      if (deletedItems.length > 0) {
        setUndoItem({
          items: deletedItems,
          label: `Deleted ${deletedItems.length} items`
        });
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        undoTimerRef.current = setTimeout(() => {
          setUndoItem(null);
          // Server deletes happen after undo window expires
          ids.forEach(id => {
            apiFetch(`/api/stashes/${id}`, {
              method: "DELETE"
            }).catch(err => console.error("[Sync] Delete failed:", err.message));
          });
        }, 5000);
      } else {
        // No items to undo, delete immediately
        ids.forEach(id => {
          apiFetch(`/api/stashes/${id}`, {
            method: "DELETE"
          }).catch(err => console.error("[Sync] Delete failed:", err.message));
        });
      }
    }, 300);
  };
  const completeMultiple = ids => {
    const completedAt = new Date().toISOString();
    setItems(prev => prev.map(item => ids.has(item.id) ? {
      ...item,
      completed: true,
      completedAt
    } : item));
    // Sync to server
    ids.forEach(id => {
      apiFetch(`/api/stashes/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          completed: true,
          completedAt
        })
      }).catch(err => console.error("[Sync] Update failed:", err.message));
    });
    setBulkSelected(new Set());
    setBulkMode(false);
  };

  // ============================================================
  // BULK TAG
  //
  // Adds tags to multiple items at once. Unlike single-item editing
  // where you replace all tags, bulk tagging ADDS new tags without
  // removing existing ones. This is called a "union" operation.
  //
  // NEW CONCEPT: "Set union"
  // We combine existing tags with new tags, then remove duplicates
  // using [...new Set(...)]. A Set automatically ignores duplicates,
  // so ["recipe", "italian", "recipe"] becomes ["recipe", "italian"].
  // ============================================================
  const bulkAddTags = (ids, newTags) => {
    // Pre-compute merged tags from current state so server sync
    // uses the correct values (not a stale closure).
    const currentItems = itemsRef.current;
    const mergedMap = new Map();
    ids.forEach(id => {
      const item = currentItems.find(i => i.id === id);
      if (item) {
        mergedMap.set(id, [...new Set([...(item.tags || []), ...newTags])]);
      }
    });
    setItems(prev => prev.map(item => {
      if (!ids.has(item.id)) return item;
      const merged = mergedMap.get(item.id) || [...new Set([...(item.tags || []), ...newTags])];
      return {
        ...item,
        tags: merged
      };
    }));
    // Sync each to server using pre-computed merged tags
    mergedMap.forEach((merged, id) => {
      apiFetch(`/api/stashes/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          tags: merged
        })
      }).catch(err => console.error("[Sync] Bulk tag failed:", err.message));
    });
    setBulkSelected(new Set());
    setBulkMode(false);
  };

  // ============================================================
  // BULK RE-TYPE
  //
  // Changes the type/category of multiple items at once.
  // Useful when auto-detection got it wrong for several items.
  // ============================================================
  const bulkRetype = (ids, newType) => {
    // Validate newType is a known type before applying
    if (!typeLabels[newType]) return;
    setItems(prev => prev.map(item => ids.has(item.id) ? {
      ...item,
      type: newType
    } : item));
    // Sync each to server
    ids.forEach(id => {
      apiFetch(`/api/stashes/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          type: newType
        })
      }).catch(err => console.error("[Sync] Bulk retype failed:", err.message));
    });
    setBulkSelected(new Set());
    setBulkMode(false);
  };

  // ============================================================
  // BULK EXPORT
  //
  // Exports only the selected items as a JSON backup file.
  // Reuses the same Blob + download pattern from exportData().
  //
  // NEW CONCEPT: "Blob + object URL"
  // A Blob is an in-memory file. We create a temporary URL for it,
  // simulate a click on an invisible <a> tag, then clean up.
  // ============================================================
  const bulkExport = ids => {
    const selected = items.filter(i => ids.has(i.id));
    const exportObj = {
      exportDate: new Date().toISOString(),
      version: APP_VERSION,
      itemCount: selected.length,
      items: selected.map(({
        image,
        ...rest
      }) => ({
        ...rest,
        hasImage: !!image
      }))
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stash-selection-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setBulkSelected(new Set());
    setBulkMode(false);
  };

  // Fix #11: Undo now just cancels the timer — the server DELETE never fires.
  // No need to re-POST because the item was never deleted from the server!
  const restoreItem = () => {
    if (undoItem) {
      setItems(prev => [...undoItem.items, ...prev]);
      setUndoItem(null);
      // Cancel the timer so the server DELETE never happens
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  };
  const toggleBulkSelect = id => {
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);else next.add(id);
      return next;
    });
  };

  // Fix #11: Same deferred-delete pattern for clearing all completed
  const clearAllCompleted = () => {
    const completedIds = items.filter(i => i.completed).map(i => i.id);
    const deletedItems = items.filter(i => i.completed);
    setSlidingOut(prev => {
      const next = new Set(prev);
      completedIds.forEach(id => next.add(id));
      return next;
    });
    setTimeout(() => {
      setSlidingOut(new Set());
      setItems(prev => prev.filter(i => !i.completed));
      setConfirmClearAll(false);
      if (deletedItems.length > 0) {
        setUndoItem({
          items: deletedItems,
          label: `Cleared ${deletedItems.length} completed`
        });
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        undoTimerRef.current = setTimeout(() => {
          setUndoItem(null);
          // Server deletes after undo window expires
          completedIds.forEach(id => {
            apiFetch(`/api/stashes/${id}`, {
              method: "DELETE"
            }).catch(err => console.error("[Sync] Delete failed:", err.message));
          });
        }, 5000);
      } else {
        completedIds.forEach(id => {
          apiFetch(`/api/stashes/${id}`, {
            method: "DELETE"
          }).catch(err => console.error("[Sync] Delete failed:", err.message));
        });
      }
    }, 300);
  };
  const toggleComplete = id => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const completed = !item.completed;
    const completedAt = completed ? new Date().toISOString() : null;
    setItems(prev => prev.map(i => i.id === id ? {
      ...i,
      completed,
      completedAt
    } : i));
    // Sync to server
    apiFetch(`/api/stashes/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        completed,
        completedAt
      })
    }).catch(err => console.error("[Sync] Update failed:", err.message));
  };

  // Edit an item's content, tags, and re-detect its type
  const editItem = (id, updates) => {
    setItems(prev => prev.map(item => item.id === id ? {
      ...item,
      ...updates
    } : item));
    // Sync to server
    apiFetch(`/api/stashes/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates)
    }).catch(err => console.error("[Sync] Update failed:", err.message));
  };

  // Scan business card with OCR
  const [scanningId, setScanningId] = useState(null);
  const scanBusinessCard = async id => {
    const item = items.find(i => i.id === id);
    if (!item?.image) return;
    setScanningId(id);
    const cardData = await extractBusinessCard(item.image);
    setScanningId(null);
    if (cardData) {
      const formatted = formatCardInfo(cardData);
      const newTags = [...(item.tags || [])];
      if (!newTags.includes("business-card")) newTags.push("business-card");
      if (cardData.company && !newTags.includes(cardData.company.toLowerCase())) {
        newTags.push(cardData.company.toLowerCase().replace(/\s+/g, "-"));
      }
      editItem(id, {
        content: formatted,
        type: "contact",
        tags: newTags,
        ocrData: cardData
      });
    }
  };

  // Toggle pin status
  const togglePin = id => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const pinned = !item.pinned;
    setItems(prev => prev.map(i => i.id === id ? {
      ...i,
      pinned
    } : i));
    // Sync to server
    apiFetch(`/api/stashes/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        pinned
      })
    }).catch(err => console.error("[Sync] Update failed:", err.message));
  };

  // ── Reminder logic ──────────────────────────────────────────
  // Handle setting or clearing a reminder on a stash item.
  // When value is "pick", we open the ReminderPicker modal.
  // When value is an ISO date string, we save it to the item.
  // When value is null, we clear the reminder.
  const setReminder = (id, value) => {
    if (value === "pick") {
      // Open the picker modal for this item
      setReminderPickerId(id);
      return;
    }
    // Set or clear the reminder on the item
    setItems(prev => prev.map(item => item.id === id ? {
      ...item,
      reminder: value
    } : item));
    setReminderPickerId(null);

    // Sync to server — the backend stores reminder as part of the stash
    apiFetch(`/api/stashes/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        reminder: value
      })
    }).catch(err => console.error("[Sync] Reminder update failed:", err.message));

    // NEW CONCEPT: "Notification.requestPermission()"
    // The first time a user sets a reminder, we ask the browser for
    // permission to show notifications. The browser shows a popup like
    // "Allow notifications?" — the user must click Allow for it to work.
    // We only ask once (when permission is "default" = not yet decided).
    if (value && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().then(result => {
        if (result === "denied") {
          console.warn("[Reminders] Notification permission denied — reminders will still work but won't show alerts");
        }
      });
    }
  };

  // Check for due reminders every 30 seconds.
  // This useEffect sets up a recurring timer (setInterval) that scans
  // all items looking for reminders whose time has passed. When found,
  // it fires a browser notification and clears the reminder.
  //
  // NEW CONCEPT: "setInterval + cleanup"
  // setInterval runs a function repeatedly. The cleanup function
  // (returned by useEffect) calls clearInterval to stop it when the
  // component unmounts — without this, the timer would keep running
  // forever, causing a "memory leak."
  // Fix: Use itemsRef (already defined above) instead of items in the
  // dependency array. Reading from a ref means this effect runs once on
  // mount and the interval keeps working — without re-creating the timer
  // every time items changes (which caused a render cascade).
  useEffect(() => {
    const checkReminders = () => {
      const now = new Date();
      const currentItems = itemsRef.current;
      const firedIds = new Set();
      currentItems.forEach(item => {
        if (item.reminder && new Date(item.reminder) <= now && !item.completed) {
          firedIds.add(item.id);
          // Fire a browser notification if we have permission
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification("Stash Reminder", {
              body: item.content?.substring(0, 100) || "You have a reminder!",
              icon: "/icon-192.png"
            });
          }
          // Also clear on the server
          apiFetch(`/api/stashes/${item.id}`, {
            method: "PUT",
            body: JSON.stringify({
              reminder: null
            })
          }).catch(err => console.error("[Sync] Reminder clear failed:", err.message));
        }
      });

      // Batch all fired reminders into a single setItems call
      if (firedIds.size > 0) {
        setItems(prev => prev.map(i => firedIds.has(i.id) ? {
          ...i,
          reminder: null
        } : i));
      }
    };
    const timer = setInterval(checkReminders, 30000); // every 30 seconds
    checkReminders(); // also check immediately on mount
    return () => clearInterval(timer); // cleanup: stop the timer
  }, []); // empty deps — reads from itemsRef.current

  const handleKeyDown = e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      addItem();
    }
    if (e.key === "Escape" && pendingImage) setPendingImage(null);
  };
  const handleFileSelect = async e => {
    const file = e.target.files?.[0];
    if (file?.type.startsWith("image/")) {
      const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
      if (file.size > MAX_IMAGE_SIZE) {
        alert("Image too large. Maximum size is 10 MB.");
        return;
      }
      try {
        const base64 = await readFileAsBase64(file);
        const compressed = await compressImage(base64);
        setPendingImage({
          data: compressed,
          fileName: file.name
        });
        inputRef.current?.focus();
      } catch (err) {
        console.error("Image read failed:", err);
      }
    }
    e.target.value = "";
  };

  // Filtering (respects showCompleted setting)
  // BUGFIX: When searching with "#cooking", we strip the "#" so it
  // matches the stored tag "cooking". We also check if the raw query
  // (with #) appears in the content, in case someone literally typed
  // "#cooking" in their note text.
  const filteredItems = items.filter(item => {
    if (item.completed && !settings.showCompleted) return false;
    const raw = searchQuery.toLowerCase();
    const stripped = raw.replace(/^#/, "");
    const matchesSearch = !searchQuery || (item.content || "").toLowerCase().includes(raw) || (item.tags || []).some(t => t.includes(stripped));
    const matchesType = filterType === "all" || item.type === filterType;

    // ── Advanced filters ──────────────────────────────────────
    // Date range: compare the item's createdAt against the user-chosen
    // boundaries.  We append "T23:59:59" to dateTo so the entire end-day
    // is included (otherwise midnight would cut it off early).
    const matchesDateFrom = !dateFrom || new Date(item.createdAt) >= new Date(dateFrom);
    const matchesDateTo = !dateTo || new Date(item.createdAt) <= new Date(dateTo + "T23:59:59");

    // Multi-tag filter: split the comma-separated input into individual
    // tags, trim whitespace, then require the item to contain ALL of
    // them.  `.every()` returns true when the array is empty, so when
    // the user hasn't typed anything every item passes.
    const filterTags = tagFilter.split(",").map(t => t.trim().toLowerCase()).filter(t => t.length > 0);
    const matchesTags = filterTags.length === 0 || filterTags.every(ft => (item.tags || []).some(t => t.toLowerCase().includes(ft)));
    return matchesSearch && matchesType && matchesDateFrom && matchesDateTo && matchesTags;
  }).sort((a, b) => {
    // Pinned items float to top within their group
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    // Then sort by date
    const dateA = new Date(a.createdAt).getTime();
    const dateB = new Date(b.createdAt).getTime();
    return sortOrder === "oldest" ? dateA - dateB : dateB - dateA;
  });

  // Date grouping helper
  const getDateGroup = dateStr => {
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setMonth(today.getMonth() - 1);
    if (d >= today) return "Today";
    if (d >= yesterday) return "Yesterday";
    if (d >= weekAgo) return "This week";
    if (d >= monthAgo) return "This month";
    // Older — show month + year
    return d.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric"
    });
  };

  // Group items by date for rendering
  const groupItemsByDate = itemsList => {
    const groups = [];
    let currentGroup = null;
    itemsList.forEach(item => {
      const group = getDateGroup(item.createdAt);
      if (!currentGroup || currentGroup.label !== group) {
        currentGroup = {
          label: group,
          items: []
        };
        groups.push(currentGroup);
      }
      currentGroup.items.push(item);
    });
    return groups;
  };
  const activeItems = items.filter(i => !i.completed);
  const completedItems = items.filter(i => i.completed);
  const typeCounts = items.filter(i => settings.showCompleted || !i.completed).reduce((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});
  const hasContent = inputValue.trim() || pendingImage;

  // Show loading screen while checking auth
  if (isLoading || authLoading) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        minHeight: "100vh",
        background: theme.pageBg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: theme.textFaint,
        fontFamily: "'Lora', serif",
        fontStyle: "italic",
        fontSize: "15px",
        transition: "background 0.4s ease"
      }
    }, "opening your stash\u2026");
  }

  // Show login screen if not authenticated
  if (!token) {
    return /*#__PURE__*/React.createElement(LoginScreen, {
      onLogin: handleLogin,
      theme: theme,
      initialError: authError
    });
  }
  return /*#__PURE__*/React.createElement("div", {
    onDragEnter: handleDragEnter,
    onDragLeave: handleDragLeave,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
    style: {
      minHeight: "100vh",
      background: theme.pageBg,
      color: theme.textPrimary,
      fontFamily: "'DM Sans', sans-serif",
      position: "relative",
      transition: "background 0.4s ease, color 0.4s ease"
    }
  }, /*#__PURE__*/React.createElement("style", null, `
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes softFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes gentlePulse {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.02); }
        }
        @keyframes dropIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes settingsIn {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideOut {
          from { opacity: 1; transform: translateX(0); max-height: 300px; margin-bottom: 8px; }
          to { opacity: 0; transform: translateX(80px); max-height: 0; margin-bottom: 0; overflow: hidden; }
        }
        * { box-sizing: border-box; }
        ::placeholder { color: ${theme.textFaint}; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${theme.border}; border-radius: 10px; }
        textarea:focus, input:focus { outline: none; }
        body { margin: 0; }
        select option { background: ${theme.cardBg}; color: ${theme.textPrimary}; }
        .category-scroll::-webkit-scrollbar { display: none; }
        .category-scroll { -ms-overflow-style: none; scrollbar-width: none; }
      `), isDragging && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      background: theme.overlayBg,
      backdropFilter: "blur(20px)",
      zIndex: 999,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      animation: "dropIn 0.25s ease"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      border: `2px dashed ${theme.borderHover}`,
      borderRadius: "28px",
      padding: "64px 80px",
      textAlign: "center",
      animation: "gentlePulse 2.5s ease infinite"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "72px",
      height: "72px",
      borderRadius: "50%",
      background: theme.hoverBg,
      margin: "0 auto 20px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "28px",
      color: theme.textMuted
    }
  }, "\u25AB"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "24px",
      color: theme.textSecondary,
      margin: "0 0 8px"
    }
  }, "Drop it right here"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "14px",
      color: theme.textFaint
    }
  }, "photos, screenshots, business cards \u2014 all welcome"))), viewingImage && /*#__PURE__*/React.createElement(ImageViewer, {
    src: viewingImage,
    onClose: () => setViewingImage(null),
    theme: theme
  }), /*#__PURE__*/React.createElement(SettingsPanel, {
    isOpen: settingsOpen,
    onClose: () => setSettingsOpen(false),
    settings: settings,
    onUpdateSettings: setSettings,
    theme: theme,
    itemCount: activeItems.length,
    completedCount: completedItems.length,
    onExport: () => exportData(items, settings),
    onExportFull: () => exportDataFull(items, settings),
    onImport: data => {
      if (data?.items && Array.isArray(data.items)) {
        // Fix #19: Validate each imported item has required fields
        // so corrupt or malicious data doesn't break the app
        const validItem = item => item && typeof item.id === 'string' && typeof item.content === 'string' && item.content.length <= 50000 && (!item.type || typeof item.type === 'string') && (!item.tags || Array.isArray(item.tags) && item.tags.every(t => typeof t === 'string')) && (!item.image || typeof item.image === 'string' && item.image.length <= 7 * 1024 * 1024);
        const validItems = data.items.filter(validItem);
        if (validItems.length < data.items.length) {
          console.warn(`[Import] Skipped ${data.items.length - validItems.length} invalid items`);
        }
        setItems(validItems);
        // Fix #19: Whitelist allowed settings keys instead of spreading everything
        if (data.settings) {
          const allowedKeys = ['timezone', 'customCategories', 'darkMode', 'autoArchiveDays', 'showCompleted'];
          const safeSettings = {};
          allowedKeys.forEach(key => {
            if (data.settings[key] !== undefined) safeSettings[key] = data.settings[key];
          });
          setSettings(prev => ({
            ...prev,
            ...safeSettings
          }));
        }
        setSettingsOpen(false);
        // Sync validated items to server
        apiFetch("/api/stashes/import", {
          method: "POST",
          body: JSON.stringify({
            stashes: validItems
          })
        }).then(() => {
          // Re-fetch from server to get canonical state
          return apiFetch("/api/stashes");
        }).then(serverData => {
          setItems(serverData.stashes);
        }).catch(err => console.error("[Sync] Import failed:", err.message));
      } else {
        alert("This doesn't look like a valid Stash backup file.");
      }
    },
    onLogout: handleLogout,
    onSaveDigestSettings: saveDigestSettings
  }), /*#__PURE__*/React.createElement(AnalyticsDashboard, {
    isOpen: analyticsOpen,
    onClose: () => setAnalyticsOpen(false),
    items: items,
    theme: theme,
    customCategories: settings.customCategories
  }), reminderPickerId && /*#__PURE__*/React.createElement(ReminderPicker, {
    onPick: isoDate => setReminder(reminderPickerId, isoDate),
    onClose: () => setReminderPickerId(null),
    theme: theme
  }), showVerifyModal && /*#__PURE__*/React.createElement("div", {
    onClick: () => {
      setShowVerifyModal(false);
      setVerifyError("");
      setVerifyCode("");
    },
    style: {
      position: "fixed",
      inset: 0,
      background: theme.overlayBg,
      backdropFilter: "blur(16px)",
      zIndex: 950,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      animation: "softFadeIn 0.25s ease"
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      background: theme.settingsBg,
      borderRadius: "20px",
      border: `1px solid ${theme.border}`,
      padding: "32px 28px",
      width: "92%",
      maxWidth: "380px",
      boxShadow: theme.shadowHover,
      animation: "settingsIn 0.35s ease"
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "20px",
      fontWeight: 400,
      color: theme.textSecondary,
      margin: "0 0 8px"
    }
  }, "Verify your email"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "13px",
      color: theme.textFaint,
      margin: "0 0 20px"
    }
  }, "Enter the 6-digit code sent to your email"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: verifyCode,
    onChange: e => {
      setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6));
      setVerifyError("");
    },
    placeholder: "000000",
    maxLength: 6,
    style: {
      width: "100%",
      padding: "12px 14px",
      borderRadius: "12px",
      border: `1px solid ${theme.border}`,
      background: theme.inputBg,
      color: theme.textPrimary,
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "20px",
      letterSpacing: "0.3em",
      textAlign: "center",
      outline: "none",
      boxSizing: "border-box",
      marginBottom: "16px"
    }
  }), verifyError && /*#__PURE__*/React.createElement("div", {
    style: {
      color: theme.deleteColor,
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      marginBottom: "12px",
      textAlign: "center"
    }
  }, verifyError), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "10px"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setShowVerifyModal(false);
      setVerifyError("");
      setVerifyCode("");
    },
    style: {
      flex: 1,
      padding: "12px",
      borderRadius: "12px",
      border: `1px solid ${theme.border}`,
      background: "none",
      color: theme.textSecondary,
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "14px",
      cursor: "pointer"
    }
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    onClick: submitVerificationCode,
    disabled: verifyCode.length !== 6 || verifyLoading,
    style: {
      flex: 1,
      padding: "12px",
      borderRadius: "12px",
      border: "none",
      background: verifyCode.length !== 6 || verifyLoading ? theme.disabledBg : theme.accentGradient,
      color: verifyCode.length !== 6 || verifyLoading ? theme.disabledText : "#FFFFFF",
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "14px",
      fontWeight: 500,
      cursor: verifyCode.length !== 6 || verifyLoading ? "default" : "pointer"
    }
  }, verifyLoading ? "Verifying..." : "Verify")))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "720px",
      margin: "0 auto",
      padding: "40px 20px",
      animation: "softFadeIn 0.6s ease"
    }
  }, !emailVerified && token && /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#FFF3CD",
      border: "1px solid #FFECB5",
      borderRadius: "14px",
      padding: "14px 18px",
      marginBottom: "20px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      animation: "cardIn 0.4s ease"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "13.5px",
      color: "#5C5347"
    }
  }, "Please verify your email to enable digest emails."), /*#__PURE__*/React.createElement("button", {
    onClick: sendVerificationCode,
    disabled: verifyLoading,
    style: {
      background: "#6B5F53",
      color: "#FFFFFF",
      border: "none",
      borderRadius: "10px",
      padding: "8px 16px",
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "13px",
      fontWeight: 500,
      cursor: verifyLoading ? "default" : "pointer",
      whiteSpace: "nowrap",
      flexShrink: 0,
      opacity: verifyLoading ? 0.6 : 1
    }
  }, verifyLoading ? "Sending..." : "Send Code")), verifyError && !showVerifyModal && /*#__PURE__*/React.createElement("div", {
    style: {
      color: theme.deleteColor,
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      marginBottom: "12px",
      textAlign: "center"
    }
  }, verifyError), verifySuccess && /*#__PURE__*/React.createElement("div", {
    style: {
      background: theme.checkBg,
      color: theme.checkColor,
      borderRadius: "14px",
      padding: "12px 18px",
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "13.5px",
      marginBottom: "20px",
      textAlign: "center",
      animation: "cardIn 0.4s ease"
    }
  }, verifySuccess), /*#__PURE__*/React.createElement("header", {
    style: {
      marginBottom: "36px",
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      paddingBottom: "20px",
      borderBottom: `1px solid ${theme.border}`,
      backgroundImage: theme.pageBg === "#1C1A17" ? "none" : "linear-gradient(180deg, rgba(250,247,242,0) 60%, rgba(237,232,224,0.3) 100%)"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "36px",
      fontWeight: 400,
      margin: "0 0 4px",
      color: theme.textSecondary,
      letterSpacing: "0.04em"
    }
  }, "Stash"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: "13.5px",
      color: theme.textGhost,
      margin: 0,
      fontStyle: "italic",
      opacity: 0.85
    }
  }, "the things worth holding on to")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "8px"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setAnalyticsOpen(true),
    style: {
      background: theme.hoverBg,
      border: `1px solid ${theme.border}`,
      color: theme.textMuted,
      cursor: "pointer",
      fontSize: "13px",
      padding: "7px 14px",
      borderRadius: "10px",
      transition: "all 0.25s ease",
      fontFamily: "'DM Sans', sans-serif"
    },
    onMouseEnter: e => {
      e.currentTarget.style.color = theme.textSecondary;
      e.currentTarget.style.borderColor = theme.borderHover;
    },
    onMouseLeave: e => {
      e.currentTarget.style.color = theme.textMuted;
      e.currentTarget.style.borderColor = theme.border;
    }
  }, "Stats"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setSettingsOpen(true),
    style: {
      background: theme.hoverBg,
      border: `1px solid ${theme.border}`,
      color: theme.textMuted,
      cursor: "pointer",
      fontSize: "13px",
      padding: "7px 14px",
      borderRadius: "10px",
      transition: "all 0.25s ease",
      fontFamily: "'DM Sans', sans-serif"
    },
    onMouseEnter: e => {
      e.currentTarget.style.color = theme.textSecondary;
      e.currentTarget.style.borderColor = theme.borderHover;
    },
    onMouseLeave: e => {
      e.currentTarget.style.color = theme.textMuted;
      e.currentTarget.style.borderColor = theme.border;
    }
  }, "Settings"))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: theme.pageBg === "#1C1A17" ? theme.inputBg : "#FFFDF9",
      borderRadius: "16px",
      border: `1px solid ${pendingImage ? theme.borderHover : theme.border}`,
      padding: "4px",
      marginBottom: "28px",
      transition: "all 0.35s ease",
      boxShadow: "0 2px 12px rgba(0,0,0,0.06)"
    }
  }, pendingImage && /*#__PURE__*/React.createElement("div", {
    style: {
      margin: "14px 14px 6px",
      position: "relative",
      display: "inline-block"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: pendingImage.data,
    alt: "Pending",
    style: {
      maxHeight: "110px",
      maxWidth: "180px",
      borderRadius: "12px",
      border: `1px solid ${theme.border}`,
      display: "block"
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => setPendingImage(null),
    style: {
      position: "absolute",
      top: "-7px",
      right: "-7px",
      width: "22px",
      height: "22px",
      borderRadius: "50%",
      background: theme.deleteColor,
      border: `2px solid ${theme.inputBg}`,
      color: "#fff",
      fontSize: "11px",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      lineHeight: 1,
      padding: 0
    }
  }, "\xD7"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "5px",
      fontSize: "11px",
      color: theme.textMuted,
      fontFamily: "'DM Sans', sans-serif",
      fontStyle: "italic"
    }
  }, pendingImage.fileName)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-end",
      gap: "4px"
    }
  }, /*#__PURE__*/React.createElement("textarea", {
    ref: inputRef,
    value: inputValue,
    onChange: e => setInputValue(e.target.value),
    onKeyDown: handleKeyDown,
    placeholder: pendingImage ? "Add a note about this photo…" : "What would you like to remember?",
    rows: 1,
    style: {
      flex: 1,
      background: "none",
      border: "none",
      color: theme.textPrimary,
      fontSize: "15.5px",
      fontFamily: "'Lora', serif",
      padding: "16px 18px",
      resize: "none",
      lineHeight: "1.6"
    },
    onInput: e => {
      e.target.style.height = "auto";
      e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: addItem,
    disabled: !hasContent,
    style: {
      background: hasContent ? theme.accent : theme.disabledBg,
      border: "none",
      color: hasContent ? "#FAF7F2" : theme.disabledText,
      borderRadius: "12px",
      padding: "10px 20px",
      fontSize: "14px",
      fontFamily: "'DM Sans', sans-serif",
      fontWeight: 500,
      cursor: hasContent ? "pointer" : "default",
      transition: "all 0.3s ease",
      margin: "6px",
      whiteSpace: "nowrap",
      opacity: hasContent ? 1 : 0.7
    }
  }, "Stash")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "6px 6px 4px",
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "category-scroll",
    style: {
      display: "flex",
      alignItems: "center",
      gap: "2px",
      overflowX: "auto",
      scrollBehavior: "smooth",
      WebkitOverflowScrolling: "touch",
      msOverflowStyle: "none",
      scrollbarWidth: "none",
      padding: "2px 10px",
      maskImage: "linear-gradient(to right, transparent 0px, black 12px, black calc(100% - 12px), transparent 100%)",
      WebkitMaskImage: "linear-gradient(to right, transparent 0px, black 12px, black calc(100% - 12px), transparent 100%)"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setSelectedType("auto"),
    style: {
      background: selectedType === "auto" ? theme.hoverBg : "transparent",
      border: selectedType === "auto" ? `1px solid ${theme.border}` : "1px solid transparent",
      color: selectedType === "auto" ? theme.textSecondary : theme.textGhost,
      borderRadius: "20px",
      padding: "5px 14px",
      fontSize: "12px",
      fontFamily: "'DM Sans', sans-serif",
      cursor: "pointer",
      transition: "all 0.2s ease",
      fontStyle: "italic",
      whiteSpace: "nowrap",
      flexShrink: 0
    }
  }, "Auto"), getAllTypes(settings.customCategories).map(type => {
    const info = getTypeInfo(type, settings.customCategories);
    const colors = getTypeColors(type, theme, settings.customCategories);
    const isActive = selectedType === type;
    /* Selected pill gets a SOLID type color background with white text,
       making the active choice visually obvious. Unselected pills stay muted. */
    const typeColor = TYPE_COLORS[type] || colors.color;
    return /*#__PURE__*/React.createElement("button", {
      key: type,
      onClick: () => setSelectedType(isActive ? "auto" : type),
      style: {
        background: isActive ? typeColor : "transparent",
        border: isActive ? `1px solid ${typeColor}` : "1px solid transparent",
        color: isActive ? "#FFFFFF" : theme.textGhost,
        borderRadius: "20px",
        padding: "5px 14px",
        fontSize: "12px",
        fontFamily: "'DM Sans', sans-serif",
        cursor: "pointer",
        transition: "all 0.2s ease",
        whiteSpace: "nowrap",
        flexShrink: 0
      },
      onMouseEnter: e => {
        if (!isActive) e.currentTarget.style.color = typeColor;
      },
      onMouseLeave: e => {
        if (!isActive) e.currentTarget.style.color = theme.textGhost;
      }
    }, info.label);
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "2px 18px 12px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "12px",
      color: theme.textGhost,
      fontFamily: "'DM Sans', sans-serif",
      fontStyle: "italic"
    }
  }, "enter to save \xB7 #tags to organize"), /*#__PURE__*/React.createElement("label", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "5px",
      fontSize: "12px",
      color: theme.textFaint,
      fontFamily: "'DM Sans', sans-serif",
      cursor: "pointer",
      padding: "5px 12px",
      borderRadius: "10px",
      transition: "all 0.25s ease"
    },
    onMouseEnter: e => {
      e.currentTarget.style.background = theme.hoverBg;
      e.currentTarget.style.color = theme.textSecondary;
    },
    onMouseLeave: e => {
      e.currentTarget.style.background = "transparent";
      e.currentTarget.style.color = theme.textFaint;
    }
  }, "Upload photo", /*#__PURE__*/React.createElement("input", {
    type: "file",
    accept: "image/*",
    onChange: handleFileSelect,
    style: {
      display: "none"
    }
  })))), items.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: "20px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: theme.searchBg,
      borderRadius: "12px",
      border: `1px solid ${theme.border}`,
      padding: "10px 16px",
      marginBottom: "10px",
      display: "flex",
      alignItems: "center",
      gap: "10px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: theme.textGhost,
      fontSize: "14px",
      fontFamily: "'DM Sans', sans-serif"
    }
  }, "\u2315"), /*#__PURE__*/React.createElement("input", {
    ref: searchRef,
    type: "text",
    value: searchQuery,
    onChange: e => setSearchQuery(e.target.value),
    placeholder: "Search your memories\u2026",
    "aria-label": "Search stashes",
    style: {
      flex: 1,
      background: "none",
      border: "none",
      color: theme.textPrimary,
      fontSize: "14px",
      fontFamily: "'Lora', serif",
      fontStyle: "italic"
    }
  }), searchQuery && /*#__PURE__*/React.createElement("button", {
    onClick: () => setSearchQuery(""),
    style: {
      background: "none",
      border: "none",
      color: theme.textFaint,
      cursor: "pointer",
      fontSize: "14px",
      padding: "2px 6px"
    }
  }, "\xD7"), !searchQuery && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "10px",
      fontFamily: "'DM Sans', sans-serif",
      color: theme.textGhost,
      background: theme.border + "44",
      border: `1px solid ${theme.border}`,
      borderRadius: "4px",
      padding: "2px 6px",
      whiteSpace: "nowrap",
      userSelect: "none",
      lineHeight: "1.4"
    }
  }, navigator.platform?.includes("Mac") ? "⌘K" : "Ctrl+K")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "6px",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setFilterType("all"),
    "aria-pressed": filterType === "all",
    style: {
      background: filterType === "all" ? theme.cardBg : "transparent",
      border: filterType === "all" ? `1px solid ${theme.border}` : `1px solid ${theme.border}88`,
      boxShadow: filterType === "all" ? theme.shadowLight : "none",
      color: filterType === "all" ? theme.textSecondary : theme.textGhost,
      borderRadius: "20px",
      padding: "6px 14px",
      fontSize: "12px",
      fontFamily: "'DM Sans', sans-serif",
      cursor: "pointer",
      transition: "all 0.25s ease"
    }
  }, "All ", items.filter(i => settings.showCompleted || !i.completed).length), Object.entries(typeCounts).map(([type, count]) => {
    const colors = getTypeColors(type, theme, settings.customCategories);
    const labels = getTypeInfo(type, settings.customCategories);
    const isActive = filterType === type;
    const typeColor = TYPE_COLORS[type] || colors.color;
    return /*#__PURE__*/React.createElement("button", {
      key: type,
      onClick: () => setFilterType(isActive ? "all" : type),
      "aria-pressed": isActive,
      style: {
        background: isActive ? `${typeColor}22` : "transparent",
        border: isActive ? `1px solid ${typeColor}55` : `1px solid ${theme.border}88`,
        color: isActive ? typeColor : theme.textGhost,
        borderRadius: "20px",
        padding: "6px 14px",
        fontSize: "12px",
        fontFamily: "'DM Sans', sans-serif",
        cursor: "pointer",
        transition: "all 0.25s ease"
      }
    }, labels.label, " ", count);
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: "8px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "8px"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setBulkMode(prev => !prev);
      setBulkSelected(new Set());
      setBulkRetypeOpen(false);
      setBulkTagInput("");
    },
    style: {
      background: bulkMode ? theme.accent + "18" : "none",
      border: bulkMode ? `1px solid ${theme.accent}33` : "1px solid transparent",
      cursor: "pointer",
      color: bulkMode ? theme.accent : theme.textMuted,
      fontSize: "12px",
      fontFamily: "'DM Sans', sans-serif",
      padding: "3px 10px",
      borderRadius: "8px",
      transition: "all 0.2s ease"
    }
  }, bulkMode ? `${bulkSelected.size} selected` : "Select"), bulkMode && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      // Add all currently VISIBLE (filtered) item IDs to selection
      const allIds = new Set(filteredItems.map(i => i.id));
      setBulkSelected(allIds);
    },
    style: {
      background: "none",
      border: "none",
      cursor: "pointer",
      color: theme.textMuted,
      fontSize: "11px",
      fontFamily: "'DM Sans', sans-serif",
      padding: "2px 6px",
      textDecoration: "underline",
      textDecorationColor: theme.border,
      textUnderlineOffset: "2px"
    }
  }, "All"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setBulkSelected(new Set()),
    style: {
      background: "none",
      border: "none",
      cursor: "pointer",
      color: theme.textMuted,
      fontSize: "11px",
      fontFamily: "'DM Sans', sans-serif",
      padding: "2px 6px",
      textDecoration: "underline",
      textDecorationColor: theme.border,
      textUnderlineOffset: "2px"
    }
  }, "None"))), /*#__PURE__*/React.createElement("button", {
    onClick: () => setSortOrder(prev => prev === "newest" ? "oldest" : "newest"),
    style: {
      background: "none",
      border: "none",
      cursor: "pointer",
      color: theme.textMuted,
      fontSize: "12px",
      fontFamily: "'DM Sans', sans-serif",
      padding: "2px 4px",
      transition: "color 0.2s ease",
      display: "flex",
      alignItems: "center",
      gap: "4px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "10px"
    }
  }, sortOrder === "newest" ? "↓" : "↑"), sortOrder === "newest" ? "Newest first" : "Oldest first")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "8px"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setAdvancedOpen(prev => !prev),
    style: {
      background: "none",
      border: "none",
      cursor: "pointer",
      color: dateFrom || dateTo || tagFilter ? theme.accent : theme.textMuted,
      fontSize: "12px",
      fontFamily: "'DM Sans', sans-serif",
      padding: "3px 0",
      display: "flex",
      alignItems: "center",
      gap: "6px",
      transition: "color 0.2s ease"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "10px",
      transition: "transform 0.2s ease",
      transform: advancedOpen ? "rotate(90deg)" : "rotate(0deg)",
      display: "inline-block"
    }
  }, "\u25B8"), "Advanced filters", (dateFrom || dateTo || tagFilter) && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "10px",
      background: theme.accent + "22",
      color: theme.accent,
      borderRadius: "10px",
      padding: "1px 8px"
    }
  }, "active")), advancedOpen && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "10px",
      padding: "14px",
      background: theme.cardBg,
      borderRadius: "12px",
      border: `1px solid ${theme.border}`,
      animation: "softFadeIn 0.2s ease"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: "14px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "12px",
      color: theme.textMuted,
      marginBottom: "8px",
      fontWeight: 500
    }
  }, "Date range"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "8px",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "date",
    value: dateFrom,
    onChange: e => setDateFrom(e.target.value),
    style: {
      flex: 1,
      background: theme.hoverBg,
      border: `1px solid ${theme.border}`,
      borderRadius: "8px",
      padding: "6px 10px",
      color: theme.textPrimary,
      fontSize: "12px",
      fontFamily: "'DM Sans', sans-serif"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: theme.textGhost,
      fontSize: "12px"
    }
  }, "to"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    value: dateTo,
    onChange: e => setDateTo(e.target.value),
    style: {
      flex: 1,
      background: theme.hoverBg,
      border: `1px solid ${theme.border}`,
      borderRadius: "8px",
      padding: "6px 10px",
      color: theme.textPrimary,
      fontSize: "12px",
      fontFamily: "'DM Sans', sans-serif"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: "14px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "12px",
      color: theme.textMuted,
      marginBottom: "8px",
      fontWeight: 500
    }
  }, "Filter by tags"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: tagFilter,
    onChange: e => setTagFilter(e.target.value),
    placeholder: "e.g. recipe, italian",
    style: {
      width: "100%",
      background: theme.hoverBg,
      border: `1px solid ${theme.border}`,
      borderRadius: "8px",
      padding: "7px 12px",
      color: theme.textPrimary,
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      boxSizing: "border-box"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: "11px",
      color: theme.textGhost,
      fontStyle: "italic",
      marginTop: "4px"
    }
  }, "Comma-separated \u2014 shows items with ALL specified tags")), (dateFrom || dateTo || tagFilter) && /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setDateFrom("");
      setDateTo("");
      setTagFilter("");
    },
    style: {
      background: "none",
      border: `1px solid ${theme.border}`,
      color: theme.textMuted,
      borderRadius: "8px",
      padding: "5px 14px",
      fontSize: "12px",
      fontFamily: "'DM Sans', sans-serif",
      cursor: "pointer",
      transition: "all 0.2s ease"
    }
  }, "Clear filters"))), bulkMode && bulkSelected.size > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "10px",
      padding: "12px",
      background: theme.cardBg,
      borderRadius: "12px",
      border: `1px solid ${theme.border}`,
      animation: "softFadeIn 0.2s ease forwards"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "8px",
      flexWrap: "wrap",
      marginBottom: "10px"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => completeMultiple(bulkSelected),
    style: {
      background: theme.checkBg,
      border: `1px solid ${theme.checkColor}44`,
      color: theme.checkColor,
      cursor: "pointer",
      fontSize: "12px",
      fontFamily: "'DM Sans', sans-serif",
      fontWeight: 500,
      padding: "5px 14px",
      borderRadius: "8px",
      transition: "all 0.2s ease"
    }
  }, "\u2713 Complete"), /*#__PURE__*/React.createElement("button", {
    onClick: () => deleteMultiple(bulkSelected),
    style: {
      background: theme.deleteBg,
      border: `1px solid ${theme.deleteColor}44`,
      color: theme.deleteColor,
      cursor: "pointer",
      fontSize: "12px",
      fontFamily: "'DM Sans', sans-serif",
      fontWeight: 500,
      padding: "5px 14px",
      borderRadius: "8px",
      transition: "all 0.2s ease"
    }
  }, "\xD7 Delete"), /*#__PURE__*/React.createElement("button", {
    onClick: () => bulkExport(bulkSelected),
    style: {
      background: theme.hoverBg,
      border: `1px solid ${theme.border}`,
      color: theme.textSecondary,
      cursor: "pointer",
      fontSize: "12px",
      fontFamily: "'DM Sans', sans-serif",
      fontWeight: 500,
      padding: "5px 14px",
      borderRadius: "8px",
      transition: "all 0.2s ease"
    }
  }, "\u2193 Export")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "6px",
      alignItems: "center",
      marginBottom: "8px"
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: bulkTagInput,
    onChange: e => setBulkTagInput(e.target.value),
    placeholder: "Add tags (comma-separated)",
    onKeyDown: e => {
      if (e.key === "Enter" && bulkTagInput.trim()) {
        // Split by comma, trim whitespace, lowercase, remove empties
        const tags = bulkTagInput.split(",").map(t => t.trim().toLowerCase()).filter(t => t.length > 0);
        bulkAddTags(bulkSelected, tags);
        setBulkTagInput("");
      }
    },
    style: {
      flex: 1,
      background: theme.hoverBg,
      border: `1px solid ${theme.border}`,
      borderRadius: "8px",
      padding: "6px 10px",
      color: theme.textPrimary,
      fontSize: "12px",
      fontFamily: "'DM Sans', sans-serif"
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (bulkTagInput.trim()) {
        const tags = bulkTagInput.split(",").map(t => t.trim().toLowerCase()).filter(t => t.length > 0);
        bulkAddTags(bulkSelected, tags);
        setBulkTagInput("");
      }
    },
    disabled: !bulkTagInput.trim(),
    style: {
      background: bulkTagInput.trim() ? theme.accentGradient : theme.disabledBg,
      border: "none",
      color: bulkTagInput.trim() ? "#FAF7F2" : theme.disabledText,
      borderRadius: "8px",
      padding: "6px 12px",
      fontSize: "11px",
      fontFamily: "'DM Sans', sans-serif",
      fontWeight: 500,
      cursor: bulkTagInput.trim() ? "pointer" : "default"
    }
  }, "Tag")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("button", {
    onClick: () => setBulkRetypeOpen(prev => !prev),
    style: {
      background: "none",
      border: "none",
      cursor: "pointer",
      color: theme.textMuted,
      fontSize: "11px",
      fontFamily: "'DM Sans', sans-serif",
      padding: "2px 0",
      display: "flex",
      alignItems: "center",
      gap: "4px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "9px",
      transition: "transform 0.2s ease",
      transform: bulkRetypeOpen ? "rotate(90deg)" : "rotate(0deg)",
      display: "inline-block"
    }
  }, "\u25B8"), "Change type"), bulkRetypeOpen && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "4px",
      flexWrap: "wrap",
      marginTop: "6px",
      animation: "softFadeIn 0.15s ease"
    }
  }, Object.keys(typeLabels).map(type => {
    const typeColor = TYPE_COLORS[type] || theme.textMuted;
    return /*#__PURE__*/React.createElement("button", {
      key: type,
      onClick: () => {
        bulkRetype(bulkSelected, type);
        setBulkRetypeOpen(false);
      },
      style: {
        background: `${typeColor}15`,
        border: `1px solid ${typeColor}33`,
        color: typeColor,
        borderRadius: "14px",
        padding: "3px 10px",
        fontSize: "11px",
        fontFamily: "'DM Sans', sans-serif",
        cursor: "pointer",
        transition: "all 0.15s ease"
      },
      onMouseEnter: e => {
        e.currentTarget.style.background = `${typeColor}30`;
      },
      onMouseLeave: e => {
        e.currentTarget.style.background = `${typeColor}15`;
      }
    }, typeLabels[type].label);
  }))))), (() => {
    const activeFiltered = filteredItems.filter(i => !i.completed);
    const completedFiltered = filteredItems.filter(i => i.completed);
    const hasAny = items.length > 0;
    const hasResults = activeFiltered.length > 0 || completedFiltered.length > 0;
    if (!hasAny) return /*#__PURE__*/React.createElement(EmptyState, {
      theme: theme
    });
    if (!hasResults) {
      const emptyHints = {
        link: "Paste a URL to save it here",
        contact: "Scan a business card or add contact info",
        travel: "Save flight details, hotel bookings, or trip ideas",
        work: "Stash meeting notes, deadlines, or project ideas",
        money: "Track expenses, invoices, or financial notes",
        health: "Log appointments, prescriptions, or wellness notes",
        media: "Save movie recs, podcast links, or playlist ideas",
        event: "Remember dates, parties, or upcoming plans",
        reading: "Bookmark articles, books, or things to read later",
        food: "Save recipes, restaurant names, or meal plans",
        idea: "Jot down a thought — you never know where it'll lead",
        person: "Remember someone's name, details, or context",
        photo: "Drop a photo to get started",
        note: "Type anything — it all belongs here"
      };
      const hint = filterType !== "all" && emptyHints[filterType] ? emptyHints[filterType] : `nothing matches "${searchQuery || filterType}"`;
      return /*#__PURE__*/React.createElement("div", {
        style: {
          textAlign: "center",
          padding: "48px 24px"
        }
      }, /*#__PURE__*/React.createElement("p", {
        style: {
          fontFamily: "'Lora', serif",
          fontSize: "15px",
          color: theme.textFaint,
          fontStyle: "italic",
          margin: "0 0 6px"
        }
      }, filterType !== "all" && !searchQuery ? `No ${filterType}s yet` : `Nothing found`), /*#__PURE__*/React.createElement("p", {
        style: {
          fontFamily: "'DM Sans', sans-serif",
          fontSize: "13px",
          color: theme.textGhost,
          margin: 0
        }
      }, hint));
    }
    return /*#__PURE__*/React.createElement("div", null, activeFiltered.length > 0 && /*#__PURE__*/React.createElement("div", null, groupItemsByDate(activeFiltered).map(group => /*#__PURE__*/React.createElement("div", {
      key: group.label
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "4px 4px 8px",
        marginTop: "24px"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "11.5px",
        fontWeight: 500,
        color: theme.textGhost,
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        whiteSpace: "nowrap"
      }
    }, group.label, /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "6px",
        fontWeight: 400,
        opacity: 0.6
      }
    }, "\xB7 ", group.items.length)), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        height: "1px",
        background: theme.border
      }
    })), group.items.map(item => /*#__PURE__*/React.createElement(StashCard, {
      key: item.id,
      item: item,
      onDelete: deleteItem,
      onToggleComplete: toggleComplete,
      onEdit: editItem,
      onTogglePin: togglePin,
      onSetReminder: setReminder,
      onScanCard: scanBusinessCard,
      isScanning: scanningId === item.id,
      onViewImage: src => setViewingImage(src),
      theme: theme,
      timezone: settings.timezone,
      customCategories: settings.customCategories,
      isSlidingOut: slidingOut.has(item.id),
      bulkMode: bulkMode,
      isSelected: bulkSelected.has(item.id),
      onToggleBulkSelect: toggleBulkSelect,
      searchQuery: searchQuery
    }))))), activeFiltered.length === 0 && completedFiltered.length > 0 && !searchQuery && /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "center",
        padding: "40px 24px 24px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: "48px",
        height: "48px",
        borderRadius: "50%",
        background: theme.checkBg,
        margin: "0 auto 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "20px",
        color: theme.checkColor,
        border: `1px solid ${theme.checkColor}33`
      }
    }, "\u2713"), /*#__PURE__*/React.createElement("p", {
      style: {
        fontFamily: "'Lora', serif",
        fontSize: "17px",
        color: theme.textSecondary,
        margin: "0 0 4px"
      }
    }, "All caught up"), /*#__PURE__*/React.createElement("p", {
      style: {
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "13px",
        color: theme.textFaint,
        fontStyle: "italic",
        margin: 0
      }
    }, "Everything's been handled \u2014 nice work")), completedFiltered.length > 0 && settings.showCompleted && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: activeFiltered.length > 0 ? "28px" : "8px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "14px",
        padding: "0 4px"
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => setCompletedExpanded(prev => !prev),
      "aria-expanded": completedExpanded,
      style: {
        background: "none",
        border: "none",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "4px 0"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: "11px",
        color: theme.textGhost,
        transition: "transform 0.3s ease",
        transform: completedExpanded ? "rotate(90deg)" : "rotate(0deg)",
        display: "inline-block"
      }
    }, "\u25B8"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "13px",
        color: theme.textMuted,
        fontWeight: 500,
        letterSpacing: "0.03em"
      }
    }, "Completed"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "12px",
        color: theme.textGhost,
        fontStyle: "italic"
      }
    }, completedFiltered.length)), confirmClearAll ? /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: "6px"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: "12px",
        color: theme.deleteColor,
        fontFamily: "'DM Sans', sans-serif"
      }
    }, "Clear ", completedFiltered.length, " items?"), /*#__PURE__*/React.createElement("button", {
      onClick: clearAllCompleted,
      style: {
        background: theme.deleteBg,
        border: `1px solid ${theme.deleteColor}44`,
        color: theme.deleteColor,
        cursor: "pointer",
        fontSize: "11px",
        fontFamily: "'DM Sans', sans-serif",
        fontWeight: 500,
        padding: "3px 10px",
        borderRadius: "6px",
        transition: "all 0.2s ease"
      }
    }, "Yes"), /*#__PURE__*/React.createElement("button", {
      onClick: () => setConfirmClearAll(false),
      style: {
        background: "none",
        border: `1px solid ${theme.border}`,
        color: theme.textMuted,
        cursor: "pointer",
        fontSize: "11px",
        fontFamily: "'DM Sans', sans-serif",
        padding: "3px 10px",
        borderRadius: "6px",
        transition: "all 0.2s ease"
      }
    }, "No")) : /*#__PURE__*/React.createElement("button", {
      onClick: () => setConfirmClearAll(true),
      style: {
        background: "none",
        border: "none",
        color: theme.textGhost,
        cursor: "pointer",
        fontSize: "12px",
        fontFamily: "'DM Sans', sans-serif",
        fontStyle: "italic",
        padding: "4px 10px",
        borderRadius: "8px",
        transition: "all 0.25s ease"
      },
      onMouseEnter: e => {
        e.currentTarget.style.color = theme.deleteColor;
        e.currentTarget.style.background = theme.deleteBg;
      },
      onMouseLeave: e => {
        e.currentTarget.style.color = theme.textGhost;
        e.currentTarget.style.background = "none";
      }
    }, "clear all")), /*#__PURE__*/React.createElement("div", {
      style: {
        height: "1px",
        background: theme.border,
        marginBottom: "14px"
      }
    }), completedExpanded && /*#__PURE__*/React.createElement("div", {
      style: {
        animation: "cardIn 0.3s ease forwards"
      }
    }, completedFiltered.map(item => /*#__PURE__*/React.createElement(StashCard, {
      key: item.id,
      item: item,
      onDelete: deleteItem,
      onToggleComplete: toggleComplete,
      onEdit: editItem,
      onTogglePin: togglePin,
      onSetReminder: setReminder,
      onScanCard: scanBusinessCard,
      isScanning: scanningId === item.id,
      onViewImage: src => setViewingImage(src),
      theme: theme,
      timezone: settings.timezone,
      customCategories: settings.customCategories,
      isSlidingOut: slidingOut.has(item.id),
      bulkMode: bulkMode,
      isSelected: bulkSelected.has(item.id),
      onToggleBulkSelect: toggleBulkSelect,
      searchQuery: searchQuery
    })))));
  })(), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "40px",
      paddingTop: "20px",
      borderTop: `1px solid ${theme.border}`,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "'Lora', serif",
      fontStyle: "italic",
      fontSize: "12px",
      color: theme.textGhost
    }
  }, activeItems.length, " ", activeItems.length === 1 ? "memory" : "memories", " kept safe", completedItems.length > 0 && ` · ${completedItems.length} completed`), items.length > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: () => exportData(items, settings),
    style: {
      background: "none",
      border: "none",
      color: theme.textGhost,
      cursor: "pointer",
      fontSize: "12px",
      fontFamily: "'DM Sans', sans-serif",
      fontStyle: "italic",
      padding: "2px 0",
      transition: "color 0.2s ease"
    },
    onMouseEnter: e => {
      e.currentTarget.style.color = theme.textMuted;
    },
    onMouseLeave: e => {
      e.currentTarget.style.color = theme.textGhost;
    }
  }, "Export"))), !undoItem && /*#__PURE__*/React.createElement(InstallBanner, {
    theme: theme
  }), undoItem && /*#__PURE__*/React.createElement("div", {
    role: "alert",
    "aria-live": "assertive",
    style: {
      position: "fixed",
      bottom: "24px",
      left: "50%",
      transform: "translateX(-50%)",
      background: theme.cardBg,
      border: `1px solid ${theme.border}`,
      borderRadius: "14px",
      padding: "10px 12px 10px 18px",
      boxShadow: theme.shadowMedium,
      zIndex: 1000,
      display: "flex",
      alignItems: "center",
      gap: "12px",
      animation: "toastIn 0.3s ease forwards",
      fontFamily: "'DM Sans', sans-serif"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "13px",
      color: theme.textSecondary
    }
  }, undoItem.label), /*#__PURE__*/React.createElement("button", {
    onClick: restoreItem,
    style: {
      background: theme.accent,
      border: "none",
      color: "#FAF7F2",
      borderRadius: "8px",
      padding: "5px 14px",
      fontSize: "12.5px",
      fontFamily: "'DM Sans', sans-serif",
      fontWeight: 500,
      cursor: "pointer",
      transition: "opacity 0.2s ease"
    }
  }, "Undo")));
}

// ============================================================
// PWA INSTALL BANNER COMPONENT
// ============================================================
function InstallBanner({
  theme
}) {
  const [canInstall, setCanInstall] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const onInstallable = () => setCanInstall(true);
    const onInstalled = () => {
      setCanInstall(false);
      setDismissed(false);
    };
    window.addEventListener("pwa-installable", onInstallable);
    window.addEventListener("pwa-installed", onInstalled);
    // Check if already installable
    if (window.deferredPrompt) setCanInstall(true);
    return () => {
      window.removeEventListener("pwa-installable", onInstallable);
      window.removeEventListener("pwa-installed", onInstalled);
    };
  }, []);

  // Fix #15: Use window.deferredPrompt consistently (matches the global listener)
  const handleInstall = async () => {
    if (!window.deferredPrompt) return;
    window.deferredPrompt.prompt();
    const result = await window.deferredPrompt.userChoice;
    if (result.outcome === "accepted") {
      console.log("[PWA] User accepted install");
    }
    window.deferredPrompt = null;
    setCanInstall(false);
  };

  // Don't show if installed, dismissed, or in standalone mode
  if (!canInstall || dismissed) return null;
  if (window.matchMedia("(display-mode: standalone)").matches) return null;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      bottom: "24px",
      left: "50%",
      transform: "translateX(-50%)",
      background: theme.cardBg,
      border: `1px solid ${theme.border}`,
      borderRadius: "16px",
      padding: "14px 18px",
      boxShadow: theme.shadowMedium,
      zIndex: 900,
      display: "flex",
      alignItems: "center",
      gap: "14px",
      maxWidth: "380px",
      width: "90%",
      animation: "toastIn 0.4s ease forwards",
      fontFamily: "'DM Sans', sans-serif"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "14px",
      fontWeight: 500,
      color: theme.textPrimary,
      marginBottom: "2px"
    }
  }, "Install Stash"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "12px",
      color: theme.textMuted
    }
  }, "Add to your home screen for quick access")), /*#__PURE__*/React.createElement("button", {
    onClick: handleInstall,
    style: {
      background: theme.accent,
      border: "none",
      color: "#FAF7F2",
      borderRadius: "10px",
      padding: "8px 16px",
      fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif",
      fontWeight: 500,
      cursor: "pointer",
      whiteSpace: "nowrap"
    }
  }, "Install"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setDismissed(true),
    "aria-label": "Close",
    style: {
      background: "none",
      border: "none",
      color: theme.textGhost,
      fontSize: "18px",
      cursor: "pointer",
      padding: "0 4px",
      lineHeight: 1
    }
  }, "\xD7"));
}

// ============================================================
// APP WRAPPER — adds the install banner
// ============================================================
function App() {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Stash, null));
}

// Mount the app
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(/*#__PURE__*/React.createElement(App, null));
