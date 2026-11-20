# Резервная копия и проверка восстановления для локальной/Windows-установки PostgreSQL.
# Использование:
#   $env:PGPASSWORD = '...'; .\infra\backup\backup-local.ps1 -Database booking_dev -User booking_app [-VerifyRestore]
param(
  [string]$Database = 'booking_dev',
  [string]$User = 'booking_app',
  [string]$PgHost = 'localhost',
  [string]$OutDir = 'backups',
  [string]$PgBin = 'C:\Program Files\PostgreSQL\17\bin',
  [switch]$VerifyRestore
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $OutDir | Out-Null
$ts = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$file = Join-Path $OutDir "$Database-$ts.dump"
& "$PgBin\pg_dump.exe" -h $PgHost -U $User --format=custom --compress=9 --no-owner --file=$file $Database
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
& "$PgBin\pg_restore.exe" --list $file | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'backup archive is unreadable' }
(Get-FileHash $file -Algorithm SHA256).Hash | Out-File "$file.sha256" -Encoding ascii
Write-Output "backup ok: $file"

if ($VerifyRestore) {
  $target = "restore_check_$($ts.ToLower())"
  & "$PgBin\createdb.exe" -h $PgHost -U $User $target
  & "$PgBin\pg_restore.exe" -h $PgHost -U $User --no-owner --exit-on-error --dbname=$target $file
  if ($LASTEXITCODE -ne 0) { throw 'restore failed' }
  $q = 'SELECT (SELECT count(*) FROM organizations) AS orgs, (SELECT count(*) FROM appointments) AS appointments, (SELECT count(*) FROM _prisma_migrations) AS migrations;'
  & "$PgBin\psql.exe" -h $PgHost -U $User -d $target -c $q
  & "$PgBin\psql.exe" -h $PgHost -U $User -d $Database -c $q
  & "$PgBin\dropdb.exe" -h $PgHost -U $User $target
  Write-Output "restore verified into temporary database $target (dropped)"
}
