require('dotenv').config();
const { prisma } = require('../src/config/prisma');
const techProvider = require('../src/modules/notifications/meta-tech-provider.service');

async function main() {
  const token = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
  if (!token) throw new Error('Defina META_SYSTEM_USER_ACCESS_TOKEN solo para esta ejecución. El script no imprime el token.');
  const expiresAt = process.env.META_SYSTEM_USER_TOKEN_EXPIRES_AT || null;
  const label = process.env.META_SYSTEM_USER_TOKEN_LABEL || 'META_TECH_PROVIDER_SYSTEM_USER';
  const result = await techProvider.saveSystemUserToken({ token, expiresAt, label, updatedBy: 'ONE_TIME_CLI' });
  console.log('META SYSTEM USER TOKEN STORED ENCRYPTED');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
