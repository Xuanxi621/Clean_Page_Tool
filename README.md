# Clean Page Tool

Clean Page Tool is a manual-trigger browser cleanup assistant for Edge and Chrome. It scans open tabs, finds duplicate/similar pages, and surfaces high-resource tabs using a Native Messaging host for precise CPU and memory metrics.

## Structure
- extension/        MV3 extension (popup + service worker)
- native-host/      Native Messaging host (Node.js) and install scripts
- prd.md            Product requirements

## Requirements
- Windows 10/11
- Node.js 18+ (for the native host)
- Chrome and/or Edge

## Quick Start
1. Load the extension
- Open Chrome or Edge
- Go to `chrome://extensions`
- Enable Developer mode
- Click "Load unpacked" and select `extension/`

2. Install the native host
- Find your extension ID from the extensions page
- Run (PowerShell):
  `native-host\install.ps1 -ExtensionId <YOUR_EXTENSION_ID> -Browser both`

Alternative (auto-detect ID):
`native-host\auto-install.ps1 -Browser both`

3. Use the extension
- Click the extension icon
- Click "Scan"
- Review duplicates/similar pages and high-usage tabs

## Notes
- High-usage data requires the native host to be installed.
- Tabs with unsupported URLs (chrome://, edge://, etc.) are skipped for content fingerprints.

## Development
This project is a minimal scaffold. The process mapping (tab -> processId) requires CDP mapping work. See `native-host/host.js` and `extension/background.js` TODOs.
