[CmdletBinding()]
param(
  [switch]$EnablePaidRequests
)

$ErrorActionPreference = "Stop"
$secureKey = Read-Host "Enter the rotated DashScope API Key" -AsSecureString
$keyPointer = [IntPtr]::Zero
$exitCode = 1

try {
  $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
  if ([string]::IsNullOrWhiteSpace($plainKey)) {
    throw "The API Key cannot be empty."
  }

  $env:DASHSCOPE_API_KEY = $plainKey
  if ($EnablePaidRequests) {
    $env:MODEL_REQUESTS_ENABLED = "true"
  } else {
    $env:MODEL_REQUESTS_ENABLED = "false"
  }

  & node --env-file-if-exists=.env.local server.mjs
  $exitCode = $LASTEXITCODE
} finally {
  Remove-Item Env:DASHSCOPE_API_KEY -ErrorAction SilentlyContinue
  $plainKey = $null
  if ($keyPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
  }
}

exit $exitCode

