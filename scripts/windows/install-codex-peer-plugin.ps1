param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$MarketplaceName = "shotaro-local"
)

$ErrorActionPreference = "Stop"

$codexHome = Join-Path $env:USERPROFILE ".codex"
$marketRoot = $null

try {
  $marketplaceList = @(codex plugin marketplace list)
  foreach ($line in $marketplaceList) {
    if ($line -match "^\s*$([regex]::Escape($MarketplaceName))\s+(.+?)\s*$") {
      $marketRoot = $Matches[1].Trim()
      break
    }
  }
} catch {
  $marketplaceList = @()
}

if (-not $marketRoot) {
  $marketRoot = Join-Path $codexHome "plugins"
}

$marketplaceDir = Join-Path $marketRoot ".agents\plugins"
$pluginsRoot = Join-Path $marketRoot "plugins"
$pluginPath = Join-Path $pluginsRoot "codex-peer"
$marketplacePath = Join-Path $marketplaceDir "marketplace.json"

New-Item -ItemType Directory -Force -Path $marketplaceDir | Out-Null
New-Item -ItemType Directory -Force -Path $pluginsRoot | Out-Null

if (Test-Path $pluginPath) {
  $existing = Get-Item $pluginPath
  if ($existing.LinkType -eq "Junction" -or $existing.LinkType -eq "SymbolicLink") {
    Remove-Item $pluginPath -Force
  } elseif ($existing.FullName -ne $RepoRoot) {
    throw "Plugin path already exists and is not a junction: $pluginPath"
  }
}

if (-not (Test-Path $pluginPath)) {
  New-Item -ItemType Junction -Path $pluginPath -Target $RepoRoot | Out-Null
}

if (Test-Path $marketplacePath) {
  $marketplace = Get-Content $marketplacePath -Raw | ConvertFrom-Json
} else {
  $marketplace = [ordered]@{
    name = $MarketplaceName
    interface = [ordered]@{
      displayName = "Shotaro Local"
    }
    plugins = @()
  }
}

if (-not $marketplace.name) {
  $marketplace | Add-Member -NotePropertyName name -NotePropertyValue $MarketplaceName
}
if (-not $marketplace.interface) {
  $marketplace | Add-Member -NotePropertyName interface -NotePropertyValue ([ordered]@{ displayName = "Shotaro Local" })
}
if (-not $marketplace.plugins) {
  $marketplace | Add-Member -NotePropertyName plugins -NotePropertyValue @()
}

$entry = [ordered]@{
  name = "codex-peer"
  source = [ordered]@{
    source = "local"
    path = "./plugins/codex-peer"
  }
  policy = [ordered]@{
    installation = "AVAILABLE"
    authentication = "ON_INSTALL"
  }
  category = "Productivity"
}

$plugins = @($marketplace.plugins | Where-Object { $_.name -ne "codex-peer" })
$plugins += $entry
$marketplace.plugins = $plugins

$marketplace | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 $marketplacePath

if (-not ($marketplaceList -match "^\s*$([regex]::Escape($marketplace.name))\s+")) {
  try {
    codex plugin marketplace add $marketRoot
    Write-Output "marketplaceAdd=ok"
  } catch {
    Write-Output "marketplaceAdd=failed"
    Write-Output $_.Exception.Message
  }
}

Write-Output "marketRoot=$marketRoot"
Write-Output "marketplacePath=$marketplacePath"
Write-Output "pluginPath=$pluginPath"
Write-Output "marketplaceName=$($marketplace.name)"

try {
  codex plugin add "codex-peer@$($marketplace.name)"
  Write-Output "pluginAdd=ok"
} catch {
  Write-Output "pluginAdd=failed"
  Write-Output $_.Exception.Message
}
