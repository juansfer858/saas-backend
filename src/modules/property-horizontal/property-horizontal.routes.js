const express = require('express');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { requireRoles } = require('../../middleware/require-role');

const router = express.Router();
const writeRoles = requireRoles('SUPER_ADMIN', 'ADMIN', 'AUXILIAR');

function money(value, field = 'valor') {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new AppError(400, `${field} no es válido`, 'PH_INVALID_AMOUNT');
  return n;
}

function dateOrNow(value) {
  if (!value) return new Date();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new AppError(400, 'Fecha no válida', 'PH_INVALID_DATE');
  return d;
}

async function propertyForTenant(tenantId) {
  return prisma.propiedadHorizontal.findUnique({ where: { tenantId } });
}

async function requireProperty(tenantId) {
  const property = await propertyForTenant(tenantId);
  if (!property) throw new AppError(409, 'Primero configura la propiedad horizontal', 'PH_PROPERTY_REQUIRED');
  return property;
}

router.get('/configuracion', async (req, res, next) => {
  try {
    const property = await propertyForTenant(req.tenantId);
    res.json({ ok: true, propiedad: property });
  } catch (error) { next(error); }
});

router.put('/configuracion', requireRoles('SUPER_ADMIN', 'ADMIN'), async (req, res, next) => {
  try {
    const nombre = String(req.body?.nombre || '').trim();
    if (!nombre) throw new AppError(400, 'El nombre de la propiedad es obligatorio', 'PH_PROPERTY_NAME_REQUIRED');
    const data = {
      nombre,
      nit: req.body?.nit ? String(req.body.nit).trim() : null,
      direccion: req.body?.direccion ? String(req.body.direccion).trim() : null,
      ciudad: req.body?.ciudad ? String(req.body.ciudad).trim() : null,
      activo: req.body?.activo !== false
    };
    const property = await prisma.propiedadHorizontal.upsert({
      where: { tenantId: req.tenantId },
      create: { tenantId: req.tenantId, ...data },
      update: data
    });
    res.json({ ok: true, propiedad: property });
  } catch (error) { next(error); }
});

router.get('/unidades', async (req, res, next) => {
  try {
    const property = await requireProperty(req.tenantId);
    const items = await prisma.unidadPH.findMany({
      where: { tenantId: req.tenantId, propiedadId: property.id, activo: req.query.incluirInactivas === '1' ? undefined : true },
      orderBy: [{ torre: 'asc' }, { codigo: 'asc' }]
    });
    res.json({ ok: true, items });
  } catch (error) { next(error); }
});

router.post('/unidades', writeRoles, async (req, res, next) => {
  try {
    const property = await requireProperty(req.tenantId);
    const codigo = String(req.body?.codigo || '').trim();
    if (!codigo) throw new AppError(400, 'El código del apartamento o unidad es obligatorio', 'PH_UNIT_CODE_REQUIRED');
    const item = await prisma.unidadPH.create({
      data: {
        tenantId: req.tenantId,
        propiedadId: property.id,
        codigo,
        torre: req.body?.torre ? String(req.body.torre).trim() : null,
        piso: req.body?.piso ? String(req.body.piso).trim() : null,
        tipo: req.body?.tipo || 'APARTAMENTO',
        responsableNombre: req.body?.responsableNombre ? String(req.body.responsableNombre).trim() : null,
        responsableEmail: req.body?.responsableEmail ? String(req.body.responsableEmail).trim().toLowerCase() : null,
        responsableTelefono: req.body?.responsableTelefono ? String(req.body.responsableTelefono).trim() : null,
        coeficiente: req.body?.coeficiente === '' || req.body?.coeficiente == null ? null : money(req.body.coeficiente, 'coeficiente'),
        cuotaBase: money(req.body?.cuotaBase || 0, 'cuotaBase'),
        activo: req.body?.activo !== false
      }
    });
    res.status(201).json({ ok: true, item });
  } catch (error) { next(error); }
});

