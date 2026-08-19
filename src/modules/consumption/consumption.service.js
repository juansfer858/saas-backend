const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { decimal, money, qty } = require('../../utils/decimal');
const inventory = require('../inventory/inventory.service');
const accounting = require('../accounting/accounting.service');

function normalizeItems(items) {
  const merged = new Map();
  for (const item of items || []) {
    const ingredientProductId = String(item.ingredientProductId || '').trim();
    const quantity = qty(item.quantity);
    if (!ingredientProductId || quantity.lte(0)) {
      throw new AppError(400, 'Cada insumo requiere producto y cantidad mayor que cero', 'CONSUMPTION_RECIPE_ITEM_INVALID');
    }
    const current = merged.get(ingredientProductId) || { ingredientProductId, quantity: decimal(0), unitLabel: item.unitLabel || null };
    current.quantity = current.quantity.plus(quantity).toDecimalPlaces(6);
    merged.set(ingredientProductId, current);
  }
  if (!merged.size) throw new AppError(400, 'La receta requiere al menos un insumo', 'CONSUMPTION_RECIPE_EMPTY');
  return [...merged.values()];
}

async function validateProducts(client, tenantId, outputProductId, items) {
  const ids = [...new Set([outputProductId, ...items.map((x) => x.ingredientProductId)].filter(Boolean))];
  const products = await client.producto.findMany({ where: { tenantId, id: { in: ids }, activo: true } });
  if (products.length !== ids.length) throw new AppError(400, 'Uno o más productos de la receta no existen o están inactivos', 'CONSUMPTION_PRODUCT_INVALID');
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const item of items) {
    const ingredient = byId.get(item.ingredientProductId);
    if (ingredient.tipo === 'SERVICIO' || !ingredient.controlaInventario) {
      throw new AppError(400, `El insumo ${ingredient.nombre} debe controlar inventario`, 'CONSUMPTION_INGREDIENT_NOT_STOCKED', { productoId: ingredient.id });
    }
  }
  return byId;
}

async function createRecipe(tenantId, input) {
  const items = normalizeItems(input.items);
  await validateProducts(prisma, tenantId, input.outputProductId || null, items);
  try {
    return await prisma.$transaction(async (tx) => {
      const recipe = await tx.consumptionRecipe.create({
        data: {
          tenantId,
          code: input.code.trim(),
          name: input.name.trim(),
          outputProductId: input.outputProductId || null,
          active: input.active !== false
        }
      });
      await tx.consumptionRecipeItem.createMany({
        data: items.map((item) => ({
          tenantId,
          recipeId: recipe.id,
          ingredientProductId: item.ingredientProductId,
          quantity: item.quantity,
          unitLabel: item.unitLabel || null
        }))
      });
      return tx.consumptionRecipe.findUnique({ where: { id: recipe.id }, include: { items: true } });
    });
  } catch (error) {
    if (error?.code === 'P2002') throw new AppError(409, 'Ya existe una receta con ese código o producto de salida', 'CONSUMPTION_RECIPE_DUPLICATE');
    throw error;
  }
}

async function updateRecipe(tenantId, id, input) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.consumptionRecipe.findFirst({ where: { id, tenantId }, include: { items: true } });
    if (!current) throw new AppError(404, 'Receta no encontrada', 'CONSUMPTION_RECIPE_NOT_FOUND');
    const items = input.items ? normalizeItems(input.items) : current.items.map((x) => ({ ingredientProductId: x.ingredientProductId, quantity: x.quantity, unitLabel: x.unitLabel }));
    const outputProductId = Object.prototype.hasOwnProperty.call(input, 'outputProductId') ? input.outputProductId : current.outputProductId;
    await validateProducts(tx, tenantId, outputProductId || null, items);
    await tx.consumptionRecipeItem.deleteMany({ where: { recipeId: id } });
    await tx.consumptionRecipe.update({
      where: { id },
      data: {
        code: input.code?.trim() || current.code,
        name: input.name?.trim() || current.name,
        outputProductId: outputProductId || null,
        active: input.active ?? current.active,
        version: { increment: 1 }
      }
    });
    await tx.consumptionRecipeItem.createMany({
      data: items.map((item) => ({ tenantId, recipeId: id, ingredientProductId: item.ingredientProductId, quantity: item.quantity, unitLabel: item.unitLabel || null }))
    });
    return tx.consumptionRecipe.findUnique({ where: { id }, include: { items: true } });
  });
}

