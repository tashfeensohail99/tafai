$tok = "rw_Fe26.2**e803d7918e3d5e3c64bc0f8c8cfa468dcb9faf5fc18fe4b4c8bdd5b999333343*vnb4ECT2BPk_wQnO7mmxnQ*_0A2iY_JS5pduL9uta4CNVa58b_-Whe5TApIbsNKxLIVd8y2A61WPtFmfBIDIZ3-lFPhH2lXLr7l0qlzGPBUpQ*1781160087168*12bbed4576b9aac3c9841e718840b5d95f5e006b68bf623e405ab968cfc996fd*YukYRWszQ766Or-_s6xHryOKv8EMaDZfP61DHGQ3BDc"

$h = @{
    "Authorization" = "Bearer $tok"
    "Content-Type"  = "application/json"
}

$q = '{"query":"{ serviceInstance(environmentId: \"72b43bf0-ef3d-478d-82f5-378b43297c8d\", serviceId: \"e24b48dd-0d49-44ca-86e9-fbee22bdfab8\") { envVars { edges { node { name value } } } } }"}'

try {
    $r = Invoke-RestMethod -Uri "https://backboard.railway.app/graphql/v2" -Method POST -Headers $h -Body $q -ErrorAction Stop
    $json = $r | ConvertTo-Json -Depth 10
    $json | Out-File -FilePath "d:\tafsheen\railway-vars-dump.json" -Encoding utf8 -Force
    Write-Host "SUCCESS - written to railway-vars-dump.json"
    # Print DB-related vars
    $vars = $r.data.variables
    if ($vars) {
        Write-Host "`n=== ALL VARIABLE KEYS ==="
        $vars.PSObject.Properties | Sort-Object Name | ForEach-Object { Write-Host "  $($_.Name)" }
        Write-Host "`n=== DB / SUPABASE VARS ==="
        $vars.PSObject.Properties | Where-Object { $_.Name -match "DATABASE|SUPABASE|DIRECT|POSTGRES|DB_" } | ForEach-Object {
            Write-Host "  $($_.Name) = $($_.Value)"
        }
    }
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    $_ | Out-File "d:\tafsheen\railway-vars-dump.json" -Encoding utf8 -Force
}
