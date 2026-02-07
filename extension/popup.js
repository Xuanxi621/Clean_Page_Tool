const statusEl = document.getElementById("status");
const scanBtn = document.getElementById("scanBtn");
const statsEl = document.getElementById("stats");

const viewDuplicates = document.getElementById("view-duplicates");
const viewResources = document.getElementById("view-resources");
const viewClusters = document.getElementById("view-clusters");
const viewContact = document.getElementById("view-contact");
const dupControls = document.getElementById("dup-controls");
const dupList = document.getElementById("dup-list");
const resControls = document.getElementById("res-controls");
const resList = document.getElementById("res-list");
const clusterControls = document.getElementById("cluster-controls");
const clusterList = document.getElementById("cluster-list");
const tabsButtons = document.querySelectorAll(".tab");

let lastResult = null;
let resourceSortBy = "memory";
let thumbnailById = new Map();

loadThumbnails();
listenThumbnailUpdates();

scanBtn.addEventListener("click", () => scan());

for (const btn of tabsButtons) {
  btn.addEventListener("click", () => {
    for (const b of tabsButtons) b.classList.remove("active");
    btn.classList.add("active");
    switchView(btn.dataset.tab);
  });
}

async function scan() {
  setStatus("扫描中...");
  scanBtn.disabled = true;
  dupControls.innerHTML = "";
  dupList.innerHTML = "";
  resControls.innerHTML = "";
  resList.innerHTML = "";
  clusterControls.innerHTML = "";
  clusterList.innerHTML = "";
  statsEl.textContent = "";

  try {
    const result = await chrome.runtime.sendMessage({ type: "scan" });
    if (!result || !result.ok) {
      setStatus("扫描失败");
      renderNotice(dupList, result && result.error ? result.error : "未知错误");
      return;
    }

    lastResult = result;
    setStatus("扫描完成");
    renderDuplicates(result);
    renderResources(result);
    if (isClustersViewActive()) {
      renderClusters(result);
    }
    renderStats(result);
  } catch (err) {
    setStatus("扫描失败");
    renderNotice(dupList, String(err && err.message ? err.message : err));
  } finally {
    scanBtn.disabled = false;
  }
}

function setStatus(text) {
  statusEl.textContent = text;
}

function switchView(tab) {
  const views = {
    duplicates: viewDuplicates,
    resources: viewResources,
    clusters: viewClusters,
    contact: viewContact
  };

  for (const key of Object.keys(views)) {
    views[key].classList.add("hidden");
  }
  if (views[tab]) views[tab].classList.remove("hidden");

  if (tab === "clusters") {
    if (lastResult) renderClusters(lastResult);
    else {
      clusterControls.innerHTML = "";
      clusterList.innerHTML = "";
      renderNotice(clusterList, "请先扫描以生成聚类结果。");
    }
  }
}

function renderStats(result) {
  const totalTabs = result.tabs.length;
  const dupCount = result.groups.duplicates.length;
  const simCount = result.groups.similar.length;
  const resourceCount = result.resources && result.resources.ok && Array.isArray(result.resources.samples)
    ? result.resources.samples.length
    : 0;

  statsEl.textContent = `标签页 ${totalTabs} | 重复组 ${dupCount} | 相似组 ${simCount} | 资源样本 ${resourceCount}`;
}

