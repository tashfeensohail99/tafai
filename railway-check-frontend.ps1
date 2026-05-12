$tok = "33fa0d2e-6979-4f79-b999-a6851d35f78b"
$svcId = "d70c434d-f600-4a5f-aaf9-c81c0c59d6bd"
$envId = "72b43bf0-ef3d-478d-82f5-378b43297c8d"
$headers = @{ Authorization = "Bearer $tok" }

function Invoke-GQL($query) {
    $body = (ConvertTo-Json @{query=$query} -Compress)
    Invoke-RestMethod "https://backboard.railway.app/graphql/v2" -Method POST -ContentType "application/json" -Headers $headers -Body $body
}

# Check current config
Write-Host "=== Current service instance config ==="
$q1 = 'query { serviceInstance(serviceId: "' + $svcId + '", environmentId: "' + $envId + '") { dockerfilePath buildCommand startCommand source { ... on GitHubRepo { repo branch } } } }'
$r1 = Invoke-GQL $q1
$r1 | ConvertTo-Json -Depth 10
