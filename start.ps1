$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Please install Node.js 24.14 or a later Node.js 24 release first.'
    Read-Host 'Press Enter to close'
    exit 1
}
if (-not (Test-Path -LiteralPath 'node_modules/imapflow/package.json')) {
    npm ci
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
node server/index.js --open