async function listRecipes(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.active !== undefined) where.active = filters.active;
  if (filters.outputProductId) where.outputProductId = filters.outputProductId;
  return prisma.consumptionRecipe.findMany({ where, include: { items: true }, orderBy: { name: 'asc' }, take: Math.min(Number(filters.limit) || 200, 500) });
}

async function getRecipe(tenantId, id) {
  const recipe = await prisma.consumptionRecipe.findFirst({ where: { id, tenantId }, include: { items: true } });
  if (!recipe) throw new AppError(404, 'Receta no encontrada', 'CONSUMPTION_RECIPE_NOT_FOUND');
  return recipe;
}

function aggregateRecipeRequirements(recipes, saleDetails) {
  const recipeByOutput = new Map(recipes.map((recipe) => [recipe.outputProductId, recipe]));
  const requirements = new Map();
  const snapshot = [];
  for (const line of saleDetails || []) {
    const recipe = recipeByOutput.get(line.productoId);
    if (!recipe) continue;
    const saleQty = qty(line.cantidad);
    const snapshotItems = [];
    for (const item of recipe.items) {
      const requiredQty = qty(item.quantity).mul(saleQty).toDecimalPlaces(6);
      const existing = requirements.get(item.ingredientProductId) || decimal(0);
      requirements.set(item.ingredientProductId, existing.plus(requiredQty).toDecimalPlaces(6));
      snapshotItems.push({ ingredientProductId: item.ingredientProductId, recipeQuantity: String(item.quantity), requiredQuantity: String(requiredQty) });
    }
    snapshot.push({ recipeId: recipe.id, recipeCode: recipe.code, recipeVersion: recipe.version, outputProductId: recipe.outputProductId, saleQuantity: String(saleQty), items: snapshotItems });
  }
  return { requirements, snapshot };
}

async function consumeRequirementsInTx(tx, params) {
  const existing = await tx.consumptionRun.findFirst({ where: { tenantId: params.tenantId, sourceType: params.sourceType, sourceId: params.sourceId }, include: { items: true } });
  if (existing) return { run: existing, totalCost: money(existing.totalCost), idempotent: true };

  const ingredientIds = [...params.requirements.keys()];
  if (!ingredientIds.length) return { run: null, totalCost: money(0), idempotent: false };
  const ingredients = await tx.producto.findMany({ where: { tenantId: params.tenantId, id: { in: ingredientIds }, activo: true } });
  if (ingredients.length !== ingredientIds.length) throw new AppError(400, 'Uno o más insumos ya no están disponibles', 'CONSUMPTION_INGREDIENT_INVALID');
  const byId = new Map(ingredients.map((p) => [p.id, p]));
  for (const id of ingredientIds) {
    const p = byId.get(id);
    if (p.tipo === 'SERVICIO' || !p.controlaInventario) throw new AppError(400, `El insumo ${p.nombre} no controla inventario`, 'CONSUMPTION_INGREDIENT_NOT_STOCKED');
  }

  const run = await tx.consumptionRun.create({
    data: {
      tenantId: params.tenantId,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      reference: params.reference || null,
      state: 'COMPLETED',
      recipeSnapshot: params.recipeSnapshot || null,
      totalCost: 0
    }
  });

  let totalCost = money(0);
  for (const [ingredientProductId, quantity] of params.requirements.entries()) {
    const result = await inventory.applyMovement(tx, {
      tenantId: params.tenantId,
      productoId: ingredientProductId,
      comprobanteId: params.comprobanteId || null,
      tipo: 'VENTA',
      cantidad: quantity,
      referencia: params.reference || `CONSUMO-${params.sourceId}`
    });
    if (!result.movement) throw new AppError(409, 'Un insumo de receta no generó movimiento de inventario', 'CONSUMPTION_MOVEMENT_MISSING');
    totalCost = money(totalCost.plus(result.costOfMovement));
    await tx.consumptionRunItem.create({
      data: {
        tenantId: params.tenantId,
        runId: run.id,
        ingredientProductId,
        movementId: result.movement.id,
        quantity,
        unitCost: result.movement.costoUnitario,
        totalCost: result.costOfMovement
      }
    });
  }

  let accountingJournalId = null;
  if (params.postAccounting !== false && totalCost.gt(0)) {
    const cogs = await accounting.getMappedAccount(tx, params.tenantId, 'COSTO_VENTAS');
    const inventoryAccount = await accounting.getMappedAccount(tx, params.tenantId, 'INVENTARIO');
    const journal = await accounting.createJournalInTx(tx, {
      tenantId: params.tenantId,
      userId: params.userId,
      sourceId: `CONS-${params.sourceType}-${params.sourceId}`,
      fecha: params.fecha || new Date(),
      concepto: `Consumo/producción ${params.reference || params.sourceId}`,
      referencia: params.reference || params.sourceId,
      detalles: [
        { cuentaId: cogs.id, debito: totalCost, credito: 0, concepto: 'Costo de consumo/producción' },
        { cuentaId: inventoryAccount.id, debito: 0, credito: totalCost, concepto: 'Salida de inventario por consumo/producción' }
      ]
    });
    accountingJournalId = journal.id;
  }

  const updated = await tx.consumptionRun.update({ where: { id: run.id }, data: { totalCost, accountingJournalId } });
  return { run: { ...updated, items: await tx.consumptionRunItem.findMany({ where: { runId: run.id } }) }, totalCost, idempotent: false };
}