function renderDuplicates(result) {
  dupControls.innerHTML = "";
  dupList.innerHTML = "";

  const tabMap = new Map(result.tabs.map((t) => [t.id, t]));
  const groups = [...result.groups.duplicates, ...result.groups.similar];

  const controls = document.createElement("div");
  controls.className = "controls";

  const closeIdleBtn = document.createElement("button");
  closeIdleBtn.className = "action ghost";
  closeIdleBtn.textContent = "关闭最久未用20%";
  closeIdleBtn.addEventListener("click", () => {
    const ids = getIdleTabIds(result, 0.2);
    closeTabs(ids);
  });

  controls.appendChild(closeIdleBtn);
  dupControls.appendChild(controls);

  if (!groups.length) {
    renderNotice(dupList, "未发现重复或相似分组。");
    return;
  }

  for (const group of groups) {
    const card = document.createElement("div");
    card.className = "card";
    const title = document.createElement("h4");
    title.textContent = `${group.type === "duplicate" ? "重复" : "相似"} 分组`;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = mapReason(group.reason);
    title.appendChild(badge);

    const list = document.createElement("div");
    list.className = "list";

    const keepId = group.tabIds[0];
    for (const id of group.tabIds) {
      const t = tabMap.get(id);
      const row = document.createElement("label");
      row.className = "row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.tabId = String(id);
      checkbox.checked = id !== keepId;

      const label = document.createElement("span");
      label.className = "label";
      label.textContent = t ? (t.title || t.url) : `标签页 ${id}`;

      row.appendChild(checkbox);
      row.appendChild(label);
      list.appendChild(row);
    }

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const selectAllBtn = document.createElement("button");
    selectAllBtn.className = "action ghost";
    selectAllBtn.textContent = "全选";
    selectAllBtn.addEventListener("click", () => toggleCheckboxes(list, true));

    const clearBtn = document.createElement("button");
    clearBtn.className = "action ghost";
    clearBtn.textContent = "清空";
    clearBtn.addEventListener("click", () => toggleCheckboxes(list, false));

    const action = document.createElement("button");
    action.className = "action";
    action.textContent = "关闭选中";
    action.addEventListener("click", () => {
      const ids = getCheckedTabIds(list);
      closeTabs(ids);
    });

    actions.appendChild(selectAllBtn);
    actions.appendChild(clearBtn);
    actions.appendChild(action);

    card.appendChild(title);
    card.appendChild(list);
    card.appendChild(actions);
    dupList.appendChild(card);
  }
}

function renderResources(result) {
  resControls.innerHTML = "";
  resList.innerHTML = "";

  if (result.resources && result.resources.ok && Array.isArray(result.resources.samples) && result.resources.samples.length) {
    renderPreciseResources(result);
  } else {
    renderEstimateResources(result);
  }
}

function renderClusters(result) {
  clusterControls.innerHTML = "";
  clusterList.innerHTML = "";

  if (!result || !Array.isArray(result.tabs)) {
    renderNotice(clusterList, "暂无聚类数据。");
    return;
  }

  const groups = clusterTabsByTitle(result.tabs);
  const summaryById = new Map((result.summaries || []).map((s) => [s.tabId, s]));
  const allTabIds = result.tabs.map((t) => t.id);
  if (!groups.length) {
    renderNotice(clusterList, "没有可聚类的标签页。");
    return;
  }

  const missingIds = allTabIds.filter((id) => !thumbnailById.has(id));
  if (missingIds.length) {
    const hint = document.createElement("div");
    hint.className = "muted";
    hint.textContent = "缩略图将按需生成（切换到对应标签时自动更新）。";
    clusterControls.appendChild(hint);
  }

  for (const group of groups) {
    const container = document.createElement("div");
    container.className = "cluster-group";

    const title = document.createElement("div");
    title.className = "cluster-title";
    title.textContent = group.label;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = String(group.tabs.length);
    title.appendChild(badge);

    const grid = document.createElement("div");
    grid.className = "cluster-grid";

    for (const tab of group.tabs) {
      const card = document.createElement("div");
      card.className = "tab-card";

      const thumb = document.createElement("div");
      thumb.className = "tab-thumb";
      const shot = thumbnailById.get(tab.id);
      if (shot) {
        const img = document.createElement("img");
        img.className = "thumb-img";
        img.src = shot;
        img.alt = "";
        thumb.appendChild(img);
      } else if (tab.favIconUrl) {
        const img = document.createElement("img");
        img.className = "thumb-icon";
        img.src = tab.favIconUrl;
        img.alt = "";
        thumb.appendChild(img);
      } else {
        const img = document.createElement("img");
        img.className = "thumb-placeholder";
        img.src = chrome.runtime.getURL("assets/cat-placeholder.png");
        img.alt = "";
        thumb.appendChild(img);
      }

      const tabTitle = document.createElement("div");
      tabTitle.className = "tab-title";
      tabTitle.textContent = tab.title || tab.url || `标签页 ${tab.id}`;

      const meta = document.createElement("div");
      meta.className = "tab-meta";
      meta.textContent = tab.url || "";

      const summary = summaryById.get(tab.id);
      const snippetText = getSummarySnippet(summary);

      const last = document.createElement("div");
      last.className = "tab-meta";
      last.textContent = `最后访问：${formatLastAccessed(tab.lastAccessed || 0)}`;

      const actions = document.createElement("div");
      actions.className = "tab-actions";

      const switchBtn = document.createElement("button");
      switchBtn.className = "tab-switch";
      switchBtn.textContent = "切换";
      switchBtn.addEventListener("click", () => activateTab(tab));

      const delBtn = document.createElement("button");
      delBtn.className = "tab-delete";
      delBtn.textContent = "删除";
      delBtn.addEventListener("click", () => closeTabs([tab.id]));

      actions.appendChild(switchBtn);
      actions.appendChild(delBtn);

      card.appendChild(thumb);
      card.appendChild(tabTitle);
      card.appendChild(meta);
      if (snippetText) {
        const snippet = document.createElement("div");
        snippet.className = "tab-snippet";
        snippet.textContent = snippetText;
        card.appendChild(snippet);
      }
      card.appendChild(last);
      card.appendChild(actions);
      grid.appendChild(card);
    }

    container.appendChild(title);
    container.appendChild(grid);
    clusterList.appendChild(container);
  }
}

