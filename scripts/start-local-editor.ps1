param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$editorRoot = Split-Path -Parent $PSScriptRoot
$editorUrl = 'http://127.0.0.1:3000/'
$logRoot = Join-Path $editorRoot '.game-sync/launcher'
$mutex = New-Object System.Threading.Mutex($false, 'Local\MSWWebMapEditor3000')
$ownsMutex = $false

function Test-EditorReady {
    try {
        $page = Invoke-WebRequest -Uri $editorUrl -UseBasicParsing -TimeoutSec 3
        return $page.StatusCode -eq 200 -and $page.Content -match '<title>MSW .+?</title>'
    } catch { return $false }
}

function Test-PortBusy {
    $client = New-Object System.Net.Sockets.TcpClient
    try { $client.Connect('127.0.0.1', 3000); return $true }
    catch { return $false }
    finally { $client.Dispose() }
}

try {
    if (-not (Test-EditorReady)) {
        try { $ownsMutex = $mutex.WaitOne(0) }
        catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
        if ($ownsMutex -and -not (Test-PortBusy)) {
            $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
            if (-not (Test-Path -LiteralPath (Join-Path $editorRoot 'node_modules/next/package.json'))) {
                throw 'Dependencies are missing. Run npm install in the editor folder first.'
            }
            New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
            $runId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
            $outLog = Join-Path $logRoot ($runId + '.out.log')
            $errLog = Join-Path $logRoot ($runId + '.err.log')
            $server = Start-Process -FilePath $env:ComSpec -ArgumentList ('/d /s /c ""' + $npm + '" run dev -- --hostname 127.0.0.1 --port 3000"') -WorkingDirectory $editorRoot -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
            Set-Content -LiteralPath (Join-Path $logRoot 'server.pid') -Value $server.Id
        }
        $deadline = (Get-Date).AddSeconds(90)
        do {
            if (Test-EditorReady) { break }
            if ($server) { $server.Refresh(); if ($server.HasExited) { throw "Server exited. See logs: $logRoot" } }
            if ((Get-Date) -ge $deadline) { throw "Editor did not start on port 3000. See logs: $logRoot" }
            Start-Sleep -Milliseconds 500
        } while ($true)
    }
    if (-not $NoBrowser) { Start-Process $editorUrl }
    Write-Output "Editor ready: $editorUrl"
} catch {
    if ($NoBrowser) { Write-Error $_; exit 1 }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Map editor launcher', 'OK', 'Error') | Out-Null
    exit 1
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