async function consumeRecipe(tenantId, userId, recipeId, input) {
  return prisma.$transaction(async (tx) => {
    const recipe = await tx.consumptionRecipe.findFirst({ where: { id: recipeId, tenantId, active: true }, include: { items: true } });
    if (!recipe) throw new AppError(404, 'Receta activa no encontrada', 'CONSUMPTION_RECIPE_NOT_FOUND');
    const multiple = qty(input.quantity || 1);
    if (multiple.lte(0)) throw new AppError(400, 'Cantidad inválida', 'CONSUMPTION_INVALID_QTY');
    const requirements = new Map(recipe.items.map((item) => [item.ingredientProductId, qty(item.quantity).mul(multiple).toDecimalPlaces(6)]));
    return consumeRequirementsInTx(tx, {
      tenantId,
      userId,
      sourceType: input.sourceType || 'MANUAL_CONSUMPTION',
      sourceId: input.sourceId,
      reference: input.reference || recipe.code,
      fecha: input.fecha || new Date(),
      requirements,
      recipeSnapshot: [{ recipeId: recipe.id, recipeCode: recipe.code, recipeVersion: recipe.version, quantity: String(multiple) }],
      postAccounting: true
    });
  });
}

async function consumeForSaleInTx(tx, params) {
  const productIds = [...new Set((params.saleDetails || []).map((line) => line.productoId).filter(Boolean))];
  if (!productIds.length) return { run: null, totalCost: money(0), recipeOutputProductIds: new Set() };
  const recipes = await tx.consumptionRecipe.findMany({ where: { tenantId: params.tenantId, active: true, outputProductId: { in: productIds } }, include: { items: true } });
  const recipeOutputProductIds = new Set(recipes.map((r) => r.outputProductId));
  const { requirements, snapshot } = aggregateRecipeRequirements(recipes, params.saleDetails);
  const consumed = await consumeRequirementsInTx(tx, {
    tenantId: params.tenantId,
    userId: params.userId,
    sourceType: 'SALE',
    sourceId: params.comprobante.id,
    comprobanteId: params.comprobante.id,
    reference: params.comprobante.numero,
    fecha: params.comprobante.fecha,
    requirements,
    recipeSnapshot: snapshot,
    postAccounting: false
  });
  return { ...consumed, recipeOutputProductIds };
}

async function getRunForSource(tenantId, sourceType, sourceId) {
  return prisma.consumptionRun.findFirst({ where: { tenantId, sourceType, sourceId }, include: { items: true } });
}

module.exports = {
  createRecipe,
  updateRecipe,
  listRecipes,
  getRecipe,
  consumeRecipe,
  consumeForSaleInTx,
  consumeRequirementsInTx,
  getRunForSource
};
