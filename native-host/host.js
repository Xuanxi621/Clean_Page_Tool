const { spawnSync } = require("child_process");

const HOST_NAME = "com.cleanpagetool.host";

let input = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  input = Buffer.concat([input, chunk]);
  processInput();
});

function processInput() {
  while (input.length >= 4) {
    const msgLength = input.readUInt32LE(0);
    if (input.length < 4 + msgLength) return;

    const body = input.slice(4, 4 + msgLength);
    input = input.slice(4 + msgLength);

    let message = null;
    try {
      message = JSON.parse(body.toString("utf8"));
    } catch {
      sendMessage({ type: "error", error: "invalid_json" });
      continue;
    }

    handleMessage(message);
  }
}

function handleMessage(message) {
  if (!message || message.type !== "resourceSampleRequest") {
    sendMessage({ type: "error", error: "unsupported_message" });
    return;
  }

  const tabs = Array.isArray(message.tabs) ? message.tabs : [];
  const processSamples = getProcessSamples();

  const processById = new Map(processSamples.map((p) => [p.processId, p]));
  const processUseCount = new Map();
  for (const t of tabs) {
    if (t.processId) processUseCount.set(t.processId, (processUseCount.get(t.processId) || 0) + 1);
  }

  const samples = [];
  const unmapped = [];

  for (const t of tabs) {
    if (!t.processId || !processById.has(t.processId)) {
      unmapped.push({ tabId: t.tabId, reason: "no_process_match" });
      continue;
    }

    const p = processById.get(t.processId);
    const shared = (processUseCount.get(t.processId) || 0) > 1;
    samples.push({
      tabId: t.tabId,
      processId: t.processId,
      cpuPercent: p.cpuPercent,
      memoryMB: p.memoryMB,
      sharedProcess: shared,
    });
  }

  sendMessage({
    type: "resourceSampleResponse",
    timestamp: Date.now(),
    samples,
    unmapped,
  });
}

function getProcessSamples() {
  // NOTE: This is a best-effort sampler. It reads all chrome/msedge processes.
  // Mapping process -> tab requires CDP mapping from the extension.
  const ps = spawnSync("powershell", [
    "-NoProfile",
    "-Command",
    "& {\n" +
      "$p1 = Get-Process chrome,msedge -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,CPU,WorkingSet64;\n" +
      "Start-Sleep -Milliseconds 200;\n" +
      "$p2 = Get-Process chrome,msedge -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,CPU,WorkingSet64;\n" +
      "$cores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors;\n" +
      "$interval = 0.2;\n" +
      "$byId = @{};\n" +
      "foreach ($p in $p1) { $byId[$p.Id] = $p }\n" +
      "$out = @();\n" +
      "foreach ($p in $p2) {\n" +
      "  $prev = $byId[$p.Id];\n" +
      "  if ($null -ne $prev) {\n" +
      "    $delta = $p.CPU - $prev.CPU;\n" +
      "    if ($delta -lt 0) { $delta = 0 }\n" +
      "    $cpu = [math]::Round(($delta / $interval) * 100 / $cores, 2);\n" +
      "    $mem = [math]::Round($p.WorkingSet64 / 1MB, 1);\n" +
      "    $out += [pscustomobject]@{ processId = $p.Id; cpuPercent = $cpu; memoryMB = $mem };\n" +
      "  }\n" +
      "}\n" +
      "$out | ConvertTo-Json -Compress\n" +
    "}")
  ]);

  if (ps.status !== 0) return [];
  try {
    const text = ps.stdout.toString("utf8").trim();
    if (!text) return [];
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [data];
  } catch {
    return [];
  }
}

function sendMessage(msg) {
  const data = Buffer.from(JSON.stringify(msg), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(data.length, 0);
  process.stdout.write(Buffer.concat([header, data]));
}