function toggleCheckboxes(container, checked) {
  for (const input of container.querySelectorAll("input[type=checkbox]")) {
    input.checked = checked;
  }
}

function loadThumbnails() {
  chrome.storage.local.get({ thumbnails: {} }, (res) => {
    thumbnailById = new Map(
      Object.entries(res.thumbnails || {}).map(([k, v]) => [Number(k), v.dataUrl || v])
    );
    if (lastResult) renderClusters(lastResult);
  });
}

function listenThumbnailUpdates() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.thumbnails) return;
    const next = changes.thumbnails.newValue || {};
    thumbnailById = new Map(Object.entries(next).map(([k, v]) => [Number(k), v.dataUrl || v]));
    if (lastResult && isClustersViewActive()) renderClusters(lastResult);
  });
}

function getCheckedTabIds(container) {
  const ids = [];
  for (const input of container.querySelectorAll("input[type=checkbox]:checked")) {
    const id = Number(input.dataset.tabId);
    if (!Number.isNaN(id)) ids.push(id);
  }
  return ids;
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Number(value).toFixed(1);
}

function renderNotice(target, text) {
  const div = document.createElement("div");
  div.className = "notice";
  div.textContent = text;
  target.appendChild(div);
}

function renderEstimateResources(result) {
  let estimates = Array.isArray(result.estimates) ? result.estimates : [];
  if (!estimates.length) {
    estimates = buildFallbackEstimates(result);
  }
  if (!estimates.length) {
    renderNotice(resList, "没有可用的估算数据。");
    return;
  }

  const controls = document.createElement("div");
  controls.className = "controls";

  const sortLabel = document.createElement("span");
  sortLabel.className = "muted";
  sortLabel.textContent = "排序";

  const select = document.createElement("select");
  select.className = "select";
  select.innerHTML = `
    <option value="score">按占用评分</option>
    <option value="memory">按估算内存</option>
    <option value="cpu">按估算 CPU</option>
  `;
  if (!["score", "memory", "cpu"].includes(resourceSortBy)) resourceSortBy = "score";
  select.value = resourceSortBy;
  select.addEventListener("change", () => {
    resourceSortBy = select.value;
    if (lastResult) renderResources(lastResult);
  });

  const spacer = document.createElement("div");
  spacer.className = "spacer";

  const closeSelectedBtn = document.createElement("button");
  closeSelectedBtn.className = "action";
  closeSelectedBtn.textContent = "关闭选中";
  closeSelectedBtn.addEventListener("click", () => {
    const ids = getCheckedTabIds(resList);
    closeTabs(ids);
  });

  controls.appendChild(sortLabel);
  controls.appendChild(select);
  controls.appendChild(spacer);
  controls.appendChild(closeSelectedBtn);
  resControls.appendChild(controls);

  const tabMap = new Map(result.tabs.map((t) => [t.id, t]));
  const metric = resourceSortBy === "cpu" ? "cpuPercent" : resourceSortBy === "memory" ? "memoryMB" : "score";
  const sorted = estimates.slice().sort((a, b) => {
    const av = Number(a[metric] || 0);
    const bv = Number(b[metric] || 0);
    if (bv !== av) return bv - av;
    return (a.tabId || 0) - (b.tabId || 0);
  });

  renderEstimateChart(sorted.slice(0, 8), tabMap);

  for (const s of sorted) {
    const t = tabMap.get(s.tabId);
    const card = document.createElement("div");
    card.className = "card";

    const row = document.createElement("div");
    row.className = "row title-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.tabId = String(s.tabId);

    const title = document.createElement("span");
    title.className = "label";
    title.textContent = t ? (t.title || t.url) : `标签页 ${s.tabId}`;

    row.appendChild(checkbox);
    row.appendChild(title);

    const header = document.createElement("div");
    header.className = "header";
    header.appendChild(row);

    const meta = document.createElement("div");
    meta.className = "muted";
    meta.textContent = `估算评分 ${formatNumber(s.score)} | 估算 CPU ${formatNumber(s.cpuPercent)}% | 估算内存 ${formatNumber(s.memoryMB)} MB`;

    const lastLine = document.createElement("div");
    lastLine.className = "muted";
    lastLine.textContent = `最后访问：${formatLastAccessed(t ? t.lastAccessed : 0)}`;

    const signals = document.createElement("div");
    signals.className = "muted";
    signals.textContent =
      `DOM ${s.metrics.domCount} | 资源 ${s.metrics.resourceCount} | 传输 ${formatNumber(s.metrics.transferSizeKB / 1024)} MB`;

    const action = document.createElement("button");
    action.className = "action";
    action.textContent = "关闭";
    action.addEventListener("click", () => closeTabs([s.tabId]));

    card.appendChild(header);
    card.appendChild(meta);
    card.appendChild(lastLine);
    card.appendChild(signals);
    card.appendChild(action);
    resList.appendChild(card);
  }
}

