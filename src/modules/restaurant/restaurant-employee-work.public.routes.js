'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const work = require('./restaurant-employee-work.service');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');
const restaurantUiPath = path.join(webRoot, 'restaurant-ui.js');
const runtimePath = path.join(webRoot, 'restaurant-employee-work-runtime.js');

// Se monta antes del public router histórico para ampliar el motor probado sin
// duplicar restaurant-ui.js ni cambiar las rutas usadas por la PWA del mesero.
router.get('/app/restaurant-ui.js', async (_req, res, next) => {
  try {
    const [base, runtime] = await Promise.all([
      fs.promises.readFile(restaurantUiPath, 'utf8'),
      fs.promises.readFile(runtimePath, 'utf8')
    ]);
    res.set('Cache-Control', 'no-store');
    res.type('application/javascript').send(`${base}\n;${runtime}`);
  } catch (error) { next(error); }
});

router.get('/api/public/restaurante/employee-work-readiness', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    ok:true,
    data:{
      marker:work.MARKER,
      mode:'FLEXIBLE',
      flexibleSupport:true,
      waiterScope:['ZONAS','MESAS'],
      productionScope:['COCINA','BARRA','POSTRES'],
      assignmentIsAuthorization:false
    }
  });
});

module.exports = { restaurantEmployeeWorkPublicRouter:router };
