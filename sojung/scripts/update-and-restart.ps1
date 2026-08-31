<#
  코드 수정 후 서버 PC에 반영할 때 사용. 최신 코드로 다시 빌드하고
  sojung 서비스를 재시작한다. 관리자 권한 PowerShell에서 실행할 것.

  사용법: .\scripts\update-and-restart.ps1 -NssmPath "C:\nssm\nssm.exe"
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$NssmPath,
  [string]$ServiceName = "sojung"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

Push-Location $projectRoot
try {
  Write-Host "빌드 중..."
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build 실패 (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}

Write-Host "서비스를 재시작합니다..."
& $NssmPath restart $ServiceName
Write-Host "완료."
