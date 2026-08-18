const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'SaaS Core API activa' });
});

app.post('/api/auth/register-tenant', async (req, res) => {
  try {
    const { nombreEmpresa, subdomain, nicho, nombreAdmin, emailAdmin, passwordAdmin } = req.body;
    
    const tenantExistente = await prisma.tenant.findUnique({ where: { subdomain } });
    if (tenantExistente) {
      return res.status(400).json({ error: 'El subdominio ya está registrado.' });
    }

    const hashedPassword = await bcrypt.hash(passwordAdmin, 10);

    const nuevoTenant = await prisma.tenant.create({
      data: {
        nombreEmpresa,
        subdomain,
        nicho,
        users: {
          create: {
            nombre: nombreAdmin,
            email: emailAdmin,
            password: hashedPassword,
            rol: 'ADMIN'
          }
        }
      },
      include: { users: true }
    });

    res.status(201).json({ message: 'Empresa registrada con éxito', tenant: nuevoTenant });
  } catch (error) {
    res.status(500).json({ error: 'Error al registrar empresa: ' + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
