const NATIVE_HOST = "com.cleanpagetool.host";
const SIMHASH_THRESHOLD = 5; // Hamming distance
const DEBUGGER_PROTOCOL = "1.3";
const MAX_CONTENT_CONCURRENCY = 6;
const MAX_DEBUGGER_CONCURRENCY = 4;
const THUMBNAIL_TTL_MS = 30 * 60 * 1000;
const MAX_THUMBNAILS = 30;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "scan") {
    scanAllTabs()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
    return true;
  }

  if (msg && msg.type === "closeTabs") {
    closeTabs(msg.tabIds || [])
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
    return true;
  }

  if (msg && msg.type === "downloadInstaller") {
    downloadInstaller()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
    return true;
  }

});

chrome.tabs.onActivated.addListener((activeInfo) => {
  captureActiveTabThumbnail(activeInfo.tabId, activeInfo.windowId).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab && tab.active) {
    captureActiveTabThumbnail(tabId, tab.windowId).catch(() => {});
  }
});

async function scanAllTabs() {
  const tabs = await chrome.tabs.query({});
  const tabInfos = tabs
    .filter((t) => t && typeof t.id === "number")
    .map((t) => ({
      id: t.id,
      windowId: t.windowId,
      url: t.url || "",
      title: t.title || "",
      favIconUrl: t.favIconUrl || "",
      active: Boolean(t.active),
      pinned: Boolean(t.pinned),
      lastAccessed: t.lastAccessed || 0,
    }));

  const summaries = await getSummaries(tabInfos);
  const fingerprints = buildFingerprints(tabInfos, summaries);

  const duplicateGroups = buildDuplicateGroups(tabInfos, fingerprints);
  const similarGroups = buildSimilarGroups(tabInfos, fingerprints, duplicateGroups);
  const estimates = buildEstimates(tabInfos, summaries);

  const processMap = await mapTabProcesses(tabInfos);
  const resources = await getResourceSamples(tabInfos, processMap);

  return {
    ok: true,
    generatedAt: Date.now(),
    tabs: tabInfos,
    summaries,
    fingerprints,
    groups: {
      duplicates: duplicateGroups,
      similar: similarGroups,
    },
    resources,
    estimates,
  };
}

async function closeTabs(tabIds) {
  const ids = Array.from(new Set(tabIds)).filter((id) => typeof id === "number");
  if (!ids.length) return;
  await chrome.tabs.remove(ids);
}

async function downloadInstaller() {
  if (!chrome.downloads || !chrome.downloads.download) {
    throw new Error("downloads API 不可用，请刷新扩展后再试");
  }

  const browser = detectBrowser();
  const extensionId = chrome.runtime.id;

  const script = [
    "@echo off",
    "setlocal",
    "",
    "set \"ROOT=\"",
    "set \"CANDIDATES=%USERPROFILE%\\Desktop\\Clean_Page_Tool;%USERPROFILE%\\Documents\\Clean_Page_Tool;%USERPROFILE%\\Downloads\\Clean_Page_Tool\"",
    "",
    "for %%P in (%CANDIDATES%) do (",
    "  if exist \"%%P\\native-host\\auto-install.ps1\" set \"ROOT=%%P\"",
    ")",
    "",
    "if not defined ROOT (",
    "  echo Clean_Page_Tool not found in common locations.",
    "  echo Enter project path (example: C:\\Users\\%USERNAME%\\Desktop\\Clean_Page_Tool):",
    "  set /p ROOT=",
    ")",
    "",
    "if not exist \"%ROOT%\\native-host\\auto-install.ps1\" (",
    "  echo auto-install.ps1 not found under: %ROOT%",
    "  pause",
    "  exit /b 1",
    ")",
    "",
    `powershell -NoProfile -ExecutionPolicy Bypass -File \"%ROOT%\\native-host\\install.ps1\" -ExtensionId ${extensionId} -Browser ${browser}`,
    "pause",
    ""
  ].join("\\r\\n");

  const dataUrl = "data:text/plain;charset=utf-8," + encodeURIComponent(script);

  await new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: dataUrl,
        filename: "Clean_Page_Tool_Install.cmd",
        saveAs: false
      },
      (downloadId) => {
        const err = chrome.runtime.lastError;
        if (err) return reject(new Error(err.message || String(err)));
        if (!downloadId) return reject(new Error("下载失败（未返回下载ID）"));
        resolve();
      }
    );
  });
}

