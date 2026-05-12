$tok = "33fa0d2e-6979-4f79-b999-a6851d35f78b"
$projectId = "43e86cbf-c8ce-4359-9c07-be426ea6daea"
$backendUrl = "https://backend-production-5a89.up.railway.app"

function Invoke-GQL($query) {
    $body = @{ query = $query } | ConvertTo-Json -Compress
    $result = Invoke-RestMethod "https://backboard.railway.app/graphql/v2" `
        -Method POST `
        -ContentType "application/json" `
        -Headers @{ Authorization = "Bearer $tok" } `
        -Body $body
    return $result
}

# Step 1: Get environments and services
Write-Host "`n=== Step 1: Get environments ==="
$r1 = Invoke-GQL "{ project(id: `"$projectId`") { environments { edges { node { id name } } } services { edges { node { id name } } } } }"
$r1 | ConvertTo-Json -Depth 10

$envId = $r1.data.project.environments.edges[0].node.id
$svcs  = $r1.data.project.services.edges | ForEach-Object { $_.node.name }
Write-Host "Environment ID: $envId"
Write-Host "Existing services: $svcs"

# Step 2: Create frontend service
Write-Host "`n=== Step 2: Create frontend service ==="
$r2 = Invoke-GQL "mutation { serviceCreate(input: { projectId: `"$projectId`", name: `"frontend`" }) { id name } }"
$r2 | ConvertTo-Json -Depth 5
$svcId = $r2.data.serviceCreate.id
Write-Host "Frontend service ID: $svcId"

if (-not $svcId) {
    Write-Host "ERROR: serviceCreate failed"
    exit 1
}

# Step 3: Connect GitHub repo
Write-Host "`n=== Step 3: Connect GitHub ==="
$r3 = Invoke-GQL "mutation { serviceConnect(id: `"$svcId`", input: { repo: `"tashfeensohail99/tafai`", branch: `"main`" }) { id name } }"
$r3 | ConvertTo-Json -Depth 5

# Step 4: Set NEXT_PUBLIC_API_URL variable
Write-Host "`n=== Step 4: Set build variable ==="
$r4 = Invoke-GQL "mutation { variableUpsert(input: { projectId: `"$projectId`", environmentId: `"$envId`", serviceId: `"$svcId`", name: `"NEXT_PUBLIC_API_URL`", value: `"$backendUrl`" }) }"
$r4 | ConvertTo-Json -Depth 5

# Step 5: Generate domain
Write-Host "`n=== Step 5: Generate domain ==="
$r5 = Invoke-GQL "mutation { serviceDomainCreate(input: { serviceId: `"$svcId`", environmentId: `"$envId`" }) { domain } }"
$r5 | ConvertTo-Json -Depth 5
$domain = $r5.data.serviceDomainCreate.domain
Write-Host "Frontend URL: https://$domain"

Write-Host "`n=== Complete ==="
Write-Host "Service ID: $svcId"
Write-Host "Now trigger a deployment from the Railway dashboard or push to main."
