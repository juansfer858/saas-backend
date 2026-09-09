from pathlib import Path

p=Path('src/modules/restaurant/restaurant.service.js')
s=p.read_text()
s=s.replace("function applyWaiterTableVisibility(where, user) {\n  if (user?.rol === 'MESERO') {", "function applyWaiterTableVisibility(where, user, options = {}) {\n  if (user?.rol === 'MESERO' && !options.sharedFloor) {",1)
s=s.replace("async function listTables(tenantId, user = null) {\n  const where = applyWaiterTableVisibility({ tenantId, active: true }, user);", "async function listTables(tenantId, user = null, options = {}) {\n  const where = applyWaiterTableVisibility({ tenantId, active: true }, user, options);",1)
s=s.replace("function assertWaiterTableAccess(user, table) {\n  if (user?.rol === 'MESERO' && table.assignedWaiterId && table.assignedWaiterId !== user.id) {", "function assertWaiterTableAccess(user, table, options = {}) {\n  if (user?.rol === 'MESERO' && !options.sharedFloor && table.assignedWaiterId && table.assignedWaiterId !== user.id) {",1)
s=s.replace("async function openTable(tenantId, user, tableId, input = {}) {", "async function openTable(tenantId, user, tableId, input = {}, options = {}) {",1)
start=s.index("async function openTable(tenantId, user, tableId, input = {}, options = {}) {")
idx=s.index("    assertWaiterTableAccess(user, table);",start)
s=s[:idx]+"    assertWaiterTableAccess(user, table, options);"+s[idx+len("    assertWaiterTableAccess(user, table);"):]
s=s.replace("async function requestAccount(tenantId, user, tableId) {", "async function requestAccount(tenantId, user, tableId, options = {}) {",1)
start=s.index("async function requestAccount(tenantId, user, tableId, options = {}) {")
idx=s.index("    assertWaiterTableAccess(user, table);",start)
s=s[:idx]+"    assertWaiterTableAccess(user, table, options);"+s[idx+len("    assertWaiterTableAccess(user, table);"):]
p.write_text(s)

