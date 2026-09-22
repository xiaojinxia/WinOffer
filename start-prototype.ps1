$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
# Compatibility entry for the former prototype shortcut.
node server/index.js --open
