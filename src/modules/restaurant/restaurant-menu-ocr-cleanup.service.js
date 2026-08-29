'use strict';

const { prisma } = require('../../config/prisma');

const OCR_SKU_PREFIX = 'MENU-OCR-';

async function clearImportedOcr(tenantId) {
  const products = await prisma.producto.findMany({
    where: { tenantId, sku: { startsWith: OCR_SKU_PREFIX } },
    select: { id:true, activo:true }
  });
  const productIds = products.map((item) => item.id);
  if (!productIds.length) return { found:0, menuItemsHidden:0, productsDeactivated:0 };

  return prisma.$transaction(async (tx) => {
    const menu = await tx.restaurantMenuItem.updateMany({
      where: { tenantId, productId: { in:productIds }, active:true },
      data: { active:false }
    });
    const catalog = await tx.producto.updateMany({
      where: { tenantId, id: { in:productIds }, activo:true },
      data: { activo:false }
    });
    return {
      found: productIds.length,
      menuItemsHidden: Number(menu.count || 0),
      productsDeactivated: Number(catalog.count || 0)
    };
  });
}

module.exports = { OCR_SKU_PREFIX, clearImportedOcr };
