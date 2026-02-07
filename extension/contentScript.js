function extractSummary() {
  const title = document.title || "";
  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .slice(0, 5)
    .map((h) => h.textContent.trim())
    .filter(Boolean)
    .join(" ");

  const meta = document.querySelector('meta[name="description"]');
  const metaDesc = meta ? meta.getAttribute("content") || "" : "";

  const bodyText = document.body ? document.body.innerText || "" : "";
  const snippet = bodyText.replace(/\s+/g, " ").trim().slice(0, 1200);

  const domCount = document.getElementsByTagName("*").length;
  const imageCount = document.images ? document.images.length : document.querySelectorAll("img").length;
  const videoCount = document.querySelectorAll("video").length;
  const iframeCount = document.querySelectorAll("iframe").length;
  const scriptCount = document.scripts ? document.scripts.length : document.querySelectorAll("script").length;
  const styleCount = document.querySelectorAll("style").length;
  const linkCount = document.querySelectorAll("link[rel=stylesheet]").length;
  const textLength = bodyText.length;

  const resources = performance.getEntriesByType ? performance.getEntriesByType("resource") : [];
  let transferSizeKB = 0;
  let decodedSizeKB = 0;
  for (const r of resources) {
    if (typeof r.transferSize === "number") transferSizeKB += r.transferSize / 1024;
    if (typeof r.decodedBodySize === "number") decodedSizeKB += r.decodedBodySize / 1024;
  }

  const mediaPlaying = Array.from(document.querySelectorAll("video, audio")).some((m) => !m.paused);

  return {
    url: location.href,
    title,
    headings,
    meta: metaDesc,
    snippet,
    metrics: {
      domCount,
      imageCount,
      videoCount,
      iframeCount,
      scriptCount,
      styleCount,
      linkCount,
      textLength,
      resourceCount: resources.length,
      transferSizeKB: Math.round(transferSizeKB * 10) / 10,
      decodedSizeKB: Math.round(decodedSizeKB * 10) / 10,
      mediaPlaying
    }
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "extractSummary") {
    try {
      sendResponse(extractSummary());
    } catch {
      sendResponse({});
    }
  }
});
