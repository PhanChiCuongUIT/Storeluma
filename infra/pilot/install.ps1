param(
    [Parameter(Mandatory)][string]$IdentityFile,
    [string]$InputFile = 'docs/local/pilot-input.env',
    [string]$ReleaseFile = 'docs/local/pilot-release.json'
)
$ErrorActionPreference = 'Stop'
$addressLine = @(Get-Content -LiteralPath $InputFile | Where-Object { $_ -match '^SERVER_IP=' })
if ($addressLine.Count -ne 1) { throw 'Fill SERVER_IP in the private input file.' }
$address = $addressLine[0].Substring(10).Trim()
if ($address -notmatch '^\d{1,3}(\.\d{1,3}){3}$' -or ![IPAddress]::TryParse($address,[ref]([IPAddress]$null))) { throw 'Invalid IPv4 address.' }
$manifest = Get-Content -LiteralPath $ReleaseFile -Raw | ConvertFrom-Json
if ($manifest.commit -notmatch '^[0-9a-f]{40}$') { throw 'Invalid pilot-release manifest.' }
$target = "ubuntu@$address"
$opts = @('-i',(Resolve-Path -LiteralPath $IdentityFile).Path,'-o','IdentitiesOnly=yes')
$remoteDir = (& ssh @opts $target 'umask 077 && mktemp -d').Trim()
if ($LASTEXITCODE -ne 0 -or $remoteDir -notmatch '^/tmp/tmp\.[A-Za-z0-9]+$') { throw 'Unable to create a private upload directory.' }
try {
    foreach ($pair in @(@($InputFile,'input.env'),@($ReleaseFile,'release.json'),@("$PSScriptRoot/first-install.sh",'install.sh'))) {
        & scp @opts (Resolve-Path -LiteralPath $pair[0]).Path "${target}:${remoteDir}/$($pair[1])"
        if ($LASTEXITCODE -ne 0) { throw 'Upload failed.' }
    }
    & ssh @opts $target "sudo -n bash $remoteDir/install.sh $remoteDir $($manifest.commit)"
    if ($LASTEXITCODE -ne 0) { throw 'Installation did not finish. The same input can be used to retry.' }
} finally {
    & ssh @opts $target "rm -f -- $remoteDir/input.env $remoteDir/release.json $remoteDir/install.sh && rmdir -- $remoteDir"
}
