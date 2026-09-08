'use strict';

const crypto = require('node:crypto');
const { AppError } = require('../../utils/app-error');

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

function decodeServiceAccount() {
  const raw = String(process.env.FCM_SERVICE_ACCOUNT_JSON || '').trim();
  if (raw) {
    try { return JSON.parse(raw); } catch {}
    try { return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); } catch {}
    throw new AppError(500, 'FCM_SERVICE_ACCOUNT_JSON no es JSON/base64 válido', 'FCM_SERVICE_ACCOUNT_INVALID');
  }
  const projectId = process.env.FCM_PROJECT_ID || process.env.FCM_WEB_PROJECT_ID;
  const clientEmail = process.env.FCM_CLIENT_EMAIL;
  const privateKey = String(process.env.FCM_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) return null;
  return { project_id: projectId, client_email: clientEmail, private_key: privateKey };
}

function publicWebConfig() {
  const config = {
    apiKey: process.env.FCM_WEB_API_KEY || '',
    authDomain: process.env.FCM_WEB_AUTH_DOMAIN || '',
    projectId: process.env.FCM_WEB_PROJECT_ID || process.env.FCM_PROJECT_ID || '',
    messagingSenderId: process.env.FCM_WEB_MESSAGING_SENDER_ID || '',
    appId: process.env.FCM_WEB_APP_ID || ''
  };
  const vapidKey = process.env.FCM_WEB_VAPID_KEY || '';
  const clientConfigured = Boolean(config.apiKey && config.projectId && config.messagingSenderId && config.appId && vapidKey);
  const serverConfigured = Boolean(decodeServiceAccount());
  return { marker:'VANTIX_RESTAURANT_PUSH_CORE_V65', enabled:clientConfigured && serverConfigured, clientConfigured, serverConfigured, firebaseConfig:config, vapidKey };
}

function b64url(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}

async function accessToken() {
  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - 60_000) return cachedAccessToken;
  const account = decodeServiceAccount();
  if (!account?.project_id || !account?.client_email || !account?.private_key) {
    throw new AppError(503, 'Firebase Cloud Messaging no está configurado en el servidor', 'FCM_NOT_CONFIGURED');
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg:'RS256', typ:'JWT' });
  const payload = b64url({ iss:account.client_email, scope:FCM_SCOPE, aud:TOKEN_URL, iat:now, exp:now + 3600 });
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url');
  const assertion = `${unsigned}.${signature}`;
  const response = await fetch(TOKEN_URL, {
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
    body:new URLSearchParams({ grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new AppError(502, body.error_description || 'No fue posible autenticar Firebase Cloud Messaging', 'FCM_OAUTH_FAILED');
  }
  cachedAccessToken = body.access_token;
  cachedAccessTokenExpiresAt = Date.now() + Math.max(Number(body.expires_in || 3600), 300) * 1000;
  return cachedAccessToken;
}

function dataString(value) {
  return value === undefined || value === null ? '' : String(value);
}

async function sendToToken(token, input) {
  const account = decodeServiceAccount();
  if (!account?.project_id) throw new AppError(503, 'Firebase Cloud Messaging no está configurado', 'FCM_NOT_CONFIGURED');
  const bearer = await accessToken();
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`;
  const response = await fetch(url, {
    method:'POST',
    headers:{ Authorization:`Bearer ${bearer}`, 'Content-Type':'application/json' },
    body:JSON.stringify({
      message:{
        token,
        data:{
          title:dataString(input.title),
          body:dataString(input.body),
          deepLink:dataString(input.deepLink || '/app/centro-de-control'),
          eventCode:dataString(input.eventCode || 'PUSH_TEST'),
          tenantId:dataString(input.tenantId || ''),
          deliveryId:dataString(input.deliveryId || '')
        },
        webpush:{ headers:{ Urgency:'high', TTL:'120' } }
      }
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = Array.isArray(body?.error?.details) ? body.error.details : [];
    const fcmCode = details.map((d) => d?.errorCode).find(Boolean) || body?.error?.status || '';
    const error = new Error(body?.error?.message || `FCM HTTP ${response.status}`);
    error.httpStatus = response.status;
    error.fcmCode = fcmCode;
    error.invalidToken = response.status === 404 || ['UNREGISTERED','INVALID_ARGUMENT'].includes(String(fcmCode).toUpperCase());
    error.retryable = !error.invalidToken && response.status >= 500;
    throw error;
  }
  return { providerMessageId:body.name || null, raw:body };
}

module.exports = { publicWebConfig, sendToToken, decodeServiceAccount };