async function captureActiveTabThumbnail(tabId, windowId) {
  if (!chrome.tabs || !chrome.tabs.captureVisibleTab) return;

  const tab = await tabsGet(tabId);
  if (!tab || isUnsupportedUrl(tab.url || "")) return;

  const existing = await storageGet("thumbnails");
  const entry = existing && existing[tabId];
  if (entry && entry.ts && Date.now() - entry.ts < THUMBNAIL_TTL_MS) return;

  const dataUrl = await captureVisibleTab(windowId, 35);
  if (!dataUrl) return;

  await setThumbnail(tabId, dataUrl);
}

function tabsQuery(queryInfo) {
  return new Promise((resolve) => {
    chrome.tabs.query(queryInfo, (tabs) => resolve(tabs || []));
  });
}

function tabsUpdate(tabId, updateProps) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateProps, () => {
      const err = chrome.runtime.lastError;
      if (err) return reject(err);
      resolve();
    });
  });
}

function tabsGet(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => resolve(tab || null));
  });
}

function captureVisibleTab(windowId, quality) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: quality || 35 }, (dataUrl) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(err);
      resolve(dataUrl || "");
    });
  });
}

async function setThumbnail(tabId, dataUrl) {
  const existing = await storageGet("thumbnails");
  const merged = { ...(existing || {}) };
  merged[tabId] = { dataUrl, ts: Date.now() };

  const allTabs = await tabsQuery({});
  const keep = new Set(allTabs.map((t) => String(t.id)));
  for (const key of Object.keys(merged)) {
    if (!keep.has(String(key))) delete merged[key];
  }

  const entries = Object.entries(merged);
  if (entries.length > MAX_THUMBNAILS) {
    entries.sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
    const trimmed = entries.slice(0, MAX_THUMBNAILS);
    const next = {};
    for (const [k, v] of trimmed) next[k] = v;
    await storageSet("thumbnails", next);
    return;
  }

  await storageSet("thumbnails", merged);
}

function storageGet(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [key]: {} }, (res) => resolve(res[key]));
  });
}

function storageSet(key, value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const err = chrome.runtime.lastError;
      if (err) return reject(err);
      resolve();
    });
  });
}

async function getSummaries(tabInfos) {
  return mapWithConcurrency(tabInfos, MAX_CONTENT_CONCURRENCY, (tab) => getSummaryForTab(tab));
}

async function getSummaryForTab(tab) {
  if (!tab.url || isUnsupportedUrl(tab.url)) {
    return { tabId: tab.id, error: "unsupported_url", title: tab.title || "", url: tab.url || "" };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "extractSummary" });
    if (!response) {
      return { tabId: tab.id, error: "no_response", title: tab.title || "", url: tab.url || "" };
    }
    return { tabId: tab.id, ...response };
  } catch (err) {
    return { tabId: tab.id, error: "extract_failed", title: tab.title || "", url: tab.url || "" };
  }
}

function isUnsupportedUrl(url) {
  return (
    url.startsWith("chrome://") ||
    url.startsWith("edge://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("devtools://") ||
    url.startsWith("about:")
  );
}

function buildFingerprints(tabInfos, summaries) {
  const summaryByTab = new Map(summaries.map((s) => [s.tabId, s]));
  return tabInfos.map((tab) => {
    const s = summaryByTab.get(tab.id) || {};
    const title = s.title || tab.title || "";
    const content = [s.title, s.headings, s.meta, s.snippet].filter(Boolean).join(" ");
    const tokens = tokenize(content);
    const hash = tokens.length ? simhash64(tokens) : 0n;

    return {
      tabId: tab.id,
      urlKey: normalizeUrl(tab.url || ""),
      titleKey: normalizeTitle(title),
      titleTokens: tokenize(title),
      simhash: hash.toString(),
    };
  });
}

function buildDuplicateGroups(tabInfos, fingerprints) {
  const byUrl = new Map();
  const byTitle = new Map();

  for (const fp of fingerprints) {
    if (fp.urlKey) pushMap(byUrl, fp.urlKey, fp.tabId);
    if (fp.titleKey) pushMap(byTitle, fp.titleKey, fp.tabId);
  }

  const groups = [];
  const seen = new Set();
  let idCounter = 1;

  for (const [key, ids] of byUrl.entries()) {
    if (ids.length < 2) continue;
    const sig = ids.slice().sort().join(",");
    if (seen.has(sig)) continue;
    seen.add(sig);
    groups.push({ id: `dup-url-${idCounter++}`, type: "duplicate", reason: "url", tabIds: ids });
  }

  for (const [key, ids] of byTitle.entries()) {
    if (ids.length < 2) continue;
    const sig = ids.slice().sort().join(",");
    if (seen.has(sig)) continue;
    seen.add(sig);
    groups.push({ id: `dup-title-${idCounter++}`, type: "duplicate", reason: "title", tabIds: ids });
  }

  return groups;
}

function buildSimilarGroups(tabInfos, fingerprints, duplicateGroups) {
  const duplicateIds = new Set();
  for (const g of duplicateGroups) {
    for (const id of g.tabIds) duplicateIds.add(id);
  }

  const fpById = new Map(fingerprints.map((f) => [f.tabId, f]));
  const ids = fingerprints.map((f) => f.tabId).filter((id) => !duplicateIds.has(id));
  const uf = new UnionFind(ids);

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = fpById.get(ids[i]);
      const b = fpById.get(ids[j]);
      if (!a || !b) continue;

      const simhashDist = hammingDistanceBigInt(BigInt(a.simhash), BigInt(b.simhash));
      const titleSim = jaccard(a.titleTokens, b.titleTokens);
      const urlSim = urlSimilarity(a.urlKey, b.urlKey);

      if (simhashDist <= SIMHASH_THRESHOLD || titleSim >= 0.8 || urlSim >= 0.8) {
        uf.union(a.tabId, b.tabId);
      }
    }
  }

  const groups = [];
  const buckets = uf.groups();
  let idCounter = 1;
  for (const idsGroup of buckets.values()) {
    if (idsGroup.length < 2) continue;
    groups.push({ id: `sim-${idCounter++}`, type: "similar", reason: "fingerprint", tabIds: idsGroup });
  }
  return groups;
}

