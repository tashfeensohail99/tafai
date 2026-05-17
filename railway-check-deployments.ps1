$tok = "33fa0d2e-6979-4f79-b999-a6851d35f78b"
$svcId = "d70c434d-f600-4a5f-aaf9-c81c0c59d6bd"
$envId = "72b43bf0-ef3d-478d-82f5-378b43297c8d"
$headers = @{ Authorization = "Bearer $tok" }

function Invoke-GQL($query) {
    $body = (ConvertTo-Json @{query=$query} -Compress)
    Invoke-RestMethod "https://backboard.railway.app/graphql/v2" -Method POST -ContentType "application/json" -Headers $headers -Body $body
}

# Get latest deployments - simple fields only
Write-Host "=== Latest deployments ==="
$q = 'query { deployments(input: { serviceId: "' + $svcId + '", environmentId: "' + $envId + '" }) { edges { node { id status createdAt } } } }'
$r = Invoke-GQL $q
$r | ConvertTo-Json -Depth 10

# Also check what dockerfile is actually set
Write-Host "`n=== Service instance config ==="
$q2 = 'query { serviceInstance(serviceId: "' + $svcId + '", environmentId: "' + $envId + '") { dockerfilePath } }'
$r2 = Invoke-GQL $q2
$r2 | ConvertTo-Json -Depth 5
