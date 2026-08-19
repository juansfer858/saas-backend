const { z } = require('zod');

const subdomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Subdominio inválido');

const registerTenantSchema = z.object({
  nit: z.string().trim().min(3).max(40).optional(),
  nombreEmpresa: z.string().trim().min(2).max(120),
  nicho: z.string().trim().min(2).max(80),
  subdomain: subdomainSchema,
  logoUrl: z.string().url().max(500).optional(),
  pais: z.string().trim().length(2).toUpperCase().default('CO'),
  moneda: z.string().trim().length(3).toUpperCase().default('COP'),
  admin: z.object({
    nombre: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(8).max(128)
  })
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128)
});

module.exports = {
  registerTenantSchema,
  loginSchema
};
