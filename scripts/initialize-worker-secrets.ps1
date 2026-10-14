# Generate missing application signing secrets without displaying or committing them.
# Encrypted backups use Windows DPAPI and can be opened only by this Windows user.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$scidaProject = Split-Path -Parent $PSScriptRoot
$scidaConfig = Join-Path $scidaProject 'backend/wrangler.jsonc'
$scidaBackupDirectory = Join-Path $env:LOCALAPPDATA 'SciDA/worker-secrets'
$scidaWrangler = Join-Path $scidaProject 'node_modules/wrangler/bin/wrangler.js'
if (-not (Test-Path -LiteralPath $scidaWrangler)) { throw 'Run npm.cmd ci first.' }
$scidaList = & node $scidaWrangler secret list --config $scidaConfig --format json
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Worker secrets. Authenticate Wrangler first.' }
$scidaExisting = @($scidaList | ConvertFrom-Json)
New-Item -ItemType Directory -Force -Path $scidaBackupDirectory | Out-Null
foreach ($scidaName in @('SESSION_SECRET', 'DISCUSSION_SECRET')) {
    if ($scidaExisting.name -contains $scidaName) {
        Write-Output "$scidaName already exists in the Worker; preserved."
        continue
    }
    $scidaBackupPath = Join-Path $scidaBackupDirectory ("scida-api-$scidaName.dpapi")
    $scidaValue = $null
    $scidaSecure = $null
    try {
        if (Test-Path -LiteralPath $scidaBackupPath) {
            $scidaSecure = Get-Content -LiteralPath $scidaBackupPath -Raw | ConvertTo-SecureString
            $scidaValue = [System.Net.NetworkCredential]::new('', $scidaSecure).Password
        } else {
            $scidaBytes = New-Object byte[] 48
            $scidaRandom = [System.Security.Cryptography.RandomNumberGenerator]::Create()
            try { $scidaRandom.GetBytes($scidaBytes) } finally { $scidaRandom.Dispose() }
            $scidaValue = [Convert]::ToBase64String($scidaBytes)
            [Array]::Clear($scidaBytes, 0, $scidaBytes.Length)
            $scidaSecure = ConvertTo-SecureString -String $scidaValue -AsPlainText -Force
            $scidaSecure | ConvertFrom-SecureString | Set-Content -LiteralPath $scidaBackupPath -Encoding ASCII
        }
        $scidaValue | & node $scidaWrangler secret put $scidaName --config $scidaConfig
        if ($LASTEXITCODE -ne 0) { throw "Upload failed for $scidaName. Its encrypted backup was preserved." }
        Write-Output "$scidaName uploaded; encrypted backup retained outside the repository."
    } finally {
        $scidaValue = $null
        if ($null -ne $scidaSecure) { $scidaSecure.Dispose() }
    }
}
Write-Output "Backup directory: $scidaBackupDirectory"
Write-Output 'Keep DISCUSSION_SECRET stable. DPAPI backups require this Windows user and machine; keep a separate encrypted recovery backup before replacing this computer.'
