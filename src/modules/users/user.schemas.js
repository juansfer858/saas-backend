const { z } = require('zod');

const userSchema = z.object({
  nombre: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(128),
  rol: z.enum(['SUPER_ADMIN', 'ADMIN', 'CAJERO', 'CONTADOR']),
  activo: z.boolean().default(true)
});

const updateUserSchema = z.object({
  nombre: z.string().trim().min(2).max(100).optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  password: z.string().min(8).max(128).optional(),
  rol: z.enum(['SUPER_ADMIN', 'ADMIN', 'CAJERO', 'CONTADOR']).optional(),
  activo: z.boolean().optional()
});

module.exports = { userSchema, updateUserSchema };
