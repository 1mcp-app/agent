# Temporary CI driver: replace only interactive credential acquisition and selected
# failure boundaries. All normal Task Scheduler operations and runtime actions are real.
param([string]$Root, [string]$Request)
$ErrorActionPreference = 'Stop'
$secret = Get-Content (Join-Path $Root 'credential.json') -Raw | ConvertFrom-Json
$credential = New-Object System.Management.Automation.PSCredential(
    $secret.account, (ConvertTo-SecureString $secret.password -AsPlainText -Force))
function Get-Credential { param($UserName, $Message) return $credential }
$call = Get-Content $Request -Raw | ConvertFrom-Json
$parameters = @{}
$call.parameters.PSObject.Properties | ForEach-Object { $parameters[$_.Name] = $_.Value }
switch ($call.fault) {
    'stop-error' { function Stop-ScheduledTask { param($TaskName, $ErrorAction) throw 'Acceptance injected stop failure' } }
    'stop-timeout' { function Stop-ScheduledTask { param($TaskName, $ErrorAction) } }
    'registration-error' { function Register-ScheduledTask { throw 'Acceptance injected registration failure' } }
    'removal-error' { function Unregister-ScheduledTask { throw 'Acceptance injected removal failure' } }
}
& (Join-Path $Root 'install-windows-task.ps1') @parameters
