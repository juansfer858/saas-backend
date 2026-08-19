const express = require('express');
const controller = require('./user.controller');
const { requireRoles } = require('../../middleware/require-role');

const router = express.Router();

router.get('/', requireRoles('SUPER_ADMIN', 'ADMIN'), controller.listUsers);
router.post('/', requireRoles('SUPER_ADMIN', 'ADMIN'), controller.createUser);
router.patch('/:id', requireRoles('SUPER_ADMIN', 'ADMIN'), controller.updateUser);

module.exports = { userRouter: router };
