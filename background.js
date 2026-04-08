// Per-tab stats: { safe: number, unsafe: number, requests: [{url, group, safe}] }
const tabStats = new Map();

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

function updateBadge(tabId) {
  const s = tabStats.get(tabId);
  if (!s || (s.safe === 0 && s.unsafe === 0)) {
    browser.browserAction.setBadgeText({ tabId, text: "" });
    return;
  }
  let color;
  if (s.unsafe === 0) color = "#2ecc40";       // green
  else if (s.safe === 0) color = "#ff4136";    // red
  else color = "#ffdc00";                       // yellow
  browser.browserAction.setBadgeBackgroundColor({ tabId, color });
  browser.browserAction.setBadgeTextColor &&
    browser.browserAction.setBadgeTextColor({ tabId, color: "#000000" });
  browser.browserAction.setBadgeText({
    tabId,
    text: s.unsafe > 0 ? `${s.unsafe}` : "",
  });
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

// Reset stats on top-level navigation
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (details.type !== "main_frame") return;
    tabStats.set(details.tabId, { safe: 0, unsafe: 0, requests: [] });
    updateBadge(details.tabId);
  },
  { urls: ["<all_urls>"] }
);

browser.tabs.onRemoved.addListener((tabId) => tabStats.delete(tabId));

browser.runtime.onMessage.addListener(async (msg) => {
  if (msg && msg.type === "getStats") {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab) return { safe: 0, unsafe: 0, requests: [] };
    return getStats(tab.id);
  }
});
