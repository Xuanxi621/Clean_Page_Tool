param(
  [ValidateSet("chrome","edge","both")][string]$Browser = "both"
)

$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$hostName = "com.cleanpagetool.host"

if ($Browser -eq "chrome" -or $Browser -eq "both") {
  Remove-Item -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName" -Recurse -Force
  Remove-Item -Path (Join-Path $root "host-manifest.chrome.json") -Force
}

if ($Browser -eq "edge" -or $Browser -eq "both") {
  Remove-Item -Path "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName" -Recurse -Force
  Remove-Item -Path (Join-Path $root "host-manifest.edge.json") -Force
}

Write-Host "Native host uninstalled for $Browser"
