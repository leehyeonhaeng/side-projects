<#
  install-service.ps1으로 등록한 sojung 서비스를 제거한다.
  사용법: .\scripts\uninstall-service.ps1 -NssmPath "C:\nssm\nssm.exe"
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$NssmPath,
  [string]$ServiceName = "sojung"
)

$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "관리자 권한 PowerShell에서 실행해야 합니다."
}

& $NssmPath stop $ServiceName confirm
& $NssmPath remove $ServiceName confirm
Write-Host "서비스($ServiceName)를 제거했습니다."
