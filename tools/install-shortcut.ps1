# Creates Start Menu + Desktop shortcuts that launch this browser from source,
# detached from any terminal.
#
# Deliberately NOT a packaged build: running from the source tree means code
# edits apply on the next launch and the chrome-UI hot reload still works, which
# is what you want while the design is still moving. Package it with
# electron-builder once it stops changing.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root     = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$iconPath = Join-Path $root 'tools\app.ico'

if (-not (Test-Path $electron)) { throw "electron.exe not found at $electron - run npm install first" }

# -- icon: the floating pill, which is the whole identity of the thing ---------
$size = 256
$bmp  = New-Object Drawing.Bitmap $size, $size
$g    = [Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([Drawing.Color]::Transparent)

# rounded "pill" rectangle
$x = 24; $y = 92; $w = 208; $h = 72; $r = $h / 2
$path = New-Object Drawing.Drawing2D.GraphicsPath
$path.AddArc($x, $y, $r * 2, $h, 90, 180)
$path.AddArc($x + $w - $r * 2, $y, $r * 2, $h, 270, 180)
$path.CloseFigure()
$g.FillPath((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(245, 14, 14, 18))), $path)
$g.DrawPath((New-Object Drawing.Pen ([Drawing.Color]::FromArgb(60, 255, 255, 255), 2)), $path)

# the shield dot, in the accent colour
$g.FillEllipse((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(255, 240, 101, 58))), 44, 112, 32, 32)
# two bars standing in for the address text
$grey = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(220, 237, 237, 242))
$g.FillRectangle($grey, 92, 118, 74, 9)
$g.FillRectangle((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(120, 237, 237, 242))), 92, 134, 46, 9)
$g.Dispose()

# Write a PNG-payload .ico (Vista+); keeps full alpha, unlike Icon.FromHandle.
$png = New-Object IO.MemoryStream
$bmp.Save($png, [Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $png.ToArray()
$ico = New-Object IO.MemoryStream
$bw  = New-Object IO.BinaryWriter $ico
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)   # ICONDIR
$bw.Write([Byte]0); $bw.Write([Byte]0)                             # 0 = 256px
$bw.Write([Byte]0); $bw.Write([Byte]0)
$bw.Write([UInt16]1); $bw.Write([UInt16]32)
$bw.Write([UInt32]$pngBytes.Length); $bw.Write([UInt32]22)
$bw.Write($pngBytes)
$bw.Flush()
[IO.File]::WriteAllBytes($iconPath, $ico.ToArray())
$bmp.Dispose()

# -- shortcuts ----------------------------------------------------------------
$shell = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Browser.lnk'),
  (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\Browser.lnk')
)

foreach ($lnk in $targets) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $lnk) | Out-Null
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath       = $electron
  $s.Arguments        = '"' + $root + '"'
  $s.WorkingDirectory = $root
  $s.IconLocation     = $iconPath
  $s.Description      = 'Custom browser - Ctrl+K for everything'
  $s.WindowStyle      = 7          # minimized; electron.exe shows no console anyway
  $s.Save()
  Write-Output "created $lnk"
}
