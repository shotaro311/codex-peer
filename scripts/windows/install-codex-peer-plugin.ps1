param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$MarketplaceName = "shotaro-local"
)

$ErrorActionPreference = "Stop"

$codexHome = Join-Path $env:USERPROFILE ".codex"
$marketRoot = Join-Path $codexHome ".agents\plugins"
$pluginsRoot = Join-Path $marketRoot "plugins"
$pluginPath = Join-Path $pluginsRoot "codex-peer"
$marketplacePath = Join-Path $marketRoot "marketplace.json"

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