function buildEstimates(tabInfos, summaries) {
  const summaryByTab = new Map(summaries.map((s) => [s.tabId, s]));
  return tabInfos.map((tab) => {
    const s = summaryByTab.get(tab.id) || {};
    const metrics = s.metrics || {};
    const estimate = estimateFromMetrics(metrics);
    return {
      tabId: tab.id,
      score: estimate.score,
      memoryMB: estimate.memoryMB,
      cpuPercent: estimate.cpuPercent,
      metrics: {
        domCount: metrics.domCount || 0,
        imageCount: metrics.imageCount || 0,
        videoCount: metrics.videoCount || 0,
        iframeCount: metrics.iframeCount || 0,
        scriptCount: metrics.scriptCount || 0,
        resourceCount: metrics.resourceCount || 0,
        transferSizeKB: metrics.transferSizeKB || 0,
        decodedSizeKB: metrics.decodedSizeKB || 0,
        mediaPlaying: Boolean(metrics.mediaPlaying)
      }
    };
  });
}

function estimateFromMetrics(metrics) {
  const domCount = metrics.domCount || 0;
  const imageCount = metrics.imageCount || 0;
  const videoCount = metrics.videoCount || 0;
  const iframeCount = metrics.iframeCount || 0;
  const scriptCount = metrics.scriptCount || 0;
  const resourceCount = metrics.resourceCount || 0;
  const transferMB = (metrics.transferSizeKB || 0) / 1024;
  const decodedMB = (metrics.decodedSizeKB || 0) / 1024;
  const mediaPlaying = Boolean(metrics.mediaPlaying);

  const memoryMB =
    transferMB * 1.2 +
    decodedMB * 0.5 +
    imageCount * 1.5 +
    videoCount * 8 +
    iframeCount * 2 +
    domCount / 2000;

  const cpuPercent =
    scriptCount * 0.3 +
    resourceCount * 0.1 +
    videoCount * 2 +
    iframeCount * 1 +
    (mediaPlaying ? 8 : 0);

  const score = memoryMB + cpuPercent * 2;

  return {
    memoryMB: Math.max(0, Math.round(memoryMB * 10) / 10),
    cpuPercent: Math.max(0, Math.round(cpuPercent * 10) / 10),
    score: Math.max(0, Math.round(score * 10) / 10)
  };
}

async function mapTabProcesses(tabInfos) {
  const map = new Map();
  let targets = [];
  try {
    targets = await getDebuggerTargets();
  } catch {
    targets = [];
  }

  const targetByTabId = new Map();
  for (const t of targets) {
    if (typeof t.tabId === "number") {
      targetByTabId.set(t.tabId, {
        targetId: t.id || t.targetId || null,
        processId: typeof t.processId === "number" ? t.processId : null,
      });
    }
  }

  await mapWithConcurrency(tabInfos, MAX_DEBUGGER_CONCURRENCY, async (tab) => {
    const base = targetByTabId.get(tab.id) || {};
    let processId = base.processId ?? null;
    let targetId = base.targetId ?? null;

    if (processId == null) {
      const debuggee = { tabId: tab.id };
      let attached = false;
      try {
        attached = await tryAttachDebugger(debuggee);
        if (attached) {
          const info = await debugCommand(debuggee, "Target.getTargetInfo");
          const ti = info && info.targetInfo ? info.targetInfo : info;
          if (ti) {
            if (!targetId) targetId = ti.targetId || ti.id || null;
            if (typeof ti.processId === "number") processId = ti.processId;
          }
        }
      } catch {
        // ignore failures; processId remains null
      } finally {
        if (attached) await debugDetach(debuggee).catch(() => {});
      }
    }

    map.set(tab.id, { processId, targetId });
  });

  return map;
}

