const express = require('express');
const controller = require('./bike-agenda.controller');
const { requirePermission } = require('../../middleware/require-permission');

const router = express.Router();

router.get('/mecanicos', requirePermission('BIKE_AGENDA.VER'), controller.listMechanics);
router.get('/disponibilidad', requirePermission('BIKE_AGENDA.VER'), controller.findAvailability);

router.get('/reglas', requirePermission('BIKE_AGENDA.VER'), controller.listScheduleRules);
router.post('/reglas', requirePermission('BIKE_AGENDA.ADMINISTRAR'), controller.createScheduleRule);
router.delete('/reglas/:id', requirePermission('BIKE_AGENDA.ADMINISTRAR'), controller.deactivateScheduleRule);

router.get('/bloqueos', requirePermission('BIKE_AGENDA.VER'), controller.listScheduleBlocks);
router.post('/bloqueos', requirePermission('BIKE_AGENDA.ADMINISTRAR'), controller.createScheduleBlock);

router.get('/citas', requirePermission('BIKE_AGENDA.VER'), controller.listAppointments);
router.post('/citas', requirePermission('BIKE_AGENDA.CREAR'), controller.createAppointment);
router.post('/citas/:id/confirmar', requirePermission('BIKE_AGENDA.EDITAR'), controller.confirmAppointment);
router.post('/citas/:id/cancelar', requirePermission('BIKE_AGENDA.EDITAR'), controller.cancelAppointment);
router.post('/citas/:id/reprogramar', requirePermission('BIKE_AGENDA.EDITAR'), controller.rescheduleAppointment);
router.post('/citas/:id/convertir-ot', requirePermission('BIKE_TALLER.CREAR'), controller.convertAppointmentToWorkOrder);

module.exports = { bikeAgendaRouter: router };
