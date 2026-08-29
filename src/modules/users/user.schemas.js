const { z } = require('zod');

const USER_ROLES = [
  'SUPER_ADMIN', 'ADMIN', 'CAJERO', 'CONTADOR',
  'AUXILIAR', 'VENDEDOR', 'BODEGUERO',
  'MESERO', 'COCINA', 'BARRA', 'POSTRES'
];
const userRoleSchema = z.enum(USER_ROLES);

const userSchema = z.object({
  nombre: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(128),
  rol: userRoleSchema,
  activo: z.boolean().default(true)
});

const updateUserSchema = z.object({
  nombre: z.string().trim().min(2).max(100).optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  password: z.string().min(8).max(128).optional(),
  rol: userRoleSchema.optional(),
  activo: z.boolean().optional()
});

module.exports = { USER_ROLES, userRoleSchema, userSchema, updateUserSchema };
