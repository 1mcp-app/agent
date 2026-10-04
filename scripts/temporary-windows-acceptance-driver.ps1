# Temporary CI driver: replace only interactive credential acquisition and selected
# failure boundaries. All normal Task Scheduler operations and runtime actions are real.
param([string]$Root, [string]$Request)
$ErrorActionPreference = 'Stop'
# Load cmdlets in this scope before shadowing; child-script autoload would hide parent functions.
Import-Module ScheduledTasks -ErrorAction Stop
$secret = Get-Content (Join-Path $Root 'credential.json') -Raw | ConvertFrom-Json
$credential = New-Object System.Management.Automation.PSCredential(
    $secret.account, (ConvertTo-SecureString $secret.password -AsPlainText -Force))
function Get-Credential { param($UserName, $Message) return $credential }
$call = Get-Content $Request -Raw | ConvertFrom-Json
$parameters = @{}
$call.parameters.PSObject.Properties | ForEach-Object { $parameters[$_.Name] = $_.Value }
switch ($call.fault) {
    'stop-error' { function Stop-ScheduledTask { param($TaskName, $ErrorAction) Set-Content ($Request + '.fault-observed') 'stop-error'; throw 'Acceptance injected stop failure' } }
    'stop-timeout' { function Stop-ScheduledTask { param($TaskName, $ErrorAction) Set-Content ($Request + '.fault-observed') 'stop-timeout' } }
    'registration-error' { function Register-ScheduledTask { Set-Content ($Request + '.fault-observed') 'registration-error'; throw 'Acceptance injected registration failure' } }
    'removal-error' { function Unregister-ScheduledTask { Set-Content ($Request + '.fault-observed') 'removal-error'; throw 'Acceptance injected removal failure' } }
}
try {
    & (Join-Path $Root 'install-windows-task.ps1') @parameters
    exit 0
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
}
