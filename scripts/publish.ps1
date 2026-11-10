# Publishes the dashboard to Cloudflare in one go:
#   1. makes sure the TOKEN_KEY secret exists (encrypts the Google token; generated once, backed up in .prod.vars)
#   2. applies pending D1 migrations to the production database
#   3. builds and deploys the Worker
# Each network step is retried up to 3 times (flaky Wi-Fi / IPv6 drops show up as "fetch failed").
# Usage (from the project folder):  powershell -ExecutionPolicy Bypass -File scripts/publish.ps1 [-ResendKey]
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
# Prefer IPv4: some networks drop IPv6 to api.cloudflare.com intermittently.
# On slow links Node gives up on each connection attempt after 250 ms ("fetch failed" / ETIMEDOUT);
# allow 3 s per attempt.
$env:NODE_OPTIONS = "--dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=3000"

function Invoke-WithRetry([string]$Label, [scriptblock]$Step) {
  for ($try = 1; $try -le 3; $try++) {
    & $Step
    if ($LASTEXITCODE -eq 0) { return }
    if ($try -lt 3) {
      Write-Host "  $Label failed (attempt $try of 3). Retrying in 10 seconds..." -ForegroundColor Yellow
      Start-Sleep -Seconds 10
    }
  }
  throw "$Label failed 3 times. Check your internet connection and run the script again."
}

# 1. TOKEN_KEY: reuse the saved one; never regenerate (that would break a connected Google account).
if (-not (Test-Path .prod.vars)) { New-Item -ItemType File .prod.vars | Out-Null }
$saved = Select-String -Path .prod.vars -Pattern '^TOKEN_KEY=(.+)$' | Select-Object -First 1
if ($saved) {
  Write-Host "`n[1/3] TOKEN_KEY already set (skipping)."
  if ($args -contains "-ResendKey") {
    $key = $saved.Matches[0].Groups[1].Value.Trim()
    Invoke-WithRetry "Uploading TOKEN_KEY" { $key | npx wrangler secret put TOKEN_KEY }
  }
} else {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $key = [Convert]::ToBase64String($bytes)
  Write-Host "`n[1/3] Uploading a new TOKEN_KEY secret..."
  Invoke-WithRetry "Uploading TOKEN_KEY" { $key | npx wrangler secret put TOKEN_KEY }
  Add-Content -Path .prod.vars -Value "TOKEN_KEY=$key" -Encoding ascii
  Write-Host "Saved TOKEN_KEY in .prod.vars (never commit it)."
}

Write-Host "`n[2/3] Applying database migrations..."
Invoke-WithRetry "Migrations" { npx wrangler d1 migrations apply dashboard-contempra --remote }

Write-Host "`n[3/3] Building and deploying..."
npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed" }
Invoke-WithRetry "Deploy" { npx wrangler deploy }

Write-Host "`nDone: https://dashboard-contempra.digitalcontempra.workers.dev" -ForegroundColor Green