function renderEstimateChart(items, tabMap) {
  if (!items.length) return;
  const maxScore = Math.max(...items.map((i) => i.score || 0), 1);
  const chart = document.createElement("div");
  chart.className = "chart";

  const chartTitle = document.createElement("div");
  chartTitle.className = "muted";
  chartTitle.textContent = "占用评分分布（Top 8）";
  chart.appendChild(chartTitle);

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "chart-row";

    const label = document.createElement("div");
    label.className = "chart-label";
    const tab = tabMap.get(item.tabId);
    label.textContent = tab ? (tab.title || tab.url) : `标签页 ${item.tabId}`;

    const bar = document.createElement("div");
    bar.className = "chart-bar";

    const fill = document.createElement("div");
    fill.className = "chart-fill";
    const width = Math.max(4, Math.round((item.score / maxScore) * 100));
    fill.style.width = `${width}%`;

    const value = document.createElement("div");
    value.className = "chart-value";
    value.textContent = formatNumber(item.score);

    bar.appendChild(fill);
    row.appendChild(label);
    row.appendChild(bar);
    row.appendChild(value);
    chart.appendChild(row);
  }

  resList.appendChild(chart);
}

function buildFallbackEstimates(result) {
  if (!result || !Array.isArray(result.tabs)) return [];
  const fpById = new Map((result.fingerprints || []).map((f) => [f.tabId, f]));
  return result.tabs.map((t) => {
    const fp = fpById.get(t.id) || {};
    const urlLen = (t.url || "").length;
    const titleLen = (t.title || "").length;
    const tokenCount = Array.isArray(fp.titleTokens) ? fp.titleTokens.length : 0;
    const score = Math.round((urlLen / 30 + titleLen / 10 + tokenCount) * 10) / 10;
    const memoryMB = Math.round(score * 2 * 10) / 10;
    const cpuPercent = Math.round(score * 0.5 * 10) / 10;
    return {
      tabId: t.id,
      score,
      memoryMB,
      cpuPercent,
      metrics: {
        domCount: 0,
        imageCount: 0,
        videoCount: 0,
        iframeCount: 0,
        scriptCount: 0,
        resourceCount: 0,
        transferSizeKB: 0,
        decodedSizeKB: 0,
        mediaPlaying: false
      }
    };
  });
}

