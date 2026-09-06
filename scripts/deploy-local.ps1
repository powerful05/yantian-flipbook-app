[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 4194,
  [switch]$EnablePaidRequests,
  [switch]$SkipInstall,
  [switch]$NoWait
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$logRoot = Join-Path $projectRoot "runtime-logs"
$stdoutLog = Join-Path $logRoot "server-$Port.log"
$stderrLog = Join-Path $logRoot "server-$Port.error.log"

Set-Location -LiteralPath $projectRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required but was not found in PATH."
}

$nodeMajor = [int]((node --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 20) {
  throw "Node.js 20 or newer is required. Current version: $(node --version)"
}

$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($listener) {
  $owners = ($listener.OwningProcess | Sort-Object -Unique) -join ", "
  throw "Port $Port is already in use by process ID(s): $owners"
}

if (-not $SkipInstall) {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
}

npm test
if ($LASTEXITCODE -ne 0) { throw "Automated tests failed with exit code $LASTEXITCODE" }

npm run validate:dataset
if ($LASTEXITCODE -ne 0) { throw "P0 dataset validation failed with exit code $LASTEXITCODE" }

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$env:PORT = [string]$Port
$env:NO_PROXY = "127.0.0.1,localhost"

if ($EnablePaidRequests) {
  if ([string]::IsNullOrWhiteSpace($env:DASHSCOPE_API_KEY)) {
    throw "EnablePaidRequests requires DASHSCOPE_API_KEY in the current process environment."
  }
  $env:MODEL_REQUESTS_ENABLED = "true"
} else {
  $env:MODEL_REQUESTS_ENABLED = "false"
  $env:MOTION_GENERATION_MODE = "off"
  Remove-Item Env:DASHSCOPE_API_KEY -ErrorAction SilentlyContinue
}

$process = Start-Process node `
  -ArgumentList "--env-file-if-exists=.env.local", "server.mjs" `
  -WorkingDirectory $projectRoot `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -WindowStyle Hidden `
  -PassThru

$healthUrl = "http://127.0.0.1:$Port/api/model/status"
$healthy = $false
for ($attempt = 1; $attempt -le 20; $attempt++) {
  if ($process.HasExited) { break }
  try {
    $statusJson = & curl.exe --noproxy "*" --fail --silent --show-error $healthUrl 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Health endpoint returned a non-success status." }
    $status = $statusJson | ConvertFrom-Json
    $healthy = $true
    break
  } catch {
    Start-Sleep -Milliseconds 250
  }
}

if (-not $healthy) {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  $errorTail = if (Test-Path $stderrLog) { (Get-Content $stderrLog -Tail 20) -join [Environment]::NewLine } else { "No error log was written." }
  throw "Server health check failed at $healthUrl.$([Environment]::NewLine)$errorTail"
}

Write-Host "Yantian Flipbook is running at http://127.0.0.1:$Port/"
Write-Host "PID: $($process.Id)"
Write-Host "Model requests enabled: $($status.paidRequestsEnabled)"
Write-Host "Logs: $stdoutLog and $stderrLog"

if ($NoWait) {
  return
}

try {
  Wait-Process -Id $process.Id
} finally {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id }
}