p=Path('src/modules/restaurant/restaurant-identity.service.js')
s=p.read_text()
s=s.replace("async function listTablesLive(tenantId, user) {\n  const tables = await base.listTables(tenantId, user);", "async function listTablesLive(tenantId, user, options = {}) {\n  const tables = await base.listTables(tenantId, user, options);",1)
s=s.replace("function assertWaiterSessionAccess(user, session) {\n  if (user?.rol === 'MESERO' && session?.table?.assignedWaiterId !== user.id) {", "function assertWaiterSessionAccess(user, session, options = {}) {\n  if (user?.rol === 'MESERO' && !options.sharedFloor && session?.table?.assignedWaiterId !== user.id) {",1)
old="""function normalizeSeatNumber(session, seatNumber) {
  if (session.billingMode !== 'INDIVIDUAL') return null;
  const seat = Number(seatNumber || 1);
  if (!Number.isInteger(seat) || seat < 1 || seat > Number(session.guestCount || 1)) {
    throw new AppError(400, 'La persona seleccionada no pertenece a esta mesa', 'RESTAURANT_SEAT_INVALID', {
      seatNumber: seat,
      guestCount: session.guestCount
    });
  }
  return seat;
}"""
new="""function normalizeSeatNumber(session, seatNumber, options = {}) {
  if (options.optionalSeat) {
    if (seatNumber === null || seatNumber === undefined || seatNumber === '') return null;
    const seat = Number(seatNumber);
    if (!Number.isInteger(seat) || seat < 1 || seat > Number(session.guestCount || 1)) {
      throw new AppError(400, 'La persona seleccionada no pertenece a esta mesa', 'RESTAURANT_SEAT_INVALID', { seatNumber: seat, guestCount: session.guestCount });
    }
    return seat;
  }
  if (session.billingMode !== 'INDIVIDUAL') return null;
  const seat = Number(seatNumber || 1);
  if (!Number.isInteger(seat) || seat < 1 || seat > Number(session.guestCount || 1)) {
    throw new AppError(400, 'La persona seleccionada no pertenece a esta mesa', 'RESTAURANT_SEAT_INVALID', {
      seatNumber: seat,
      guestCount: session.guestCount
    });
  }
  return seat;
}"""
assert old in s
s=s.replace(old,new,1)
s=s.replace("async function ensureDraftContext(tx, tenantId, user, sessionId, create = true) {", "async function ensureDraftContext(tx, tenantId, user, sessionId, create = true, options = {}) {",1)
start=s.index("async function ensureDraftContext")
idx=s.index("  assertWaiterSessionAccess(user, session);",start)
s=s[:idx]+"  assertWaiterSessionAccess(user, session, options);"+s[idx+len("  assertWaiterSessionAccess(user, session);"):]
s=s.replace("async function sessionServiceSummaryInTx(tx, tenantId, session) {", "async function sessionServiceSummaryInTx(tx, tenantId, session, options = {}) {",1)
s=s.replace("    if (session.billingMode === 'INDIVIDUAL' && Number.isInteger(seat) && seat >= 1 && seat <= guestCount) {", "    if ((session.billingMode === 'INDIVIDUAL' || options.optionalSeat) && Number.isInteger(seat) && seat >= 1 && seat <= guestCount) {",1)
s=s.replace("    } else if (session.billingMode === 'INDIVIDUAL') {", "    } else if (session.billingMode === 'INDIVIDUAL' || options.optionalSeat) {",1)
s=s.replace("async function getWaiterDraft(tenantId, user, sessionId) {\n  return prisma.$transaction(async (tx) => {\n    const ctx = await ensureDraftContext(tx, tenantId, user, sessionId, false);\n    const service = await sessionServiceSummaryInTx(tx, tenantId, ctx.session);", "async function getWaiterDraft(tenantId, user, sessionId, options = {}) {\n  return prisma.$transaction(async (tx) => {\n    const ctx = await ensureDraftContext(tx, tenantId, user, sessionId, false, options);\n    const service = await sessionServiceSummaryInTx(tx, tenantId, ctx.session, options);",1)
s=s.replace("async function updateTableServiceSetup(tenantId, user, sessionId, input) {", "async function updateTableServiceSetup(tenantId, user, sessionId, input, options = {}) {",1)
start=s.index("async function updateTableServiceSetup")
idx=s.index("    assertWaiterSessionAccess(user, session);",start)
s=s[:idx]+"    assertWaiterSessionAccess(user, session, options);"+s[idx+len("    assertWaiterSessionAccess(user, session);"):]
idx=s.index("    const service = await sessionServiceSummaryInTx(tx, tenantId, updated);",start)
s=s[:idx]+"    const service = await sessionServiceSummaryInTx(tx, tenantId, updated, options);"+s[idx+len("    const service = await sessionServiceSummaryInTx(tx, tenantId, updated);"):]
s=s.replace("async function setWaiterDraftItem(tenantId, user, sessionId, menuItemId, quantity, seatNumber = null) {\n  return prisma.$transaction(async (tx) => {\n    const ctx = await ensureDraftContext(tx, tenantId, user, sessionId, true);\n    const seat = normalizeSeatNumber(ctx.session, seatNumber);", "async function setWaiterDraftItem(tenantId, user, sessionId, menuItemId, quantity, seatNumber = null, options = {}) {\n  return prisma.$transaction(async (tx) => {\n    const ctx = await ensureDraftContext(tx, tenantId, user, sessionId, true, options);\n    const seat = normalizeSeatNumber(ctx.session, seatNumber, options);",1)
s=s.replace("async function updateOrderItemMeta(tenantId, user, sessionId, itemId, input) {", "async function updateOrderItemMeta(tenantId, user, sessionId, itemId, input, options = {}) {",1)
start=s.index("async function updateOrderItemMeta")
idx=s.index("    assertWaiterSessionAccess(user, session);",start)
s=s[:idx]+"    assertWaiterSessionAccess(user, session, options);"+s[idx+len("    assertWaiterSessionAccess(user, session);"):]
s=s.replace("data.seatNumber = normalizeSeatNumber(session, input.seatNumber);", "data.seatNumber = normalizeSeatNumber(session, input.seatNumber, options);",1)
idx=s.index("    const service = await sessionServiceSummaryInTx(tx, tenantId, session);",start)
s=s[:idx]+"    const service = await sessionServiceSummaryInTx(tx, tenantId, session, options);"+s[idx+len("    const service = await sessionServiceSummaryInTx(tx, tenantId, session);"):]
s=s.replace("async function sendWaiterDraft(tenantId, user, sessionId) {\n  return prisma.$transaction(async (tx) => {\n    const ctx = await ensureDraftContext(tx, tenantId, user, sessionId, false);", "async function sendWaiterDraft(tenantId, user, sessionId, options = {}) {\n  return prisma.$transaction(async (tx) => {\n    const ctx = await ensureDraftContext(tx, tenantId, user, sessionId, false, options);",1)
p.write_text(s)