router.patch('/unidades/:id', writeRoles, async (req, res, next) => {
  try {
    const current = await prisma.unidadPH.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!current) throw new AppError(404, 'Unidad no encontrada', 'PH_UNIT_NOT_FOUND');
    const data = {};
    for (const k of ['codigo','torre','piso','responsableNombre','responsableEmail','responsableTelefono']) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) data[k] = req.body[k] ? String(req.body[k]).trim() : null;
    }
    if (req.body?.tipo) data.tipo = req.body.tipo;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'coeficiente')) data.coeficiente = req.body.coeficiente === '' || req.body.coeficiente == null ? null : money(req.body.coeficiente, 'coeficiente');
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'cuotaBase')) data.cuotaBase = money(req.body.cuotaBase, 'cuotaBase');
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'activo')) data.activo = Boolean(req.body.activo);
    const item = await prisma.unidadPH.update({ where: { id: current.id }, data });
    res.json({ ok: true, item });
  } catch (error) { next(error); }
});

router.get('/cuotas', async (req, res, next) => {
  try {
    const property = await requireProperty(req.tenantId);
    const where = { tenantId: req.tenantId, propiedadId: property.id };
    if (req.query.periodo) where.periodo = String(req.query.periodo);
    if (req.query.unidadId) where.unidadId = String(req.query.unidadId);
    if (req.query.estado) where.estado = String(req.query.estado);
    const items = await prisma.cuotaPH.findMany({
      where,
      include: { unidad: { select: { id: true, codigo: true, torre: true, responsableNombre: true } } },
      orderBy: [{ periodo: 'desc' }, { fechaEmision: 'desc' }]
    });
    res.json({ ok: true, items });
  } catch (error) { next(error); }
});

router.post('/cuotas/generar', writeRoles, async (req, res, next) => {
  try {
    const property = await requireProperty(req.tenantId);
    const periodo = String(req.body?.periodo || '').trim();
    if (!/^\d{4}-\d{2}$/.test(periodo)) throw new AppError(400, 'Periodo debe tener formato AAAA-MM', 'PH_PERIOD_INVALID');
    const tipo = String(req.body?.tipo || 'ORDINARIA').trim().toUpperCase();
    const concepto = String(req.body?.concepto || (tipo === 'ORDINARIA' ? `Administración ${periodo}` : `Cuota ${tipo} ${periodo}`)).trim();
    const vencimiento = req.body?.fechaVencimiento ? dateOrNow(req.body.fechaVencimiento) : null;
    const units = await prisma.unidadPH.findMany({ where: { tenantId: req.tenantId, propiedadId: property.id, activo: true } });
    if (!units.length) throw new AppError(409, 'No hay unidades activas para generar cuotas', 'PH_NO_ACTIVE_UNITS');

    const created = await prisma.$transaction(async (tx) => {
      const result = [];
      for (const unit of units) {
        const existing = await tx.cuotaPH.findFirst({ where: { tenantId: req.tenantId, unidadId: unit.id, periodo, tipo, concepto } });
        if (existing) { result.push(existing); continue; }
        const value = req.body?.valorFijo != null ? money(req.body.valorFijo, 'valorFijo') : Number(unit.cuotaBase);
        const fee = await tx.cuotaPH.create({
          data: {
            tenantId: req.tenantId,
            propiedadId: property.id,
            unidadId: unit.id,
            periodo,
            tipo,
            concepto,
            valor: value,
            saldo: value,
            fechaVencimiento: vencimiento,
            creadoPorId: req.userId
          }
        });
        result.push(fee);
      }
      return result;
    });
    res.status(201).json({ ok: true, periodo, generadas: created.length, items: created });
  } catch (error) { next(error); }
});

router.get('/ingresos', async (req, res, next) => {
  try {
    const property = await requireProperty(req.tenantId);
    const items = await prisma.ingresoPH.findMany({
      where: { tenantId: req.tenantId, propiedadId: property.id },
      include: { unidad: { select: { codigo: true, torre: true } }, aplicaciones: true, creadoPor: { select: { nombre: true } } },
      orderBy: { fecha: 'desc' },
      take: Math.min(Number(req.query.limit) || 200, 500)
    });
    res.json({ ok: true, items });
  } catch (error) { next(error); }
});

