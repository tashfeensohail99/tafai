$tok = "33fa0d2e-6979-4f79-b999-a6851d35f78b"
$deployId = "163fd85b-8298-4efa-8dad-9ce698555d91"
$headers = @{ Authorization = "Bearer $tok" }

# Get build logs for the failed deployment
$q = 'query { deploymentLogs(deploymentId: "' + $deployId + '") { message timestamp severity } }'
$b = (ConvertTo-Json @{query=$q} -Compress)
try {
    $r = Invoke-RestMethod "https://backboard.railway.app/graphql/v2" -Method POST -ContentType "application/json" -Headers $headers -Body $b
    $r | ConvertTo-Json -Depth 10
} catch {
    Write-Host "Error: $_"
}
