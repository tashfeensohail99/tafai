#!/usr/bin/env pwsh
# =============================================================
# run-migrations.ps1
# Run once Docker Desktop is started.
# Usage: .\run-migrations.ps1
# =============================================================

$ErrorActionPreference = 'Stop'

Write-Host "⏳ Waiting for postgres to be healthy..." -ForegroundColor Cyan

$maxWait = 60  # seconds
$elapsed = 0

while ($elapsed -lt $maxWait) {
    $state = docker inspect --format '{{.State.Health.Status}}' tafsheen_postgres 2>$null
    if ($state -eq 'healthy') { break }
    Start-Sleep -Seconds 3
    $elapsed += 3
    Write-Host "  ... $elapsed s"
}

if ($elapsed -ge $maxWait) {
    Write-Error "Postgres did not become healthy within $maxWait seconds. Aborting."
    exit 1
}

Write-Host "✅ Postgres is healthy" -ForegroundColor Green

Push-Location "$PSScriptRoot\apps\backend"

$env:DATABASE_URL = "postgresql://tafsheen_user:tafsheen_password@localhost:5432/tafsheen_db"

Write-Host "`n🔨 Running initial migration..." -ForegroundColor Cyan
npx prisma migrate dev --name init

Write-Host "`n🌱 Seeding database..." -ForegroundColor Cyan
npx ts-node prisma/seed.ts

Write-Host "`n✅ Database ready." -ForegroundColor Green
Pop-Location
