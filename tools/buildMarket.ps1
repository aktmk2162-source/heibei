# cache/raw_<Year>.csv から1暦年を集計し、src/data/market.json を生成します。
#
# 使い方:
#   .\tools\buildMarket.ps1 -Year 2024
#
# 出力は統計値のみで、個別の取引は1件も含みません。

# ★ MinSamples / EligibleMin / EligibleMax の既定値は src/constants.ts の
#   MIN_SAMPLES / ELIGIBLE_MIN / ELIGIBLE_MAX と一致させること（自動では同期されない）。
param(
  [Parameter(Mandatory = $true)][int]$Year,
  [int]$MinSamples = 8,
  [double]$EligibleMin = 200000,
  [double]$EligibleMax = 3500000
)

$ErrorActionPreference = "Stop"
$Root  = Split-Path -Parent $PSScriptRoot
$InCsv   = Join-Path $Root ("cache\raw_{0}.csv" -f $Year)
$OutPath = Join-Path $Root "src\data\market.json"
if (-not (Test-Path -LiteralPath $InCsv)) { throw "生データがありません: $InCsv。先に fetchMarket.ps1 を実行してください。" }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutPath) | Out-Null

function Get-YearBand([int]$y) {
  if ($y -lt 1981) { return "~1980" }
  if ($y -lt 1991) { return "1981-1990" }
  if ($y -lt 2001) { return "1991-2000" }
  if ($y -lt 2011) { return "2001-2010" }
  if ($y -lt 2021) { return "2011-2020" }
  return "2021-"
}

function Get-Median([double[]]$sorted) {
  $m = $sorted.Count
  if ($m % 2 -eq 1) { return $sorted[[int](($m - 1) / 2)] }
  return ($sorted[[int]($m / 2 - 1)] + $sorted[[int]($m / 2)]) / 2
}

# nearest-rank 方式。m>=4 なら q1 <= median <= q3 が必ず成り立ちます。
function Get-Quantile([double[]]$sorted, [double]$p) {
  $idx = [Math]::Ceiling($sorted.Count * $p) - 1
  if ($idx -lt 0) { $idx = 0 }
  if ($idx -ge $sorted.Count) { $idx = $sorted.Count - 1 }
  return $sorted[$idx]
}

# 注: 同数タイの場合は Group-Object の列挙順で決まります。この順序は
# PowerShell のバージョン間で保証されていません。
function Get-Mode([string[]]$values) {
  $best = ""; $bestCount = -1
  foreach ($g in ($values | Group-Object)) {
    if ($g.Count -gt $bestCount) { $bestCount = $g.Count; $best = [string]$g.Name }
  }
  return $best
}

$groups = @{}
Import-Csv -LiteralPath $InCsv | ForEach-Object {
  if ($_.Type -ne "中古マンション等") { return }
  if ($_.PriceCategory -notlike "*成約*") { return }
  if ([string]::IsNullOrWhiteSpace($_.DistrictName)) { return }
  if ([string]::IsNullOrWhiteSpace($_.BuildingYear)) { return }
  $price = 0.0; $area = 0.0
  if (-not [double]::TryParse($_.TradePrice, [ref]$price)) { return }
  if (-not [double]::TryParse($_.Area, [ref]$area)) { return }
  if ($price -le 0 -or $area -le 0) { return }
  $ym = [regex]::Match($_.BuildingYear, '(\d{4})')
  if (-not $ym.Success) { return }
  $by = [int]$ym.Groups[1].Value
  if ($by -lt 1900) { return }

  $band = Get-YearBand $by
  $key  = "{0}|{1}|{2}|{3}" -f $_.Prefecture, $_.Municipality, $_.DistrictName, $band
  if (-not $groups.ContainsKey($key)) {
    $groups[$key] = [pscustomobject]@{
      pref = $_.Prefecture; city = $_.Municipality; district = $_.DistrictName; yearBand = $band
      unitPrices = New-Object System.Collections.ArrayList
      areas      = New-Object System.Collections.ArrayList
      structures = New-Object System.Collections.ArrayList
      plannings  = New-Object System.Collections.ArrayList
    }
  }
  $g = $groups[$key]
  [void]$g.unitPrices.Add($price / $area)
  [void]$g.areas.Add($area)
  [void]$g.structures.Add([string]$_.Structure)
  [void]$g.plannings.Add([string]$_.CityPlanning)
}

$out = New-Object System.Collections.ArrayList
foreach ($key in $groups.Keys) {
  $g = $groups[$key]
  if ($g.unitPrices.Count -lt $MinSamples) { continue }
  $up = [double[]]($g.unitPrices.ToArray() | Sort-Object)
  $median = Get-Median $up
  if ($median -lt $EligibleMin -or $median -gt $EligibleMax) { continue }
  $ar = [double[]]($g.areas.ToArray() | Sort-Object)
  # 原データに値が無く最頻値が空文字になる場合は、推定で埋めず「不明」と記録します。
  $structureText = Get-Mode ([string[]]$g.structures.ToArray())
  if ([string]::IsNullOrWhiteSpace($structureText)) { $structureText = "不明" }
  $planningText = Get-Mode ([string[]]$g.plannings.ToArray())
  if ([string]::IsNullOrWhiteSpace($planningText)) { $planningText = "不明" }
  [void]$out.Add([pscustomobject]@{
    pref           = $g.pref
    city           = $g.city
    district       = $g.district
    yearBand       = $g.yearBand
    n              = $up.Count
    median         = [int][Math]::Round($median)
    q1             = [int][Math]::Round((Get-Quantile $up 0.25))
    q3             = [int][Math]::Round((Get-Quantile $up 0.75))
    areaMedian     = [int][Math]::Round((Get-Median $ar))
    structure      = $structureText
    cityPlanning   = $planningText
  })
}

$payload = [pscustomobject]@{
  sourceYear = $Year
  fetchedAt  = (Get-Date -Format "yyyy-MM-dd")
  groups     = @($out | Sort-Object pref, city, district, yearBand)
}
$json = $payload | ConvertTo-Json -Depth 5
# JSON はBOM無しUTF-8で書き出します（本スクリプト自体はBOM付きUTF-8のままでOKです。
# Windows PowerShell 5.1 の Set-Content -Encoding UTF8 はBOM付きで書き出してしまい、
# 素の JSON.parse がそれを読めないため）。
[System.IO.File]::WriteAllText($OutPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("{0} 群を {1} へ書き出しました（対象年 {2}）" -f $out.Count, $OutPath, $Year)

