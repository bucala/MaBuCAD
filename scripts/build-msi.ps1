<#
.SYNOPSIS
    Builds the MaBuCAD Windows installer(s) via `tauri build`.

.DESCRIPTION
    Wraps the `npm install` / `npm run typecheck` / `npm run tauri build` sequence
    documented in README.md into one command, so building an installer doesn't
    depend on remembering that order (or the `tauri build --bundles` flag syntax)
    every time.

.PARAMETER Target
    Which installer(s) to build: "msi", "nsis", or "all" (both — the default, and
    what `tauri.conf.json`'s own `bundle.targets` already lists).

.PARAMETER SkipChecks
    Skip `npm run typecheck` before building. Rust/Tauri does its own compile-time
    checking, but a `tsc` pass catches a frontend type error before spending time
    on a full native build, not after.

.PARAMETER SkipInstall
    Skip `npm install`. Only worth passing once `node_modules` is already known
    up to date — stale dependencies otherwise surface as a confusing bundling
    failure that's easy to blame on the wrong thing.

.PARAMETER Open
    Open the bundle output folder in Explorer once the build finishes.

.EXAMPLE
    .\scripts\build-msi.ps1
    Full build: install, typecheck, then both installers.

.EXAMPLE
    .\scripts\build-msi.ps1 -SkipChecks -SkipInstall
    Fastest rebuild once dependencies and types are already known-good.

.EXAMPLE
    .\scripts\build-msi.ps1 -Target all -Open
    Build both installers and open the output folder afterward.
#>
[CmdletBinding()]
param(
    [ValidateSet("msi", "nsis", "all")]
    [string]$Target = "all",

    [switch]$SkipChecks,
    [switch]$SkipInstall,
    [switch]$Open
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Resolved from this script's own location rather than assumed from the caller's
# current directory, so it works the same way regardless of where it's invoked from.
$RepoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $RepoRoot
try {
    if (-not $SkipInstall) {
        Write-Host "==> npm install" -ForegroundColor Cyan
        npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)" }
    }

    if (-not $SkipChecks) {
        Write-Host "==> npm run typecheck" -ForegroundColor Cyan
        npm run typecheck
        if ($LASTEXITCODE -ne 0) { throw "Typecheck failed (exit $LASTEXITCODE)" }
    }

    # Omitting --bundles entirely (the "all" case) falls back to tauri.conf.json's
    # own bundle.targets list, which is already ["msi", "nsis"] — no need to spell
    # both out here too.
    $bundleArgs = if ($Target -eq "all") { @() } else { @("--bundles", $Target) }

    Write-Host "==> npm run tauri build -- $($bundleArgs -join ' ')" -ForegroundColor Cyan
    npm run tauri build -- @bundleArgs
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed (exit $LASTEXITCODE)" }

    $bundleDir = Join-Path $RepoRoot "src-tauri\target\release\bundle"
    $installers = Get-ChildItem -Path $bundleDir -Recurse -Include "*.msi", "*.exe" -ErrorAction SilentlyContinue

    if ($installers) {
        Write-Host "`nBuilt installer(s):" -ForegroundColor Green
        $installers | ForEach-Object { Write-Host "  $($_.FullName)" }
    } else {
        Write-Warning "Build succeeded but no .msi/.exe was found under $bundleDir"
    }

    if ($Open -and (Test-Path $bundleDir)) {
        Invoke-Item $bundleDir
    }
}
finally {
    Pop-Location
}