router.post('/ingresos', writeRoles, async (req, res, next) => {
  try {
    const property = await requireProperty(req.tenantId);
    const value = money(req.body?.valor, 'valor');
    if (value <= 0) throw new AppError(400, 'El ingreso debe ser mayor que cero', 'PH_INCOME_ZERO');
    const concepto = String(req.body?.concepto || 'Ingreso').trim();
    const applications = Array.isArray(req.body?.aplicaciones) ? req.body.aplicaciones : [];
    const appliedTotal = applications.reduce((sum, x) => sum + money(x.valor, 'aplicación'), 0);
    if (appliedTotal > value + 0.0001) throw new AppError(400, 'Las aplicaciones superan el valor del ingreso', 'PH_APPLICATIONS_EXCEED_INCOME');

    const item = await prisma.$transaction(async (tx) => {
      const income = await tx.ingresoPH.create({
        data: {
          tenantId: req.tenantId,
          propiedadId: property.id,
          unidadId: req.body?.unidadId || null,
          concepto,
          valor: value,
          referencia: req.body?.referencia ? String(req.body.referencia).trim() : null,
          soporteUrl: req.body?.soporteUrl ? String(req.body.soporteUrl).trim() : null,
          fecha: dateOrNow(req.body?.fecha),
          creadoPorId: req.userId
        }
      });

      for (const application of applications) {
        const fee = await tx.cuotaPH.findFirst({ where: { id: String(application.cuotaId), tenantId: req.tenantId } });
        if (!fee) throw new AppError(404, 'Una cuota a aplicar no existe', 'PH_FEE_NOT_FOUND');
        const amount = money(application.valor, 'aplicación');
        if (amount <= 0 || amount > Number(fee.saldo) + 0.0001) throw new AppError(400, 'Aplicación inválida para la cuota', 'PH_APPLICATION_INVALID');
        const newBalance = Number(fee.saldo) - amount;
        await tx.aplicacionPagoPH.create({ data: { tenantId: req.tenantId, ingresoId: income.id, cuotaId: fee.id, valor: amount } });
        await tx.cuotaPH.update({
          where: { id: fee.id },
          data: { saldo: newBalance, estado: newBalance <= 0.0001 ? 'PAGADA' : 'PARCIAL' }
        });
      }

      const movement = await tx.movimientoPH.create({
        data: {
          tenantId: req.tenantId,
          propiedadId: property.id,
          tipo: 'INGRESO',
          concepto,
          valor: value,
          fecha: income.fecha,
          ingresoId: income.id,
          creadoPorId: req.userId
        }
      });
      return { ...income, movimientoId: movement.id };
    });

    res.status(201).json({ ok: true, item });
  } catch (error) { next(error); }
});

router.get('/gastos', async (req, res, next) => {
  try {
    const property = await requireProperty(req.tenantId);
    const items = await prisma.gastoPH.findMany({
      where: { tenantId: req.tenantId, propiedadId: property.id },
      include: { categoria: true, creadoPor: { select: { nombre: true } } },
      orderBy: { fecha: 'desc' },
      take: Math.min(Number(req.query.limit) || 200, 500)
    });
    res.json({ ok: true, items });
  } catch (error) { next(error); }
});

router.post('/gastos', writeRoles, async (req, res, next) => {
  try {
    const property = await requireProperty(req.tenantId);
    const value = money(req.body?.valor, 'valor');
    if (value <= 0) throw new AppError(400, 'El gasto debe ser mayor que cero', 'PH_EXPENSE_ZERO');
    const concepto = String(req.body?.concepto || '').trim();
    if (!concepto) throw new AppError(400, 'El concepto del gasto es obligatorio', 'PH_EXPENSE_CONCEPT_REQUIRED');

    const item = await prisma.$transaction(async (tx) => {
      if (req.body?.categoriaId) {
        const cat = await tx.categoriaGastoPH.findFirst({ where: { id: String(req.body.categoriaId), tenantId: req.tenantId } });
        if (!cat) throw new AppError(404, 'Categoría no encontrada', 'PH_CATEGORY_NOT_FOUND');
      }
      const expense = await tx.gastoPH.create({
        data: {
          tenantId: req.tenantId,
          propiedadId: property.id,
          categoriaId: req.body?.categoriaId || null,
          concepto,
          proveedor: req.body?.proveedor ? String(req.body.proveedor).trim() : null,
          valor: value,
          referencia: req.body?.referencia ? String(req.body.referencia).trim() : null,
          soporteUrl: req.body?.soporteUrl ? String(req.body.soporteUrl).trim() : null,
          fecha: dateOrNow(req.body?.fecha),
          creadoPorId: req.userId
        }
      });
      const movement = await tx.movimientoPH.create({
        data: {
          tenantId: req.tenantId,
          propiedadId: property.id,
          tipo: 'GASTO',
          concepto,
          valor: value,
          fecha: expense.fecha,
          gastoId: expense.id,
          creadoPorId: req.userId
        }
      });
      return { ...expense, movimientoId: movement.id };
    });
    res.status(201).json({ ok: true, item });
  } catch (error) { next(error); }
});

