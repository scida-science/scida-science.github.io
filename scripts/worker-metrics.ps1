param(
    [DateTimeOffset]$StartTime = [DateTimeOffset]::UtcNow.AddMinutes(-30),
    [DateTimeOffset]$EndTime = [DateTimeOffset]::UtcNow,
    [string]$WranglerAuthFile = (Join-Path $env:APPDATA 'xdg.config\.wrangler\config\default.toml')
)

# Read-only analytics: no deployment, subscription changes, or persisted logs.
# Cloudflare's GraphQL schema defines cpuTimeP50/cpuTimeP99 in microseconds.
# Report milliseconds below; wall-clock request duration is not CPU time.
$ErrorActionPreference = 'Stop'
if ($StartTime -ge $EndTime) {
    throw 'StartTime must be earlier than EndTime.'
}
if (($EndTime - $StartTime).TotalDays -gt 30) {
    throw 'Choose a metrics window of at most 30 days.'
}
if (-not (Test-Path -LiteralPath $WranglerAuthFile -PathType Leaf)) {
    throw 'Wrangler credentials were not found. Run npx wrangler login first, or specify WranglerAuthFile.'
}

$accountId = '7793a39e5e29874ce53aa334fc1b5544'
$scriptName = 'scida-api'
$query = @'
query GetWorkersAnalytics($accountTag: string, $datetimeStart: string, $datetimeEnd: string, $scriptName: string) {
  viewer {
    accounts(filter: {accountTag: $accountTag}) {
      workersInvocationsAdaptive(limit: 100, filter: {
        scriptName: $scriptName,
        datetime_geq: $datetimeStart,
        datetime_leq: $datetimeEnd
      }) {
        sum { requests errors subrequests }
        quantiles { cpuTimeP50 cpuTimeP99 }
        dimensions { scriptName status }
      }
    }
  }
}
'@
$startUtc = $StartTime.ToUniversalTime().ToString('o')
$endUtc = $EndTime.ToUniversalTime().ToString('o')
$payload = @{
    query = $query
    variables = @{
        accountTag = $accountId
        datetimeStart = $startUtc
        datetimeEnd = $endUtc
        scriptName = $scriptName
    }
} | ConvertTo-Json -Depth 5 -Compress

$token = $null
$authText = $null
$headers = $null
try {
    $authText = Get-Content -LiteralPath $WranglerAuthFile -Raw
    $tokenMatch = [regex]::Match($authText, '(?m)^oauth_token\s*=\s*"([^"]+)"')
    if (-not $tokenMatch.Success) {
        throw 'The selected Wrangler profile has no OAuth token. Run npx wrangler login first.'
    }
    $token = $tokenMatch.Groups[1].Value
    $headers = @{ Authorization = "Bearer $token" }
    try {
        $response = Invoke-RestMethod -Method Post `
            -Uri 'https://api.cloudflare.com/client/v4/graphql' `
            -Headers $headers -ContentType 'application/json' -Body $payload
    }
    catch {
        # Do not print raw HTTP bodies, request headers, or authentication data.
        $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 'unavailable' }
        throw "Cloudflare metrics request failed (HTTP $status). Check connectivity and Wrangler authentication."
    }
    if ($response.errors) {
        throw 'Cloudflare rejected the analytics query. Check the time window and account analytics permissions; no raw response was printed.'
    }
    $accounts = @($response.data.viewer.accounts)
    if ($accounts.Count -ne 1 -or $null -eq $accounts[0]) {
        throw 'Cloudflare did not return the configured account. Check Wrangler authentication and account access.'
    }
    $rows = @($accounts[0].workersInvocationsAdaptive | ForEach-Object {
        [pscustomobject]@{
            scriptName = $_.dimensions.scriptName
            status = $_.dimensions.status
            requests = $_.sum.requests
            errors = $_.sum.errors
            subrequests = $_.sum.subrequests
            cpuP50Milliseconds = [math]::Round($_.quantiles.cpuTimeP50 / 1000, 6)
            cpuP99Milliseconds = [math]::Round($_.quantiles.cpuTimeP99 / 1000, 6)
        }
    })
    [pscustomobject]@{
        startTimeUtc = $startUtc
        endTimeUtc = $endUtc
        scriptName = $scriptName
        metrics = $rows
        note = 'CPU quantiles are Cloudflare measurements, converted from microseconds to milliseconds. Metrics may be sampled or delayed; HTTP application errors can still have a success invocation status.'
    } | ConvertTo-Json -Depth 5
}
finally {
    $token = $null
    $tokenMatch = $null
    $authText = $null
    $headers = $null
}