async function getResourceSamples(tabInfos, processMap) {
  try {
    const tabs = tabInfos.map((t) => {
      const mapping = processMap.get(t.id) || {};
      return {
        tabId: t.id,
        windowId: t.windowId,
        url: t.url,
        title: t.title,
        processId: mapping.processId ?? null,
        targetId: mapping.targetId ?? null,
      };
    });

    const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST, {
      type: "resourceSampleRequest",
      timestamp: Date.now(),
      browser: detectBrowser(),
      tabs,
    });

    return { ok: true, ...response };
  } catch (err) {
    return { ok: false, error: "native_host_unavailable", detail: String(err && err.message ? err.message : err) };
  }
}

function detectBrowser() {
  if (navigator.userAgent.includes("Edg/")) return "edge";
  return "chrome";
}

function pushMap(map, key, value) {
  const list = map.get(key) || [];
  list.push(value);
  map.set(key, list);
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    const pathname = u.pathname.endsWith("/") && u.pathname !== "/" ? u.pathname.slice(0, -1) : u.pathname;
    return `${u.origin}${pathname}${u.search}`;
  } catch {
    return "";
  }
}

function normalizeTitle(title) {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 200);
}

function urlSimilarity(a, b) {
  if (!a || !b) return 0;
  const aTokens = a.split(/[\/?#&=]+/).filter(Boolean);
  const bTokens = b.split(/[\/?#&=]+/).filter(Boolean);
  return jaccard(aTokens, bTokens);
}

function jaccard(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let intersection = 0;
  for (const t of aSet) if (bSet.has(t)) intersection++;
  const union = aSet.size + bSet.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function simhash64(tokens) {
  const bits = new Array(64).fill(0);
  for (const token of tokens) {
    const h = fnv1a64(token);
    for (let i = 0n; i < 64n; i++) {
      const bit = (h >> i) & 1n;
      bits[Number(i)] += bit === 1n ? 1 : -1;
    }
  }
  let result = 0n;
  for (let i = 0n; i < 64n; i++) {
    if (bits[Number(i)] > 0) result |= 1n << i;
  }
  return result;
}

function fnv1a64(str) {
  let hash = 0xcbf29ce484222325n; // offset basis
  const prime = 0x100000001b3n;
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash;
}

function hammingDistanceBigInt(a, b) {
  let x = a ^ b;
  let count = 0;
  while (x) {
    x &= x - 1n;
    count++;
  }
  return count;
}

class UnionFind {
  constructor(items) {
    this.parent = new Map();
    for (const i of items) this.parent.set(i, i);
  }
  find(x) {
    const p = this.parent.get(x);
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }
  union(a, b) {
    if (!this.parent.has(a) || !this.parent.has(b)) return;
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  groups() {
    const buckets = new Map();
    for (const key of this.parent.keys()) {
      const root = this.find(key);
      const list = buckets.get(root) || [];
      list.push(key);
      buckets.set(root, list);
    }
    return buckets;
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current], current);
    }
  }

  const workers = new Array(Math.min(limit, items.length)).fill(0).map(() => worker());
  await Promise.all(workers);
  return results;
}

function getDebuggerTargets() {
  return new Promise((resolve) => {
    chrome.debugger.getTargets((targets) => {
      const err = chrome.runtime.lastError;
      if (err) return resolve([]);
      resolve(targets || []);
    });
  });
}

function debugAttach(debuggee) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(debuggee, DEBUGGER_PROTOCOL, () => {
      const err = chrome.runtime.lastError;
      if (err) return reject(err);
      resolve();
    });
  });
}

async function tryAttachDebugger(debuggee) {
  try {
    await debugAttach(debuggee);
    return true;
  } catch {
    return false;
  }
}

function debugDetach(debuggee) {
  return new Promise((resolve, reject) => {
    chrome.debugger.detach(debuggee, () => {
      const err = chrome.runtime.lastError;
      if (err) return reject(err);
      resolve();
    });
  });
}

function debugCommand(debuggee, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(debuggee, method, params, (result) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(err);
      resolve(result);
    });
  });
}
