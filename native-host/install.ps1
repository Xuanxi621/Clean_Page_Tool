param(
  [Parameter(Mandatory=$true)][string]$ExtensionId,
  [ValidateSet("chrome","edge","both")][string]$Browser = "both"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$hostName = "com.cleanpagetool.host"
$hostCmd = Join-Path $root "host.cmd"

if (-not (Test-Path $hostCmd)) {
  throw "host.cmd not found."
}

function Write-Manifest($path) {
  $manifest = @{
    name = $hostName
    description = "Clean Page Tool native host"
    path = $hostCmd
    type = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
  }
  $manifest | ConvertTo-Json -Compress | Set-Content -Path $path -Encoding UTF8
}

if ($Browser -eq "chrome" -or $Browser -eq "both") {
  $manifestPath = Join-Path $root "host-manifest.chrome.json"
  Write-Manifest $manifestPath
  $regPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
  New-Item -Path $regPath -Force | Out-Null
  Set-ItemProperty -Path $regPath -Name "(default)" -Value $manifestPath
}

if ($Browser -eq "edge" -or $Browser -eq "both") {
  $manifestPath = Join-Path $root "host-manifest.edge.json"
  Write-Manifest $manifestPath
  $regPath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName"
  New-Item -Path $regPath -Force | Out-Null
  Set-ItemProperty -Path $regPath -Name "(default)" -Value $manifestPath
}

Write-Host "Native host installed for $Browser with Extension ID $ExtensionId"
