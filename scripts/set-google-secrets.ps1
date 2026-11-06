# Loads the Google OAuth client into the Worker secrets from the JSON downloaded from Google Cloud.
# Usage (from the project folder):
#   powershell -ExecutionPolicy Bypass -File scripts/set-google-secrets.ps1 "C:\path\to\client_secret_....json"
param([Parameter(Mandatory = $true)][string]$JsonPath)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$cfg = (Get-Content -Raw -Path $JsonPath | ConvertFrom-Json).web
if (-not $cfg.client_id -or -not $cfg.client_secret) { throw "This file has no web client_id / client_secret" }

Write-Host "Setting GOOGLE_CLIENT_ID..."
$cfg.client_id | npx wrangler secret put GOOGLE_CLIENT_ID
if ($LASTEXITCODE -ne 0) { throw "Could not set GOOGLE_CLIENT_ID" }

Write-Host "Setting GOOGLE_CLIENT_SECRET..."
$cfg.client_secret | npx wrangler secret put GOOGLE_CLIENT_SECRET
if ($LASTEXITCODE -ne 0) { throw "Could not set GOOGLE_CLIENT_SECRET" }

Write-Host "`nDone. Delete the downloaded JSON file now; the secret lives in Cloudflare." -ForegroundColor Green
