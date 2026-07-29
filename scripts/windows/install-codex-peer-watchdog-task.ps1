[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,

    [ValidateNotNullOrEmpty()]
    [string]$TaskName = "CodexPeerRecoveryWatchdog",

    [ValidateRange(1, 1440)]
    [int]$IntervalMinutes = 5
)

$ErrorActionPreference = "Stop"

$resolvedConfigPath = (Resolve-Path -LiteralPath $ConfigPath -ErrorAction Stop).Path
$launcherPath = Join-Path $PSScriptRoot "codex-peer-watchdog-hidden.vbs"
$watchdogPath = Join-Path (Split-Path -Parent $PSScriptRoot) "codex-peer-watchdog.mjs"
$nodeExecutable = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
$wscriptExecutable = Join-Path $env:WINDIR "System32\wscript.exe"

foreach ($requiredPath in @($launcherPath, $watchdogPath, $nodeExecutable, $wscriptExecutable)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required watchdog file was not found: $requiredPath"
    }
    if ($requiredPath.Contains('"')) {
        throw "Paths containing a double quote are not supported: $requiredPath"
    }
}

$actionArguments = '//B //Nologo "{0}" "{1}" "{2}"' -f `
    $launcherPath, $resolvedConfigPath, $nodeExecutable
$action = New-ScheduledTaskAction `
    -Execute $wscriptExecutable `
    -Argument $actionArguments `
    -WorkingDirectory (Split-Path -Parent $watchdogPath)
$trigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$principal = New-ScheduledTaskPrincipal `
    -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive `
    -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
    -Hidden `
    -MultipleInstances IgnoreNew
$task = New-ScheduledTask `
    -Action $action `
    -Description "Codex Peer receiver recovery watchdog with a hidden Windows launcher." `
    -Principal $principal `
    -Settings $settings `
    -Trigger $trigger

Register-ScheduledTask `
    -TaskName $TaskName `
    -TaskPath "\" `
    -InputObject $task `
    -Force | Out-Null

$registered = Get-ScheduledTask -TaskName $TaskName -TaskPath "\"
$registeredInfo = Get-ScheduledTaskInfo -TaskName $TaskName -TaskPath "\"

[pscustomobject]@{
    TaskName = $registered.TaskName
    Execute = $registered.Actions.Execute
    Arguments = $registered.Actions.Arguments
    Hidden = $registered.Settings.Hidden
    LastTaskResult = $registeredInfo.LastTaskResult
    NextRunTime = $registeredInfo.NextRunTime
} | ConvertTo-Json -Depth 3
