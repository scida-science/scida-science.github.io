# Local, masked input only. The plaintext travels through a pipe to Wrangler;
# it is never written into a file, command argument, environment variable, or chat.
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'SciDA - verify and upload client secret'
$scidaHelper = Join-Path $PSScriptRoot 'configure-client-secret.mjs'
Write-Host 'GitHub App: https://github.com/organizations/scida-science/settings/apps/scida-research-portal/client_secrets'
Write-Host 'Paste the complete newly generated client secret VALUE, not its label, ID, hash, or a private key.'
Write-Host 'If GitHub only shows a masked value, generate a new client secret first.'
Write-Host 'This checks the value with GitHub before uploading it through Wrangler. Nothing is saved locally.'
for ($scidaAttempt = 1; $scidaAttempt -le 3; $scidaAttempt++) {
    $scidaSecure = $null
    $scidaValue = $null
    try {
        $scidaSecure = Read-Host 'Paste client secret here (hidden), then press Enter' -AsSecureString
        $scidaValue = [System.Net.NetworkCredential]::new('', $scidaSecure).Password
        $scidaValue | & node $scidaHelper
        if ($LASTEXITCODE -eq 0) { break }
        Write-Host 'The check did not succeed. Correct the value and try again in this window.' -ForegroundColor Yellow
    } finally {
        $scidaValue = $null
        if ($null -ne $scidaSecure) { $scidaSecure.Dispose() }
    }
}
Read-Host 'Press Enter to close this window'
