$tok = "33fa0d2e-6979-4f79-b999-a6851d35f78b"
$svcId = "d70c434d-f600-4a5f-aaf9-c81c0c59d6bd"
$envId = "72b43bf0-ef3d-478d-82f5-378b43297c8d"
$headers = @{ Authorization = "Bearer $tok" }

function Invoke-GQL($query) {
    $body = (ConvertTo-Json @{query=$query} -Compress)
    $r = Invoke-RestMethod "https://backboard.railway.app/graphql/v2" -Method POST -ContentType "application/json" -Headers $headers -Body $body
    return $r
}

# Set rootDirectory to apps/frontend and clear dockerfilePath
Write-Host "=== Set rootDirectory=apps/frontend, clear dockerfilePath ==="
$q = 'mutation { serviceInstanceUpdate(serviceId: "' + $svcId + '", environmentId: "' + $envId + '", input: { rootDirectory: "apps/frontend", dockerfilePath: "" }) }'
$r = Invoke-GQL $q
$r | ConvertTo-Json -Depth 5

# Set NEXT_PUBLIC_API_URL as env var (needed at nixpacks build time)
Write-Host "`n=== Ensure NEXT_PUBLIC_API_URL var is set ==="
$q2 = 'mutation { variableUpsert(input: { projectId: "43e86cbf-c8ce-4359-9c07-be426ea6daea", environmentId: "' + $envId + '", serviceId: "' + $svcId + '", name: "NEXT_PUBLIC_API_URL", value: "https://backend-production-5a89.up.railway.app" }) }'
$r2 = Invoke-GQL $q2
$r2 | ConvertTo-Json -Depth 5

# Verify
Write-Host "`n=== Verify config ==="
$q3 = 'query { serviceInstance(serviceId: "' + $svcId + '", environmentId: "' + $envId + '") { rootDirectory dockerfilePath } }'
$r3 = Invoke-GQL $q3
$r3 | ConvertTo-Json -Depth 5
