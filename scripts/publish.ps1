# Publishes the dashboard to Cloudflare in one go:
#   1. makes sure the TOKEN_KEY secret exists (encrypts the Google token; generated once, backed up in .prod.vars)
#   2. applies pending D1 migrations to the production database
#   3. builds and deploys the Worker
# Usage (from the project folder):  powershell -ExecutionPolicy Bypass -File scripts/publish.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

# 1. TOKEN_KEY: reuse the saved one; never regenerate (that would break a connected Google account).
if (-not (Test-Path .prod.vars)) { New-Item -ItemType File .prod.vars | Out-Null }
$saved = Select-String -Path .prod.vars -Pattern '^TOKEN_KEY=(.+)$' | Select-Object -First 1
if ($saved) {
  $key = $saved.Matches[0].Groups[1].Value.Trim()
} else {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $key = [Convert]::ToBase64String($bytes)
  Add-Content -Path .prod.vars -Value "TOKEN_KEY=$key" -Encoding ascii
  Write-Host "Generated a new TOKEN_KEY (saved in .prod.vars, never commit it)."
}
Write-Host "`n[1/3] Uploading TOKEN_KEY secret..."
$key | npx wrangler secret put TOKEN_KEY
if ($LASTEXITCODE -ne 0) { throw "Could not set TOKEN_KEY" }

Write-Host "`n[2/3] Applying database migrations..."
npx wrangler d1 migrations apply dashboard-contempra --remote
if ($LASTEXITCODE -ne 0) { throw "Migrations failed" }

Write-Host "`n[3/3] Building and deploying..."
npm run deploy
if ($LASTEXITCODE -ne 0) { throw "Deploy failed" }

Write-Host "`nDone: https://dashboard-contempra.digitalcontempra.workers.dev" -ForegroundColor Green