function renderPreciseResources(result) {
  const samples = Array.isArray(result.resources.samples) ? result.resources.samples : [];
  if (!samples.length) {
    renderNotice(resList, "没有可用的资源采样。");
    return;
  }

  const controls = document.createElement("div");
  controls.className = "controls";

  const sortLabel = document.createElement("span");
  sortLabel.className = "muted";
  sortLabel.textContent = "排序";

  const select = document.createElement("select");
  select.className = "select";
  select.innerHTML = `
    <option value="memory">按内存</option>
    <option value="cpu">按 CPU</option>
  `;
  if (!["memory", "cpu"].includes(resourceSortBy)) resourceSortBy = "memory";
  select.value = resourceSortBy;
  select.addEventListener("change", () => {
    resourceSortBy = select.value;
    if (lastResult) renderResources(lastResult);
  });

  const spacer = document.createElement("div");
  spacer.className = "spacer";

  const closeSelectedBtn = document.createElement("button");
  closeSelectedBtn.className = "action";
  closeSelectedBtn.textContent = "关闭选中";
  closeSelectedBtn.addEventListener("click", () => {
    const ids = getCheckedTabIds(resList);
    closeTabs(ids);
  });

  controls.appendChild(sortLabel);
  controls.appendChild(select);
  controls.appendChild(spacer);
  controls.appendChild(closeSelectedBtn);
  resControls.appendChild(controls);

  const tabMap = new Map(result.tabs.map((t) => [t.id, t]));
  const metric = resourceSortBy === "cpu" ? "cpuPercent" : "memoryMB";
  const sorted = samples.slice().sort((a, b) => {
    const av = Number(a[metric] || 0);
    const bv = Number(b[metric] || 0);
    if (bv !== av) return bv - av;
    return (a.tabId || 0) - (b.tabId || 0);
  });

  for (const s of sorted) {
    const t = tabMap.get(s.tabId);
    const card = document.createElement("div");
    card.className = "card";

    const row = document.createElement("div");
    row.className = "row title-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.tabId = String(s.tabId);

    const title = document.createElement("span");
    title.className = "label";
    title.textContent = t ? (t.title || t.url) : `标签页 ${s.tabId}`;

    row.appendChild(checkbox);
    row.appendChild(title);

    const header = document.createElement("div");
    header.className = "header";
    header.appendChild(row);

    if (s.sharedProcess) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "共享";
      header.appendChild(badge);
    }

    const meta = document.createElement("div");
    meta.className = "muted";
    meta.textContent = `CPU ${formatNumber(s.cpuPercent)}% | 内存 ${formatNumber(s.memoryMB)} MB`;

    const lastLine = document.createElement("div");
    lastLine.className = "muted";
    lastLine.textContent = `最后访问：${formatLastAccessed(t ? t.lastAccessed : 0)}`;

    const action = document.createElement("button");
    action.className = "action";
    action.textContent = "关闭";
    action.addEventListener("click", () => closeTabs([s.tabId]));

    card.appendChild(header);
    card.appendChild(meta);
    card.appendChild(lastLine);
    card.appendChild(action);
    resList.appendChild(card);
  }
}

function getIdleTabIds(result, ratio) {
  if (!result || !Array.isArray(result.tabs)) return [];
  const candidates = result.tabs.filter((t) => !t.active && !t.pinned);
  if (!candidates.length) return [];
  const sorted = candidates.slice().sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0));
  const count = Math.max(1, Math.floor(sorted.length * ratio));
  return sorted.slice(0, count).map((t) => t.id);
}

