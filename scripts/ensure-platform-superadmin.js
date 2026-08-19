const { prisma } = require('../src/config/prisma');
const platform = require('../src/modules/platform/saas/platform.service');

async function main() {
  const email = process.env.PLATFORM_SUPERADMIN_EMAIL;
  const password = process.env.PLATFORM_SUPERADMIN_PASSWORD;
  const name = process.env.PLATFORM_SUPERADMIN_NAME || 'VantixGC Platform Admin';
  if (!email || !password) {
    console.log('PLATFORM SUPERADMIN SKIPPED: configure PLATFORM_SUPERADMIN_EMAIL and PLATFORM_SUPERADMIN_PASSWORD');
    return;
  }
  const admin = await platform.bootstrapSuperAdmin({ name, email, password });
  console.log(`PLATFORM SUPERADMIN READY ${JSON.stringify({ id: admin.id, email: admin.email, active: admin.active })}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
