$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Set-Location (Split-Path $PSScriptRoot)
$planJson = & node scripts/prepare-current.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$plan = $planJson | ConvertFrom-Json
$java = $plan.java
$ErrorActionPreference = 'Continue'
$version = & $java -version 2>&1 | Out-String
$javaExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($javaExit -ne 0) { throw "Java detection failed. $version" }
if ($version -notmatch 'version "(?:1\.)?(\d+)' -or [int]$Matches[1] -ne $plan.major) {
    throw "This instance requires Java $($plan.major). $version"
}
Set-Location $plan.cwd
$gameArgs = [string[]]$plan.args
& $java @gameArgs
exit $LASTEXITCODE

