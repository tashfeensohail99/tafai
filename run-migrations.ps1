#!/usr/bin/env pwsh
# =============================================================
# run-migrations.ps1
# Runs Prisma migrations against Supabase.
#
# Prerequisites:
#   1. Fill in SUPABASE_DB_PASSWORD in apps/backend/.env
#   2. Run this script from the repo root: .\run-migrations.ps1
# =============================================================

$ErrorActionPreference = 'Stop'

Push-Location "$PSScriptRoot\apps\backend"

# Load .env so DATABASE_URL and DIRECT_URL are available to Prisma
if (Test-Path ".env") {
    Get-Content ".env" | Where-Object { $_ -match '^\s*[^#]' -and $_ -match '=' } | ForEach-Object {
        $parts = $_ -split '=', 2
        $key   = $parts[0].Trim()
        $value = $parts[1].Trim()
        [System.Environment]::SetEnvironmentVariable($key, $value, 'Process')
    }
    Write-Host "Loaded .env" -ForegroundColor Green
} else {
    Write-Error "apps/backend/.env not found. Copy .env.example to .env and fill in SUPABASE_DB_PASSWORD."
    exit 1
}

# Guard: make sure placeholders were replaced
if ($env:DIRECT_URL -like '*SUPABASE_DB_PASSWORD*') {
    Write-Error "DIRECT_URL still contains placeholder. Replace SUPABASE_DB_PASSWORD in apps/backend/.env first."
    exit 1
}

Write-Host "Generating Prisma client..." -ForegroundColor Cyan
.\node_modules\.bin\prisma generate

Write-Host "Running migrations against Supabase..." -ForegroundColor Cyan
.\node_modules\.bin\prisma migrate deploy

Write-Host "Migrations complete." -ForegroundColor Green
Write-Host "Re-run the Supabase SQL foundation script to apply tenant_id + RLS to all new tables." -ForegroundColor Yellow

Pop-Location

