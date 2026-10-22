# Renders text to transparent PNGs for the PoB window translation (PoB's bitmap fonts only have
# ASCII glyphs). Reads one JSON request per line: {id, text, height, bold, font, out}; answers
# {id, w, h} or {id, error}. White text, tinted by PoB when drawn.
Add-Type -AssemblyName System.Drawing
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$fonts = @{}
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  try {
    $req = $line | ConvertFrom-Json
    $style = if ($req.bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    $key = "$($req.font)|$($req.height)|$($req.bold)"
    if (-not $fonts.ContainsKey($key)) {
      $fonts[$key] = New-Object System.Drawing.Font($req.font, [float]($req.height * 0.74), $style, [System.Drawing.GraphicsUnit]::Pixel)
    }
    $font = $fonts[$key]
    $format = [System.Drawing.StringFormat]::GenericTypographic
    $format.FormatFlags = $format.FormatFlags -bor [System.Drawing.StringFormatFlags]::MeasureTrailingSpaces
    $probe = New-Object System.Drawing.Bitmap 1, 1
    $pg = [System.Drawing.Graphics]::FromImage($probe)
    $size = $pg.MeasureString($req.text, $font, 100000, $format)
    $pg.Dispose(); $probe.Dispose()
    $w = [Math]::Max(1, [int][Math]::Ceiling($size.Width) + 1)
    $h = [int]$req.height
    $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear([System.Drawing.Color]::Transparent)
    $top = [float](($h - $font.GetHeight()) / 2)
    $g.DrawString($req.text, $font, [System.Drawing.Brushes]::White, 0, $top, $format)
    $g.Dispose()
    $bmp.Save($req.out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    [Console]::Out.WriteLine((@{ id = $req.id; w = $w; h = $h } | ConvertTo-Json -Compress))
  } catch {
    [Console]::Out.WriteLine((@{ id = $req.id; error = "$($_.Exception.Message)" } | ConvertTo-Json -Compress))
  }
  [Console]::Out.Flush()
}