function formatLastAccessed(ts) {
  if (!ts) return "未知";
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) return "刚刚";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

async function downloadInstaller(statusEl) {
  try {
    const response = await chrome.runtime.sendMessage({ type: "downloadInstaller" });
    if (response && response.ok) {
      if (statusEl) statusEl.textContent = "已下载脚本，请在下载栏点击运行。";
      return;
    }
    throw new Error(response && response.error ? response.error : "下载失败");
  } catch (err) {
    const fallbackOk = triggerAnchorDownload();
    if (fallbackOk) {
      if (statusEl) statusEl.textContent = "已触发下载（备用方式），请在下载栏点击运行。";
      return;
    }
    if (statusEl) statusEl.textContent = `下载失败：${String(err && err.message ? err.message : err)}`;
  }
}

function triggerAnchorDownload() {
  try {
    const url = buildInstallerDataUrl();
    const link = document.createElement("a");
    link.href = url;
    link.download = "Clean_Page_Tool_Install.cmd";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  } catch {
    return false;
  }
}

function buildInstallerDataUrl() {
  const browser = getBrowser();
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
    "if not exist \"%ROOT%\\native-host\\install.ps1\" (",
    "  echo install.ps1 not found under: %ROOT%",
    "  pause",
    "  exit /b 1",
    ")",
    "",
    `powershell -NoProfile -ExecutionPolicy Bypass -File \"%ROOT%\\native-host\\install.ps1\" -ExtensionId ${extensionId} -Browser ${browser}`,
    "pause",
    ""
  ].join("\\r\\n");

  return "data:text/plain;charset=utf-8," + encodeURIComponent(script);
}

function getBrowser() {
  if (navigator.userAgent.includes("Edg/")) return "edge";
  return "chrome";
}

function getBrowserLabel() {
  return getBrowser() === "edge" ? "Edge" : "Chrome";
}

function isClustersViewActive() {
  const active = document.querySelector(".tab.active");
  return active && active.dataset && active.dataset.tab === "clusters";
}

function mapReason(reason) {
  if (reason === "url") return "URL";
  if (reason === "title") return "标题";
  if (reason === "fingerprint") return "指纹";
  return reason || "";
}

function getSummarySnippet(summary) {
  if (!summary) return "";
  const parts = [summary.meta, summary.headings, summary.snippet].filter(Boolean);
  if (!parts.length) return "";
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return text.length > 120 ? text.slice(0, 120) + "…" : text;
}

function clusterTabsByTitle(tabs) {
  const groups = new Map();
  for (const tab of tabs) {
    const normalized = normalizeTitleForCluster(tab.title || "", tab.url || "");
    const key = normalized.key;
    const label = normalized.label;
    if (!groups.has(key)) groups.set(key, { label, tabs: [] });
    groups.get(key).tabs.push(tab);
  }

  const arr = Array.from(groups.values());
  arr.sort((a, b) => b.tabs.length - a.tabs.length);
  return arr;
}

function normalizeTitleForCluster(title, url) {
  let base = (title || "").trim();
  const separators = [" - ", " | ", " — ", " – "];
  for (const sep of separators) {
    if (base.includes(sep)) {
      base = base.split(sep)[0].trim();
      break;
    }
  }
  if (!base) {
    try {
      base = new URL(url).hostname;
    } catch {
      base = url || "未知页面";
    }
  }
  const key = base.toLowerCase();
  return { key, label: base };
}

async function closeTabs(tabIds) {
  if (!tabIds.length) return;
  try {
    await chrome.runtime.sendMessage({ type: "closeTabs", tabIds });
    await scan();
  } catch (err) {
    renderNotice(dupList, String(err && err.message ? err.message : err));
  }
}

function activateTab(tab) {
  if (!tab || typeof tab.id !== "number") return;
  chrome.tabs.update(tab.id, { active: true });
  if (typeof tab.windowId === "number") {
    chrome.windows.update(tab.windowId, { focused: true });
  }
}
