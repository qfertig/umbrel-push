# Installs what is missing, builds the interface once, and starts Umbrel Push in your browser.
# Needs Python 3.11 or newer and Node 20 or newer. Pass --demo to try it without an Umbrel.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

python -c 'import yaml, ruamel.yaml' 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Installing Python packages...'
    python -m pip install --quiet "PyYAML>=6.0.2,<7" "ruamel.yaml>=0.18,<0.19"
    if ($LASTEXITCODE -ne 0) { throw 'Could not install the Python packages.' }
}

if (-not (Test-Path -LiteralPath 'web\dist\index.html')) {
    Write-Host 'Building the interface (first run only)...'
    Push-Location web
    try {
        npm install
        if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'npm run build failed.' }
    } finally {
        Pop-Location
    }
}

python -m server.main @args
