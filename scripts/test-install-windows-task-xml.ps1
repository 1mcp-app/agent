# Live Windows configuration test for install-windows-task.ps1.
# Registers a non-running temporary task, exports its XML, validates the
# production trigger/settings builders, and always removes the task.

#Requires -Version 5.1
param(
    [string]$ScriptPath = '',
    [string]$OutputPath = '.tmp/windows-installer-task.xml'
)

$ErrorActionPreference = 'Stop'

if (-not $ScriptPath) {
    $ScriptPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'install-windows-task.ps1'
}

function Import-ScriptFunction {
    param([Parameter(Mandatory = $true)][string]$Name)

    $tokens = $null
    $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        (Resolve-Path $ScriptPath).Path,
        [ref]$tokens,
        [ref]$parseErrors
    )
    if ($parseErrors.Count -gt 0) {
        throw ($parseErrors | Format-List | Out-String)
    }

    $functionAst = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
            $node.Name -eq $Name
    }, $true)
    if (-not $functionAst) {
        throw "Function '$Name' was not found in $ScriptPath"
    }

    $body = $functionAst.Body.Extent.Text
    Set-Item `
        -Path "Function:script:$Name" `
        -Value ([scriptblock]::Create($body.Substring(1, $body.Length - 2)))
}

function Get-TaskXmlNode {
    param(
        [Parameter(Mandatory = $true)][xml]$Xml,
        [Parameter(Mandatory = $true)][string]$XPath
    )

    $namespace = [System.Xml.XmlNamespaceManager]::new($Xml.NameTable)
    $namespace.AddNamespace('t', $Xml.DocumentElement.NamespaceURI)
    return $Xml.SelectSingleNode($XPath, $namespace)
}

Import-ScriptFunction -Name 'New-1McpScheduledTaskTriggers'
Import-ScriptFunction -Name 'New-1McpScheduledTaskSettings'

$taskName = "1mcp-config-test-$([guid]::NewGuid().ToString('N'))"
$registered = $false

try {
    $triggers = New-1McpScheduledTaskTriggers -RecoveryMinutes 60
    $settings = New-1McpScheduledTaskSettings
    $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/d /c exit 0'
    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $principal = New-ScheduledTaskPrincipal `
        -UserId $currentUser `
        -LogonType Interactive `
        -RunLevel Limited
    $definition = New-ScheduledTask `
        -Action $action `
        -Trigger $triggers `
        -Settings $settings `
        -Principal $principal

    Register-ScheduledTask -TaskName $taskName -InputObject $definition -Force | Out-Null
    $registered = $true
    [xml]$xml = Export-ScheduledTask -TaskName $taskName
    $resolvedOutputPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
    $outputDirectory = Split-Path -Parent $resolvedOutputPath
    if ($outputDirectory) {
        New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
    }
    $xml.Save($resolvedOutputPath)

    $bootTrigger = Get-TaskXmlNode -Xml $xml -XPath '/t:Task/t:Triggers/t:BootTrigger'
    $timeTrigger = Get-TaskXmlNode -Xml $xml -XPath '/t:Task/t:Triggers/t:TimeTrigger'
    if (-not $bootTrigger -or -not $timeTrigger) {
        throw 'Exported XML must contain separate BootTrigger and TimeTrigger elements.'
    }

    $intervalNode = Get-TaskXmlNode -Xml $xml -XPath '/t:Task/t:Triggers/t:TimeTrigger/t:Repetition/t:Interval'
    if (-not $intervalNode -or
        [System.Xml.XmlConvert]::ToTimeSpan($intervalNode.InnerText).TotalMinutes -ne 60) {
        throw "Exported repetition interval was '$($intervalNode.InnerText)', expected 60 minutes."
    }
    if (Get-TaskXmlNode -Xml $xml -XPath '/t:Task/t:Triggers/t:TimeTrigger/t:Repetition/t:Duration') {
        throw 'Exported recurrence must omit Duration so repetition remains indefinite.'
    }
    if ((Get-TaskXmlNode -Xml $xml -XPath '/t:Task/t:Triggers/t:TimeTrigger/t:EndBoundary') -or
        (Get-TaskXmlNode -Xml $xml -XPath '/t:Task/t:Triggers/t:BootTrigger/t:EndBoundary')) {
        throw 'Exported startup and recovery triggers must not have an EndBoundary.'
    }

    $multipleInstances = Get-TaskXmlNode -Xml $xml -XPath '/t:Task/t:Settings/t:MultipleInstancesPolicy'
    if ($multipleInstances.InnerText -ne 'IgnoreNew') {
        throw "MultipleInstancesPolicy was '$($multipleInstances.InnerText)', expected IgnoreNew."
    }
    $restartCount = Get-TaskXmlNode -Xml $xml -XPath '/t:Task/t:Settings/t:RestartOnFailure/t:Count'
    $restartInterval = Get-TaskXmlNode -Xml $xml -XPath '/t:Task/t:Settings/t:RestartOnFailure/t:Interval'
    if ($restartCount.InnerText -ne '5' -or
        [System.Xml.XmlConvert]::ToTimeSpan($restartInterval.InnerText).TotalMinutes -ne 2) {
        throw 'Exported XML did not retain five immediate retries at two-minute intervals.'
    }

    $executionLimit = Get-TaskXmlNode -Xml $xml -XPath '/t:Task/t:Settings/t:ExecutionTimeLimit'
    if ([System.Xml.XmlConvert]::ToTimeSpan($executionLimit.InnerText) -ne [timespan]::Zero) {
        throw "ExecutionTimeLimit was '$($executionLimit.InnerText)', expected no limit."
    }

    Write-Host "PASS: exported task XML for '$taskName' retains startup, recovery, retry, and IgnoreNew settings."
    Write-Host "Evidence: $resolvedOutputPath"
    Write-Host 'Scope: the temporary interactive principal and cmd.exe action validate Task Scheduler XML only; they do not prove the production password account or binary/npm runtime lifecycle.'
} finally {
    if ($registered) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
        try {
            Get-ScheduledTask -TaskName $taskName -ErrorAction Stop | Out-Null
            throw "Temporary task '$taskName' is still registered after cleanup."
        } catch {
            if ($_.FullyQualifiedErrorId -notmatch 'CmdletizationQuery_NotFound_TaskName') {
                throw
            }
        }
    }
}
