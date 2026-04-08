// Per-tab stats: { safe: number, unsafe: number, requests: [{url, group, safe}] }
const tabStats = new Map();

// Invalidate in-flight badge/icon updates when a newer updateBadge starts for the same tab.
const badgeGen = new Map();

let logoImagePromise = null;
/** @type {Promise<Record<string, ImageData>>|null} */
let unsafeDotIconDataPromise = null;

// Heuristic: a key exchange group name is post-quantum safe if it references
// a known PQ KEM (ML-KEM / Kyber) — typically as a hybrid like X25519MLKEM768
// or X25519Kyber768Draft00.
function isPQSafeGroup(groupName) {
  if (!groupName) return false;
  const g = groupName.toLowerCase();
  return g.includes("mlkem") || g.includes("ml_kem") || g.includes("kyber");
}

function getStats(tabId) {
  let s = tabStats.get(tabId);
  if (!s) {
    s = { safe: 0, unsafe: 0, requests: [] };
    tabStats.set(tabId, s);
  }
  return s;
}

function loadLogoImage() {
  if (!logoImagePromise) {
    logoImagePromise = new Promise((resolve, reject) => {
      if (typeof document === "undefined") {
        reject(new Error("no document"));
        return;
      }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("logo load failed"));
      img.src = browser.runtime.getURL("logo.png");
    });
  }
  return logoImagePromise;
}

function drawUnsafeDotOnCanvas(ctx, size, img) {
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(img, 0, 0, size, size);
  const margin = Math.max(1, Math.floor(size * 0.06));
  const r = Math.max(4, Math.floor(size * 0.3));
  const cx = margin + r;
  const cy = margin + r;
  ctx.fillStyle = "#ff4136";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function makeUnsafeDotIconImageData() {
  if (!unsafeDotIconDataPromise) {
    unsafeDotIconDataPromise = (async () => {
      const img = await loadLogoImage();
      if (typeof document === "undefined") throw new Error("no document");
      const sizes = [16, 32, 48, 96];
      /** @type {Record<string, ImageData>} */
      const imageData = {};
      for (const size of sizes) {
        const c = document.createElement("canvas");
        c.width = size;
        c.height = size;
        const ctx = c.getContext("2d");
        drawUnsafeDotOnCanvas(ctx, size, img);
        imageData[String(size)] = ctx.getImageData(0, 0, size, size);
      }
      return imageData;
    })().catch((e) => {
      unsafeDotIconDataPromise = null;
      throw e;
    });
  }
  return unsafeDotIconDataPromise;
}

const defaultIconPath = { 200: "logo.png" };

async function updateBadge(tabId) {
  const g = (badgeGen.get(tabId) || 0) + 1;
  badgeGen.set(tabId, g);
  const current = () => g === badgeGen.get(tabId);

  const s = tabStats.get(tabId);
  if (!s || (s.safe === 0 && s.unsafe === 0)) {
    await browser.browserAction.setIcon({ tabId, path: defaultIconPath });
    browser.browserAction.setBadgeText({ tabId, text: "" });
    return;
  }

  if (s.unsafe > 0) {
    try {
      const imageData = await makeUnsafeDotIconImageData();
      if (!current()) return;
      await browser.browserAction.setIcon({ tabId, imageData });
    } catch (e) {
      if (!current()) return;
      await browser.browserAction.setIcon({ tabId, path: defaultIconPath });
    }
  } else {
    await browser.browserAction.setIcon({ tabId, path: defaultIconPath });
  }
  if (!current()) return;
  browser.browserAction.setBadgeText({ tabId, text: "" });
}

function resetTabStats(tabId) {
  tabStats.set(tabId, { safe: 0, unsafe: 0, requests: [] });
  updateBadge(tabId);
}

browser.webRequest.onHeadersReceived.addListener(
  async (details) => {
    if (details.tabId < 0) return;
    if (!details.url.startsWith("https://")) return;
    try {
      const info = await browser.webRequest.getSecurityInfo(details.requestId, {});
      if (!info || info.state !== "secure") return;
      const group = info.keaGroupName || "";
      const safe = isPQSafeGroup(group);
      const s = getStats(details.tabId);
      if (safe) s.safe++; else s.unsafe++;
      s.requests.push({ url: details.url, group, safe });
      if (s.requests.length > 200) s.requests.shift();
      updateBadge(details.tabId);
    } catch (e) {
      // ignore
    }
  },
  { urls: ["https://*/*"] },
  ["blocking"]
);

// Reset stats on full document navigation
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (details.type !== "main_frame") return;
    resetTabStats(details.tabId);
  },
  { urls: ["<all_urls>"] }
);

// Reset stats on in-document navigation (history.pushState / replaceState / hash)
browser.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.tabId < 0) return;
  if (details.frameId !== 0) return;
  resetTabStats(details.tabId);
});

browser.tabs.onRemoved.addListener((tabId) => {
  tabStats.delete(tabId);
  badgeGen.delete(tabId);
});

browser.runtime.onMessage.addListener(async (msg) => {
  if (msg && msg.type === "getStats") {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab) return { safe: 0, unsafe: 0, requests: [] };
    return getStats(tab.id);
  }
});
