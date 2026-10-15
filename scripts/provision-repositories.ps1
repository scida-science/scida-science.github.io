# Run from the project root after authenticating Git Credential Manager.
# Idempotent: creates missing repositories/files and preserves every existing file.
param([string]$Organization = 'scida-science')
$ErrorActionPreference = 'Stop'
if ($Organization -ne 'scida-science') { throw 'Review this setup script before targeting a different organization.' }
$env:GCM_INTERACTIVE = 'Never'
$credentialLines = "protocol=https`nhost=github.com`n`n" | git -c credential.interactive=never credential fill
if ($LASTEXITCODE -ne 0) { throw 'Authenticate Git Credential Manager before provisioning repositories.' }
$credentials = @{}
foreach ($line in $credentialLines) { if ($line -match '^([^=]+)=(.*)$') { $credentials[$matches[1]]=$matches[2] } }
$headers = @{ Authorization=('Bearer '+$credentials['password']); Accept='application/vnd.github+json'; 'X-GitHub-Api-Version'='2022-11-28' }
Remove-Variable credentials,credentialLines
function Invoke-RepositoryApi {
  param([string]$Path,[string]$Method='Get',[object]$Body=$null)
  $args=@{Uri=('https://api.github.com'+$Path);Headers=$headers;Method=$Method;ErrorAction='Stop'}
  if ($null -ne $Body) { $args.Body=ConvertTo-Json -InputObject $Body -Depth 40 -Compress; $args.ContentType='application/json' }
  Invoke-RestMethod @args
}
$membership=Invoke-RepositoryApi -Path "/user/memberships/orgs/$Organization"
if ($membership.state -ne 'active' -or $membership.role -ne 'admin') { throw 'An active organization owner must run this setup.' }
$seeds = node (Join-Path $PSScriptRoot 'repository-seeds.mjs') | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Could not read the empty administrative repository template.' }
foreach ($seed in $seeds) {
  $repoPath="/repos/$Organization/$($seed.name)"
  try { $repo=Invoke-RepositoryApi -Path $repoPath }
  catch {
    if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
    $repo=Invoke-RepositoryApi -Path "/orgs/$Organization/repos" -Method Post -Body @{name=$seed.name;private=$true;description=$seed.description;has_issues=$true;has_wiki=$false;auto_init=$false}
  }
  if (-not $repo.private -or $repo.archived) { throw "Preserving $($seed.name): it is not an active private repository. Review manually." }
  foreach ($file in $seed.files.PSObject.Properties) {
    $contentPath=$repoPath+'/contents/'+$file.Name
    try { $null=Invoke-RepositoryApi -Path $contentPath; Write-Output "Preserved existing $($seed.name)/$($file.Name)"; continue }
    catch { if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw } }
    $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$file.Value))
    $null=Invoke-RepositoryApi -Path $contentPath -Method Put -Body @{message='Initialize SciDA repository format';content=$encoded}
    Write-Output "Created $($seed.name)/$($file.Name)"
  }
  Write-Output "Private repository ready: $($repo.html_url)"
}
