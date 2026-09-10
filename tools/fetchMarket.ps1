# 不動産情報ライブラリ XIT001 から対象エリアの取引データを取得し、cache/ へ年ごとに保存します。
# 併せて、年ごとの中古マンション成約㎡単価の中央値を報告します（採用年の判断材料）。
#
# 使い方:
#   .\tools\fetchMarket.ps1 -KeyPath <APIキーのファイルパス> -Years 2021,2022,2023,2024,2025
#
# 既に cache\raw_<year>.csv がある年は、そのままではフェッチをスキップします（-Force で上書き取得）。
# これは1回の実行を1年ずつに分割し、複数回の実行にまたがって作業を進められるようにするためです。
#
# 規約: 呼び出しは連続実行せず、間隔を空けます（利用規約 FAQ Q.3）。
# APIキーはリポジトリに含めません。パスは必ず引数で渡してください。

param(
  [Parameter(Mandatory = $true)][string]$KeyPath,
  [Parameter(Mandatory = $true)][int[]]$Years,
  [int]$WaitMs = 1500,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$Base     = "https://www.reinfolib.mlit.go.jp/ex-api/external"
$Root     = Split-Path -Parent $PSScriptRoot
$CacheDir = Join-Path $Root "cache"
New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null

if (-not (Test-Path -LiteralPath $KeyPath)) { throw "APIキーのファイルがありません: $KeyPath" }
$ApiKey = (Get-Content -LiteralPath $KeyPath -Raw).Trim()
if ($ApiKey -eq "") { throw "APIキーが空です。" }

Add-Type -AssemblyName System.Net.Http
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
$client = New-Object System.Net.Http.HttpClient($handler)
$client.Timeout = [TimeSpan]::FromSeconds(60)
$client.DefaultRequestHeaders.Add("Ocp-Apim-Subscription-Key", $ApiKey)

function Invoke-Reinfolib {
  param([string]$Path, [string]$Query)
  $resp = $client.GetAsync("$Base/$Path`?$Query").Result
  $body = $resp.Content.ReadAsStringAsync().Result
  if (-not $resp.IsSuccessStatusCode) {
    return [pscustomobject]@{ ok = $false; code = [int]$resp.StatusCode }
  }
  return [pscustomobject]@{ ok = $true; json = ($body | ConvertFrom-Json) }
}

# 東京23区（13101-13123）、千葉7市、さいたま市10区、戸田市
$CityCodes = @()
$CityCodes += 13101..13123
$CityCodes += @(12203, 12204, 12207, 12220, 12221, 12224, 12227)  # 市川 船橋 松戸 流山 八千代 鎌ケ谷 浦安
$CityCodes += 11101..11110                                        # さいたま市10区
$CityCodes += @(11224)                                            # 戸田市

foreach ($year in $Years) {
  $out = Join-Path $CacheDir ("raw_{0}.csv" -f $year)

  if ((Test-Path -LiteralPath $out) -and -not $Force) {
    Write-Output ("{0}年: cache\raw_{0}.csv が既に存在するためフェッチをスキップしました（-Force で再取得）" -f $year)
    continue
  }

  $rows = @()
  $consecutiveFailures = 0
  foreach ($code in $CityCodes) {
    $r = Invoke-Reinfolib -Path "XIT001" -Query "year=$year&city=$code"
    if ($r.ok) {
      $consecutiveFailures = 0
      $d = @($r.json.data)
      Write-Output ("  {0} {1} : {2} 件" -f $year, $code, $d.Count)
      foreach ($x in $d) { $rows += $x }
    } else {
      $consecutiveFailures++
      Write-Output ("  {0} {1} : 失敗 HTTP {2}" -f $year, $code, $r.code)
      if ($consecutiveFailures -ge 5) {
        throw ("連続 {0} 回失敗したため中断しました（最終: {1} 年 city={2} HTTP {3}）" -f $consecutiveFailures, $year, $code, $r.code)
      }
    }
    Start-Sleep -Milliseconds $WaitMs
  }
  $rows | Export-Csv -LiteralPath $out -NoTypeInformation -Encoding UTF8
  Write-Output ("{0}年: {1} 件を {2} へ保存しました" -f $year, $rows.Count, $out)
}

# 年ごとの中央値を報告します（採用年の判断材料）。cache にある年はすべて対象です。
Write-Output ""
Write-Output "=== 年ごとの中古マンション成約㎡単価の中央値 ==="
foreach ($year in $Years) {
  $path = Join-Path $CacheDir ("raw_{0}.csv" -f $year)
  if (-not (Test-Path -LiteralPath $path)) { continue }
  $vals = Import-Csv -LiteralPath $path |
    Where-Object { $_.Type -eq "中古マンション等" -and $_.PriceCategory -like "*成約*" -and [double]$_.TradePrice -gt 0 -and [double]$_.Area -gt 0 } |
    ForEach-Object { [double]$_.TradePrice / [double]$_.Area }
  $sorted = $vals | Sort-Object
  if ($sorted.Count -eq 0) { Write-Output ("{0}年: 該当なし" -f $year); continue }
  $m = $sorted.Count
  if ($m % 2 -eq 1) { $med = $sorted[[int](($m - 1) / 2)] }
  else { $med = ($sorted[[int]($m / 2 - 1)] + $sorted[[int]($m / 2)]) / 2 }
  Write-Output ("{0}年: n={1}  中央値 {2:N1} 万円/㎡" -f $year, $m, ($med / 10000))
}
