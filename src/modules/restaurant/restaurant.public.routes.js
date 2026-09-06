'use strict';

const express = require('express');
const { coreAdminPwaPublicRouter } = require('../platform/core-admin-pwa.public.routes');
const { platformEdgeRolloutPublicRouter } = require('./restaurant-edge-managed.public.routes');