router.get('/categorias-gasto', async (req, res, next) => {
  try {
    const property = await requireProperty(req.tenantId);
    const items = await prisma.categoriaGastoPH.findMany({ where: { tenantId: req.tenantId, propiedadId: property.id, activo: true }, orderBy: { nombre: 'asc' } });
    res.json({ ok: true, items });
  } catch (error) { next(error); }
});

router.post('/categorias-gasto', writeRoles, async (req, res, next) => {
  try {
    const property = await requireProperty(req.tenantId);
    const nombre = String(req.body?.nombre || '').trim();
    if (!nombre) throw new AppError(400, 'El nombre es obligatorio', 'PH_CATEGORY_NAME_REQUIRED');
    const item = await prisma.categoriaGastoPH.create({ data: { tenantId: req.tenantId, propiedadId: property.id, nombre } });
    res.status(201).json({ ok: true, item });
  } catch (error) { next(error); }
});

router.get('/movimientos', async (req, res, next) => {
  try {
    const property = await requireProperty(req.tenantId);
    const items = await prisma.movimientoPH.findMany({
      where: { tenantId: req.tenantId, propiedadId: property.id },
      include: { creadoPor: { select: { nombre: true } } },
      orderBy: { fecha: 'desc' },
      take: Math.min(Number(req.query.limit) || 300, 1000)
    });
    res.json({ ok: true, items });
  } catch (error) { next(error); }
});

router.get('/resumen', async (req, res, next) => {
  try {
    const property = await requireProperty(req.tenantId);
    const now = new Date();
    const from = req.query.desde ? dateOrNow(req.query.desde) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = req.query.hasta ? dateOrNow(req.query.hasta) : new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [units, fees, incomes, expenses, latest] = await Promise.all([
      prisma.unidadPH.count({ where: { tenantId: req.tenantId, propiedadId: property.id, activo: true } }),
      prisma.cuotaPH.findMany({ where: { tenantId: req.tenantId, propiedadId: property.id, estado: { in: ['PENDIENTE','PARCIAL'] } }, select: { saldo: true, unidadId: true } }),
      prisma.ingresoPH.aggregate({ where: { tenantId: req.tenantId, propiedadId: property.id, fecha: { gte: from, lt: to } }, _sum: { valor: true } }),
      prisma.gastoPH.aggregate({ where: { tenantId: req.tenantId, propiedadId: property.id, fecha: { gte: from, lt: to } }, _sum: { valor: true } }),
      prisma.movimientoPH.findMany({ where: { tenantId: req.tenantId, propiedadId: property.id }, include: { creadoPor: { select: { nombre: true } } }, orderBy: { fecha: 'desc' }, take: 10 })
    ]);

    const ingresos = Number(incomes._sum.valor || 0);
    const gastos = Number(expenses._sum.valor || 0);
    const pendiente = fees.reduce((sum, x) => sum + Number(x.saldo), 0);
    const unidadesPendientes = new Set(fees.filter(x => Number(x.saldo) > 0).map(x => x.unidadId)).size;

    res.json({
      ok: true,
      propiedad: property,
      periodo: { desde: from, hasta: to },
      indicadores: {
        unidades: units,
        unidadesAlDia: Math.max(units - unidadesPendientes, 0),
        unidadesPendientes,
        ingresos,
        gastos,
        balancePeriodo: ingresos - gastos,
        cuotasPendientes: pendiente
      },
      ultimosMovimientos: latest
    });
  } catch (error) { next(error); }
});

module.exports = { propertyHorizontalRouter: router };
