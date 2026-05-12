$tok = "33fa0d2e-6979-4f79-b999-a6851d35f78b"
$svcId = "d70c434d-f600-4a5f-aaf9-c81c0c59d6bd"
$envId = "72b43bf0-ef3d-478d-82f5-378b43297c8d"
$headers = @{ Authorization = "Bearer $tok" }

# Set Dockerfile path
$q1 = 'mutation { serviceInstanceUpdate(serviceId: "' + $svcId + '", environmentId: "' + $envId + '", input: { dockerfilePath: "Dockerfile.frontend" }) }'
$b1 = (ConvertTo-Json @{query=$q1} -Compress)
$r1 = Invoke-RestMethod "https://backboard.railway.app/graphql/v2" -Method POST -ContentType "application/json" -Headers $headers -Body $b1
Write-Host "Set Dockerfile result:"
$r1 | ConvertTo-Json -Depth 5

# Trigger deploy
$q2 = 'mutation { serviceInstanceDeploy(serviceId: "' + $svcId + '", environmentId: "' + $envId + '") }'
$b2 = (ConvertTo-Json @{query=$q2} -Compress)
$r2 = Invoke-RestMethod "https://backboard.railway.app/graphql/v2" -Method POST -ContentType "application/json" -Headers $headers -Body $b2
Write-Host "Deploy result:"
$r2 | ConvertTo-Json -Depth 5
