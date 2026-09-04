'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function encodedPowerShell(script) {
  return Buffer.from(String(script), 'utf16le').toString('base64');
}

async function runPowerShell(script, env = {}, executor = execFileAsync) {
  if (process.platform !== 'win32' && executor === execFileAsync) {
    const error = new Error('La impresión Windows sólo está disponible en Edge sobre Windows');
    error.code = 'WINDOWS_PRINT_ONLY';
    throw error;
  }
  return executor('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedPowerShell(script)], {
    windowsHide: true,
    timeout: 12000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, ...env }
  });
}

async function listWindowsPrinters(executor = execFileAsync) {
  const script = `$ErrorActionPreference='Stop'\n$rows=Get-CimInstance Win32_Printer | Select-Object Name,Default,WorkOffline,PrinterStatus,PortName,DriverName\n@($rows) | ConvertTo-Json -Compress -Depth 3`;
  const { stdout = '' } = await runPowerShell(script, {}, executor);
  const trimmed = String(stdout).trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
    name: String(row.Name || '').trim(),
    default: Boolean(row.Default),
    workOffline: Boolean(row.WorkOffline),
    printerStatus: Number(row.PrinterStatus || 0),
    portName: row.PortName ? String(row.PortName) : null,
    driverName: row.DriverName ? String(row.DriverName) : null
  })).filter((row) => row.name);
}

const RAW_PRINT_SCRIPT = String.raw`$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class VantixRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOC_INFO_1 {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
  [DllImport("winspool.drv", EntryPoint="ClosePrinter", SetLastError=true)] public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern int StartDocPrinter(IntPtr hPrinter, int Level, [In] DOC_INFO_1 pDocInfo);
  [DllImport("winspool.drv", EntryPoint="EndDocPrinter", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="StartPagePrinter", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="EndPagePrinter", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="WritePrinter", SetLastError=true)] public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
}
'@
$name=$env:VANTIX_PRINTER_NAME
$file=$env:VANTIX_RAW_FILE
if([string]::IsNullOrWhiteSpace($name)){ throw 'Nombre de impresora requerido' }
if(-not (Test-Path -LiteralPath $file)){ throw 'Archivo RAW no encontrado' }
$bytes=[IO.File]::ReadAllBytes($file)
$h=[IntPtr]::Zero
$docStarted=$false
$pageStarted=$false
$mem=[IntPtr]::Zero
try {
  if(-not [VantixRawPrinter]::OpenPrinter($name,[ref]$h,[IntPtr]::Zero)){ throw "OpenPrinter falló: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  $doc=New-Object VantixRawPrinter+DOC_INFO_1
  $doc.pDocName='VantixGC Comanda'
  $doc.pDataType='RAW'
  if([VantixRawPrinter]::StartDocPrinter($h,1,$doc) -le 0){ throw "StartDocPrinter falló: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  $docStarted=$true
  if(-not [VantixRawPrinter]::StartPagePrinter($h)){ throw "StartPagePrinter falló: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  $pageStarted=$true
  $mem=[Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  [Runtime.InteropServices.Marshal]::Copy($bytes,0,$mem,$bytes.Length)
  $written=0
  if(-not [VantixRawPrinter]::WritePrinter($h,$mem,$bytes.Length,[ref]$written)){ throw "WritePrinter falló: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  if($written -ne $bytes.Length){ throw "WritePrinter incompleto: $written/$($bytes.Length)" }
  Write-Output "{\"ok\":true,\"bytes\":$written}"
} finally {
  if($mem -ne [IntPtr]::Zero){ [Runtime.InteropServices.Marshal]::FreeHGlobal($mem) }
  if($pageStarted){ [void][VantixRawPrinter]::EndPagePrinter($h) }
  if($docStarted){ [void][VantixRawPrinter]::EndDocPrinter($h) }
  if($h -ne [IntPtr]::Zero){ [void][VantixRawPrinter]::ClosePrinter($h) }
}`;

async function sendWindowsRawPrint({ printerName, buffer, executor = execFileAsync }) {
  const name = String(printerName || '').trim();
  if (!name) throw Object.assign(new Error('Nombre de cola Windows requerido'), { code: 'WINDOWS_PRINTER_NAME_REQUIRED' });
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw Object.assign(new Error('Buffer de impresión vacío'), { code: 'WINDOWS_PRINT_BUFFER_REQUIRED' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantixgc-print-'));
  const file = path.join(dir, 'job.raw');
  try {
    fs.writeFileSync(file, buffer);
    const { stdout = '' } = await runPowerShell(RAW_PRINT_SCRIPT, { VANTIX_PRINTER_NAME: name, VANTIX_RAW_FILE: file }, executor);
    return { ok: true, transport: 'WINDOWS', printerName: name, bytes: buffer.length, response: String(stdout).trim() || null };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

module.exports = { encodedPowerShell, runPowerShell, listWindowsPrinters, sendWindowsRawPrint, RAW_PRINT_SCRIPT };
