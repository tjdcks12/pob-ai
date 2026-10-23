# Draws glyph atlas pages for the PoB window font (src/live/glyph-atlas.mjs). Reads one JSON
# request per line:
#   {id, mode:'atlas', fontDir, out, bold, px, em, baseline, glyphs:[{text, fonts:[family...]}]}
# and answers {id, w, h, glyphs:[[x, y, w, h, ox, oy, advance], ...]} or {id, error}.
# Each glyph is drawn white on transparent (PoB tints it) in a cell of the line height px with
# its baseline at `baseline`; (ox, oy) is the cell's top-left relative to the pen position and
# the line top. Pretendard is loaded from fontDir; other families are Windows fonts. GDI+ does
# not fall back per character, so each cluster takes the first family that has all its
# characters (checked with WPF's GlyphTypeface).
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName PresentationCore
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$script:pfc = $null
$coverage = @{}
$families = @{}
$fonts = @{}
$format = [System.Drawing.StringFormat]::GenericTypographic.Clone()
$format.FormatFlags = $format.FormatFlags -bor [System.Drawing.StringFormatFlags]::MeasureTrailingSpaces -bor [System.Drawing.StringFormatFlags]::NoClip

function Get-Family($name, $fontDir) {
  if ($families.ContainsKey($name)) { return $families[$name] }
  $family = $null
  try {
    if ($name -eq 'Pretendard') {
      if (-not $script:pfc) {
        $script:pfc = New-Object System.Drawing.Text.PrivateFontCollection
        $script:pfc.AddFontFile((Join-Path $fontDir 'Pretendard-Regular.ttf'))
        $script:pfc.AddFontFile((Join-Path $fontDir 'Pretendard-Bold.ttf'))
      }
      $family = $script:pfc.Families[0]
    } else {
      $family = New-Object System.Drawing.FontFamily $name
    }
  } catch { $family = $null }
  $families[$name] = $family
  return $family
}

function Get-Coverage($name, $bold, $fontDir) {
  $key = "$name|$bold"
  if ($coverage.ContainsKey($key)) { return $coverage[$key] }
  $gt = $null
  try {
    if ($name -eq 'Pretendard') {
      $file = if ($bold) { 'Pretendard-Bold.ttf' } else { 'Pretendard-Regular.ttf' }
      $gt = New-Object System.Windows.Media.GlyphTypeface (New-Object Uri (Join-Path $fontDir $file))
    } else {
      $weight = if ($bold) { [System.Windows.FontWeights]::Bold } else { [System.Windows.FontWeights]::Normal }
      $tf = New-Object System.Windows.Media.Typeface ((New-Object System.Windows.Media.FontFamily $name), [System.Windows.FontStyles]::Normal, $weight, [System.Windows.FontStretches]::Normal)
      $found = $null
      if ($tf.TryGetGlyphTypeface([ref]$found)) { $gt = $found }
    }
  } catch { $gt = $null }
  $coverage[$key] = $gt
  return $gt
}

function Get-Codepoints($text) {
  $list = New-Object System.Collections.Generic.List[int]
  for ($i = 0; $i -lt $text.Length; $i++) {
    if ([char]::IsHighSurrogate($text[$i]) -and $i + 1 -lt $text.Length) {
      $list.Add([char]::ConvertToUtf32($text[$i], $text[$i + 1])); $i++
    } else { $list.Add([int]$text[$i]) }
  }
  return ,$list
}

# Picks the family for one cluster and its advance in pixels.
function Select-Font($glyph, $req) {
  $cps = Get-Codepoints $glyph.text
  foreach ($name in $glyph.fonts) {
    $gt = Get-Coverage $name $req.bold $req.fontDir
    if (-not $gt) { continue }
    if (-not (Get-Family $name $req.fontDir)) { continue }
    $advance = 0.0
    $ok = $true
    foreach ($cp in $cps) {
      if ($cp -eq 0x200D -or ($cp -ge 0xFE00 -and $cp -le 0xFE0F)) { continue }
      $index = [uint16]0
      if (-not $gt.CharacterToGlyphMap.TryGetValue($cp, [ref]$index)) { $ok = $false; break }
      $advance += $gt.AdvanceWidths[$index] * $req.em
    }
    if ($ok) { return @{ name = $name; advance = $advance } }
  }
  # Nothing has it: Pretendard draws its missing-glyph box.
  return @{ name = 'Pretendard'; advance = $req.em * 0.6 }
}

function Get-Font($name, $req) {
  $key = "$name|$($req.bold)|$($req.em)"
  if (-not $fonts.ContainsKey($key)) {
    $style = if ($req.bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    $family = Get-Family $name $req.fontDir
    if (-not $family.IsStyleAvailable($style)) { $style = [System.Drawing.FontStyle]::Regular }
    $font = New-Object System.Drawing.Font($family, [float]$req.em, $style, [System.Drawing.GraphicsUnit]::Pixel)
    $ascent = $req.em * $family.GetCellAscent($style) / $family.GetEmHeight($style)
    $fonts[$key] = @{ font = $font; ascent = $ascent }
  }
  return $fonts[$key]
}

function Render-Atlas($req) {
  $px = [int]$req.px
  $pad = [int][Math]::Ceiling($px * 0.25) + 1
  $cellH = $px + 2 * $pad
  $maxW = 1024
  $cells = New-Object System.Collections.Generic.List[object]
  $x = 0; $y = 0; $pageW = 0
  foreach ($glyph in $req.glyphs) {
    $pick = Select-Font $glyph $req
    $w = [int][Math]::Ceiling($pick.advance) + 2 * $pad
    if ($x + $w -gt $maxW -and $x -gt 0) { $x = 0; $y += $cellH + 1 }
    $cells.Add(@{ text = $glyph.text; name = $pick.name; advance = $pick.advance; x = $x; y = $y; w = $w })
    $x += $w + 1
    if ($x -gt $pageW) { $pageW = $x }
  }
  $pageW = [Math]::Max(1, $pageW)
  $pageH = $y + $cellH
  $bmp = New-Object System.Drawing.Bitmap $pageW, $pageH, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $inv = [System.Globalization.CultureInfo]::InvariantCulture
  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($cell in $cells) {
    $f = Get-Font $cell.name $req
    $top = $cell.y + $pad + $req.baseline - $f.ascent
    $g.DrawString($cell.text, $f.font, [System.Drawing.Brushes]::White, [float]($cell.x + $pad), [float]$top, $format)
    $parts.Add(('[{0},{1},{2},{3},{4},{5},{6}]' -f $cell.x, $cell.y, $cell.w, $cellH, (-$pad), (-$pad), $cell.advance.ToString('0.###', $inv)))
  }
  $g.Dispose()
  $bmp.Save($req.out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  return ('{{"id":{0},"w":{1},"h":{2},"glyphs":[{3}]}}' -f $req.id, $pageW, $pageH, ($parts -join ','))
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  $req = $null
  try {
    $req = $line | ConvertFrom-Json
    if ($req.mode -ne 'atlas') { throw "Unknown mode $($req.mode)" }
    [Console]::Out.WriteLine((Render-Atlas $req))
  } catch {
    $id = if ($req) { $req.id } else { 0 }
    [Console]::Out.WriteLine((@{ id = $id; error = "$($_.Exception.Message)" } | ConvertTo-Json -Compress))
  }
  [Console]::Out.Flush()
}
