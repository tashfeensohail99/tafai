$tok = "33fa0d2e-6979-4f79-b999-a6851d35f78b"
$svcId = "d70c434d-f600-4a5f-aaf9-c81c0c59d6bd"
$envId = "72b43bf0-ef3d-478d-82f5-378b43297c8d"
$headers = @{ Authorization = "Bearer $tok" }

function Invoke-GQL($query) {
    $body = (ConvertTo-Json @{query=$query} -Compress)
    Invoke-RestMethod "https://backboard.railway.app/graphql/v2" -Method POST -ContentType "application/json" -Headers $headers -Body $body
}

# Check current config (no source fragment)
Write-Host "=== Current service instance config ==="
$q1 = 'query { serviceInstance(serviceId: "' + $svcId + '", environmentId: "' + $envId + '") { dockerfilePath buildCommand startCommand } }'
$r1 = Invoke-GQL $q1
$r1 | ConvertTo-Json -Depth 10

# Force-set correct dockerfile path
Write-Host "`n=== Set dockerfilePath = Dockerfile.frontend ==="
$q2 = 'mutation { serviceInstanceUpdate(serviceId: "' + $svcId + '", environmentId: "' + $envId + '", input: { dockerfilePath: "Dockerfile.frontend" }) }'
$r2 = Invoke-GQL $q2
$r2 | ConvertTo-Json -Depth 5

# Verify it was set
Write-Host "`n=== Verify dockerfilePath ==="
$r3 = Invoke-GQL $q1
$r3 | ConvertTo-Json -Depth 10

# Trigger redeploy
Write-Host "`n=== Trigger redeploy ==="
$q4 = 'mutation { serviceInstanceDeploy(serviceId: "' + $svcId + '", environmentId: "' + $envId + '") }'
$r4 = Invoke-GQL $q4
$r4 | ConvertTo-Json -Depth 5
