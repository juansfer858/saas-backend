'use strict';

const { spawnSync } = require('node:child_process');

const REQUIRED = ['tesseract', 'pdftotext', 'pdftoppm'];

function exists(command) {
  const result = spawnSync('sh', ['-lc', `command -v ${command}`], {
    encoding: 'utf8',
    stdio: 'ignore',
    timeout: 5000
  });
  return result.status === 0;
}

function missing() {
  return REQUIRED.filter((command) => !exists(command));
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'inherit',
    timeout: 180000
  });
  if (result.error || result.status !== 0) {
    const error = result.error ? result.error.message : `exit ${result.status}`;
    throw new Error(`${label} falló (${error})`);
  }
}

function main() {
  let absent = missing();
  if (!absent.length) {
    console.log('RESTAURANT_LOCAL_OCR_RUNTIME_ALREADY_READY');
    return;
  }

  if (process.platform !== 'linux') {
    console.log(`RESTAURANT_LOCAL_OCR_RUNTIME_BUILD_SKIP platform=${process.platform} missing=${absent.join(',')}`);
    return;
  }

  // GitHub instala y valida estas herramientas de forma explícita en el OCR CI.
  // No hacemos apt-get desde el runner compartido.
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log(`RESTAURANT_LOCAL_OCR_RUNTIME_BUILD_CI_SKIP missing=${absent.join(',')}`);
    return;
  }

  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (uid !== 0) {
    throw new Error(`OCR local incompleto (${absent.join(',')}) y el proceso de build no tiene permisos root para instalarlo`);
  }

  if (exists('apt-get')) {
    console.log(`RESTAURANT_LOCAL_OCR_RUNTIME_APT_INSTALL missing=${absent.join(',')}`);
    run('apt-get', ['update', '-qq'], 'apt-get update');
    run('apt-get', [
      'install', '-y', '--no-install-recommends',
      'tesseract-ocr', 'tesseract-ocr-spa', 'poppler-utils'
    ], 'apt-get install OCR');
  } else if (exists('nix-env')) {
    console.log(`RESTAURANT_LOCAL_OCR_RUNTIME_NIX_INSTALL missing=${absent.join(',')}`);
    run('nix-env', ['-iA', 'nixpkgs.tesseract', 'nixpkgs.poppler_utils'], 'nix-env install OCR');
  } else {
    throw new Error(`OCR local incompleto (${absent.join(',')}) y no existe apt-get ni nix-env en la imagen de build`);
  }

  absent = missing();
  if (absent.length) {
    throw new Error(`El build terminó sin los binarios OCR requeridos: ${absent.join(',')}`);
  }
  console.log('RESTAURANT_LOCAL_OCR_RUNTIME_INSTALLED');
}

try {
  main();
} catch (error) {
  console.error(`RESTAURANT_LOCAL_OCR_RUNTIME_BUILD_ERROR: ${error.message}`);
  process.exit(1);
}
