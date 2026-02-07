param(
  [ValidateSet("chrome","edge","both")][string]$Browser = "both",
  [string]$ExtensionName = "清洁助手"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Find-ExtensionId($userDataRoot, $extensionName) {
  if (-not (Test-Path $userDataRoot)) { return $null }
  $profiles = Get-ChildItem -Path $userDataRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName "Extensions") }

  foreach ($profile in $profiles) {
    $extRoot = Join-Path $profile.FullName "Extensions"
    $ids = Get-ChildItem -Path $extRoot -Directory -ErrorAction SilentlyContinue
    foreach ($idDir in $ids) {
      $verDir = Get-ChildItem -Path $idDir.FullName -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -First 1
      if (-not $verDir) { continue }
      $manifestPath = Join-Path $verDir.FullName "manifest.json"
      if (-not (Test-Path $manifestPath)) { continue }
      try {
        $manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
        if ($manifest.name -eq $extensionName) {
          return $idDir.Name
        }
      } catch {
        continue
      }
    }
  }
  return $null
}

function InstallForBrowser($browserName, $extensionId) {
  if (-not $extensionId) {
    Write-Host "未找到 $browserName 的扩展ID。请确认已加载扩展，或手动传入 -ExtensionId。" -ForegroundColor Yellow
    return
  }
  & (Join-Path $root "install.ps1") -ExtensionId $extensionId -Browser $browserName
}

if ($Browser -eq "chrome" -or $Browser -eq "both") {
  $chromeRoot = Join-Path $env:LOCALAPPDATA "Google\\Chrome\\User Data"
  $id = Find-ExtensionId $chromeRoot $ExtensionName
  InstallForBrowser "chrome" $id
}

if ($Browser -eq "edge" -or $Browser -eq "both") {
  $edgeRoot = Join-Path $env:LOCALAPPDATA "Microsoft\\Edge\\User Data"
  $id = Find-ExtensionId $edgeRoot $ExtensionName
  InstallForBrowser "edge" $id
}
