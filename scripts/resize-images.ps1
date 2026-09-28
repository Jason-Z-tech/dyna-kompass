# Verkleinert alle PNG-Bilder aus -Source quadratisch auf -Size Pixel und speichert sie in -Target.
# Nutzt System.Drawing aus Windows, es muss nichts installiert werden.
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Target,
  [int]$Size = 256
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $Target | Out-Null

foreach ($file in Get-ChildItem -Path $Source -Filter *.png) {
  $out = Join-Path $Target $file.Name
  # Nur neu verkleinern, wenn das Original neuer ist.
  if ((Test-Path $out) -and ((Get-Item $out).LastWriteTime -ge $file.LastWriteTime)) { continue }

  $img = [System.Drawing.Image]::FromFile($file.FullName)
  try {
    $scale = [Math]::Min($Size / $img.Width, $Size / $img.Height)
    $w = [int]($img.Width * $scale)
    $h = [int]($img.Height * $scale)
    $bmp = New-Object System.Drawing.Bitmap $Size, $Size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.Clear([System.Drawing.Color]::Transparent)
      $g.DrawImage($img, [int](($Size - $w) / 2), [int](($Size - $h) / 2), $w, $h)
      $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $g.Dispose()
      $bmp.Dispose()
    }
  } finally {
    $img.Dispose()
  }
}
