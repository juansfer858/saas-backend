@echo off
setlocal EnableExtensions

cd /d "%~dp0"

echo ============================================================
echo  VantixGC - LABORATORIO STRESS RESTAURANTE ^> CONTABILIDAD
echo ============================================================
echo.
echo IMPORTANTE: este laboratorio crea cientos de operaciones y NO debe
echo ejecutarse contra la base de datos de produccion.
echo.

if "%DATABASE_URL%"=="" (
  echo ERROR: DATABASE_URL no esta definida.
  echo Configure una PostgreSQL AISLADA de laboratorio y vuelva a ejecutar.
  exit /b 2
)

if "%STRESS_TABLES%"=="" set "STRESS_TABLES=96"
if "%STRESS_ROUNDS%"=="" set "STRESS_ROUNDS=3"
if "%STRESS_GUESTS%"=="" set "STRESS_GUESTS=4"
if "%STRESS_CONCURRENCY%"=="" set "STRESS_CONCURRENCY=32"
set "STRESS_CONFIRM_ISOLATED_DB=YES"
set "NODE_ENV=test"

echo Mesas:        %STRESS_TABLES%
echo Rondas:       %STRESS_ROUNDS%
echo Personas:     %STRESS_GUESTS%
echo Concurrencia: %STRESS_CONCURRENCY%
echo.

node scripts\restaurant-massive-stress.js
set "EXITCODE=%ERRORLEVEL%"

echo.
echo ============================================================
echo  INFORMES
echo ============================================================
echo JSON: stress-results\restaurant-massive-stress-report.json
echo MD:   stress-results\restaurant-massive-stress-report.md
echo.

if not "%EXITCODE%"=="0" (
  echo VEREDICTO: EL LABORATORIO DETECTO FALLAS. Revise el informe.
) else (
  echo VEREDICTO: LABORATORIO APROBADO.
)

exit /b %EXITCODE%
