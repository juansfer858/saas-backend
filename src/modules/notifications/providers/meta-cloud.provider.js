const { AppError } = require('../../../utils/app-error');

function graphBase() {
  return String(process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com').replace(/\/$/, '');
}

function graphVersion() {
  const value = String(process.env.META_GRAPH_VERSION || '').trim();
  if (!value) throw new AppError(503, 'META_GRAPH_VERSION debe configurarse con una versión vigente de Graph API antes de usar Meta en producción', 'META_GRAPH_VERSION_REQUIRED');
  return value.startsWith('v') ? value : `v${value}`;
}

function embeddedSignupConfig() {
  const configuredVersion = String(process.env.META_GRAPH_VERSION || '').trim();
  return {
    providerCode: 'META_CLOUD_API',
    embeddedSignupVersion: 'v4',
    appId: process.env.META_APP_ID || null,
    configId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || null,
    graphVersion: configuredVersion ? (configuredVersion.startsWith('v') ? configuredVersion : `v${configuredVersion}`) : null,
    ready: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_EMBEDDED_SIGNUP_CONFIG_ID && process.env.META_GRAPH_VERSION)
  };
}

async function graph(path, { method = 'GET', token = null, body = null, query = null } = {}) {
  const url = new URL(`${graphBase()}/${graphVersion()}/${String(path).replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(Number(process.env.META_HTTP_TIMEOUT_MS || 10000))
    });
  } catch (error) {
    error.retryable = true;
    throw error;
  }
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const message = data?.error?.message || `Meta Graph HTTP ${response.status}`;
    const error = new AppError(response.status >= 500 || response.status === 429 ? 503 : 400, message, 'META_GRAPH_ERROR', { httpStatus: response.status, provider: data?.error || data });
    error.retryable = response.status >= 500 || response.status === 429;
    error.httpStatus = response.status;
    error.providerBody = data;
    throw error;
  }
  return { data, httpStatus: response.status };
}

async function exchangeEmbeddedSignupCode(code) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new AppError(503, 'Meta App ID/secret no configurados en el Core', 'META_APP_CREDENTIALS_REQUIRED');
  const result = await graph('oauth/access_token', {
    query: { client_id: appId, client_secret: appSecret, code }
  });
  if (!result.data?.access_token) throw new AppError(502, 'Meta no devolvió access_token para Embedded Signup', 'META_TOKEN_EXCHANGE_INVALID');
  return { accessToken: result.data.access_token, tokenType: result.data.token_type || null, expiresIn: result.data.expires_in || null };
}

async function subscribeWaba({ wabaId, accessToken }) {
  const result = await graph(`${wabaId}/subscribed_apps`, { method: 'POST', token: accessToken, body: {} });
  return result.data;
}

async function getPhoneNumber({ phoneNumberId, accessToken }) {
  const result = await graph(phoneNumberId, {
    token: accessToken,
    query: { fields: 'display_phone_number,verified_name,quality_rating' }
  });
  return result.data;
}

async function revokeAccess({ accessToken }) {
  // Best effort provider-side invalidation. The Core always deletes the tenant token locally even if Meta rejects this call.
  try {
    const result = await graph('me/permissions', { method: 'DELETE', token: accessToken, body: {} });
    return { attempted: true, providerResponse: result.data };
  } catch (error) {
    return { attempted: true, providerError: error.message };
  }
}

async function createTemplate({ wabaId, accessToken, template }) {
  const bodyComponent = { type: 'BODY', text: template.bodyText };
  if (template.variables?.examples?.length) {
    bodyComponent.example = { body_text: [template.variables.examples] };
  }
  const result = await graph(`${wabaId}/message_templates`, {
    method: 'POST',
    token: accessToken,
    body: {
      name: template.name,
      language: template.languageCode,
      category: template.category,
      components: [bodyComponent]
    }
  });
  return result.data;
}

async function listTemplates({ wabaId, accessToken }) {
  const result = await graph(`${wabaId}/message_templates`, {
    token: accessToken,
    query: { fields: 'id,name,status,language,category,rejected_reason', limit: 250 }
  });
  return result.data?.data || [];
}

async function sendTemplate({ phoneNumberId, accessToken, to, templateName, languageCode, parameters = [] }) {
  const components = parameters.length
    ? [{ type: 'body', parameters: parameters.map((value) => ({ type: 'text', text: String(value) })) }]
    : undefined;
  const result = await graph(`${phoneNumberId}/messages`, {
    method: 'POST', token: accessToken,
    body: {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components ? { components } : {})
      }
    }
  });
  return { providerMessageId: result.data?.messages?.[0]?.id || null, raw: result.data };
}

async function sendText({ phoneNumberId, accessToken, to, text }) {
  const result = await graph(`${phoneNumberId}/messages`, {
    method: 'POST', token: accessToken,
    body: { messaging_product: 'whatsapp', to, type: 'text', text: { body: text, preview_url: false } }
  });
  return { providerMessageId: result.data?.messages?.[0]?.id || null, raw: result.data };
}

async function sendDocument({ phoneNumberId, accessToken, to, link, filename, caption }) {
  const result = await graph(`${phoneNumberId}/messages`, {
    method: 'POST', token: accessToken,
    body: {
      messaging_product: 'whatsapp',
      to,
      type: 'document',
      document: { link, filename: filename || undefined, caption: caption || undefined }
    }
  });
  return { providerMessageId: result.data?.messages?.[0]?.id || null, raw: result.data };
}

module.exports = {
  code: 'META_CLOUD_API',
  embeddedSignupConfig,
  exchangeEmbeddedSignupCode,
  subscribeWaba,
  getPhoneNumber,
  revokeAccess,
  createTemplate,
  listTemplates,
  sendTemplate,
  sendText,
  sendDocument
};
