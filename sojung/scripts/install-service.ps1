<#
  sojung을 Windows 서비스로 등록해 서버 PC 재부팅/정전 복귀 시 자동으로
  다시 시작되도록 한다. 관리자 권한 PowerShell에서 실행할 것.

  사전 준비: https://nssm.cc/download 에서 win64용 nssm.exe를 받아
  아무 경로에나 둔다 (예: C:\nssm\nssm.exe).

  사용법:
    .\scripts\install-service.ps1 -NssmPath "C:\nssm\nssm.exe"
    .\scripts\install-service.ps1 -NssmPath "C:\nssm\nssm.exe" -Port 3000
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$NssmPath,
  [int]$Port = 3000,
  [string]$ServiceName = "sojung"
)

$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "관리자 권한 PowerShell에서 실행해야 합니다."
}
if (-not (Test-Path $NssmPath)) {
  throw "nssm.exe를 찾을 수 없습니다: $NssmPath"
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node).Source
$nextBin = Join-Path $projectRoot "node_modules\next\dist\bin\next"
$logDir = Join-Path $projectRoot "logs"

if (-not (Test-Path $nextBin)) {
  throw "next 실행 파일을 찾을 수 없습니다: $nextBin (npm install을 먼저 실행하세요)"
}
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Write-Host "프로덕션 빌드를 실행합니다..."
Push-Location $projectRoot
try {
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build 실패 (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}

$existing = & $NssmPath status $ServiceName 2>$null
if ($LASTEXITCODE -eq 0) {
  Write-Host "기존 서비스($ServiceName)를 제거하고 다시 등록합니다."
  & $NssmPath stop $ServiceName confirm | Out-Null
  & $NssmPath remove $ServiceName confirm | Out-Null
}

Write-Host "서비스를 등록합니다: $ServiceName"
& $NssmPath install $ServiceName $nodePath "`"$nextBin`" start -p $Port"
& $NssmPath set $ServiceName AppDirectory $projectRoot
& $NssmPath set $ServiceName DisplayName "Sojung 재고/거래처 관리 서버"
& $NssmPath set $ServiceName Description "sojung Next.js 프로덕션 서버 (LAN 접속용, 재부팅 시 자동 시작)"
& $NssmPath set $ServiceName Start SERVICE_AUTO_START
& $NssmPath set $ServiceName AppStdout (Join-Path $logDir "out.log")
& $NssmPath set $ServiceName AppStderr (Join-Path $logDir "error.log")
& $NssmPath set $ServiceName AppRotateFiles 1
& $NssmPath set $ServiceName AppRotateOnline 1
& $NssmPath set $ServiceName AppRotateBytes 10485760
& $NssmPath set $ServiceName AppRestartDelay 3000
& $NssmPath set $ServiceName AppExit Default Restart

Write-Host "서비스를 시작합니다..."
& $NssmPath start $ServiceName

Write-Host ""
Write-Host "완료. 상태 확인: nssm status $ServiceName"
Write-Host "로그 위치: $logDir"
Write-Host "다른 PC에서는 http://<이 PC의 LAN IP>:$Port 로 접속하면 됩니다."
