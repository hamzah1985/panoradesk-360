// Points the "PanoraDesk 360" desktop shortcut at the latest unpacked build in
// release/win-unpacked, so launching it always runs the newest build without
// reinstalling. Windows only; safe to run repeatedly.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') process.exit(0);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = path.join(root, 'release', 'win-unpacked', 'PanoraDesk360.exe');

const script = `
$ErrorActionPreference = 'Stop'
$exe = $env:PD_EXE
$ws = New-Object -ComObject WScript.Shell
$dirs = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory')) | Select-Object -Unique
$updated = 0
foreach ($dir in $dirs) {
  $link = Join-Path $dir 'PanoraDesk 360.lnk'
  if (-not (Test-Path $link)) { continue }
  $s = $ws.CreateShortcut($link)
  $s.TargetPath = $exe
  $s.WorkingDirectory = Split-Path $exe
  $s.IconLocation = "$exe,0"
  $s.Save()
  Write-Output "Shortcut updated: $link -> $exe"
  $updated++
}
if ($updated -eq 0) { Write-Output 'No "PanoraDesk 360.lnk" found on the Desktop; nothing to update.' }
`;

const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
  stdio: 'inherit',
  env: { ...process.env, PD_EXE: exe },
});
process.exit(result.status ?? 0);
