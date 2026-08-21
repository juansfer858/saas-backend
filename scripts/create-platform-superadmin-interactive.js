const bcrypt = require('bcryptjs');
const { prisma } = require('../src/config/prisma');

function askVisible(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    let value = '';
    const onData = (chunk) => {
      const text = chunk.toString('utf8');
      const nl = text.indexOf('\n');
      if (nl >= 0) {
        value += text.slice(0, nl).replace(/\r/g, '');
        process.stdin.off('data', onData);
        resolve(value.trim());
      } else value += text.replace(/\r/g, '');
    };
    process.stdin.on('data', onData);
  });
}

function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('Se requiere una terminal interactiva TTY para capturar la contraseña de forma enmascarada.'));
      return;
    }
    process.stdout.write(prompt);
    let value = '';
    const wasRaw = Boolean(process.stdin.isRaw);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(wasRaw);
    };
    const onData = (chunk) => {
      const text = chunk.toString('utf8');
      for (const ch of text) {
        if (ch === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          reject(new Error('Cancelado por el usuario.'));
          return;
        }
        if (ch === '\r' || ch === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (ch >= ' ') {
          value += ch;
          process.stdout.write('*');
        }
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Ejecute este script con docker exec -it o una terminal TTY.');
  }

  console.log('VantixGC Platform — alta segura de Super-Administrador');
  console.log('La contraseña se captura enmascarada, se guarda solo como bcrypt y nunca se imprime.');
  console.log('');

  const name = await askVisible('Nombre de Master: ');
  const email = (await askVisible('Correo de Master: ')).toLowerCase();
  const password = await askHidden('Nueva contraseña (mínimo 12 caracteres): ');
  const confirm = await askHidden('Repita la contraseña: ');

  if (name.length < 2) throw new Error('Nombre inválido.');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Correo inválido.');
  if (password.length < 12) throw new Error('La contraseña debe tener al menos 12 caracteres.');
  if (password !== confirm) throw new Error('Las contraseñas no coinciden.');

  const existing = await prisma.platformSuperAdmin.findUnique({ where: { email } });
  if (existing) {
    const answer = (await askVisible(`Ya existe ${email}. Escriba ACTUALIZAR para reemplazar su contraseña y activarlo: `)).toUpperCase();
    if (answer !== 'ACTUALIZAR') {
      console.log('Sin cambios.');
      return;
    }
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.platformSuperAdmin.upsert({
    where: { email },
    create: { name, email, passwordHash, active: true },
    update: { name, passwordHash, active: true }
  });

  await prisma.platformAudit.create({
    data: {
      superAdminId: admin.id,
      action: existing ? 'PLATFORM_SUPERADMIN_CREDENTIAL_ROTATE' : 'PLATFORM_SUPERADMIN_CREATE',
      entity: 'PLATFORM_SUPERADMIN',
      entityId: admin.id,
      metadata: { email: admin.email, interactiveBootstrap: true }
    }
  });

  console.log('');
  console.log('PLATFORM SUPERADMIN READY');
  console.log(`ID: ${admin.id}`);
  console.log(`Nombre: ${admin.name}`);
  console.log(`Correo: ${admin.email}`);
  console.log('Estado: ACTIVO');
  console.log('Acceso: https://core.vantixgc.com/platform');
  console.log('La contraseña no se volverá a mostrar.');
}

main()
  .catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
