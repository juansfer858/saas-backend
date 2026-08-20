(() => {
  const sessionKey = 'vantixgc_core_session_v1';
  let session = null;
  try { session = JSON.parse(localStorage.getItem(sessionKey) || 'null'); } catch {}
  if (!session) return;

  const EVENT_LABELS = {
    ORDER_CONFIRMED: 'Pedido confirmado',
    ORDER_READY: 'Pedido listo',
    RESERVATION_CONFIRMED: 'Reserva confirmada',
    ACCOUNT_CLOSED_INVOICE: 'Cuenta cerrada / factura enviada',
    MARKETING_CAMPAIGN: 'Campaña de marketing',
    TRACKING_STATUS_CHANGED: 'Cambio de estado / seguimiento'
  };

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
  const api = async (path, opts = {}) => {
    const response = await fetch(path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
        'x-tenant-subdomain': session.subdomain,
        ...(opts.headers || {})
      }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    return body;
  };

  function flash(message, error = false) {
    const box = document.querySelector('#flash');
    if (box) box.innerHTML = `<div class="${error ? 'error' : 'notice'}">${esc(message)}</div>`;
  }

  function setActive(tab) {
    document.querySelectorAll('.tabs .tab').forEach((b) => b.classList.remove('active'));
    tab.classList.add('active');
  }

  async function loadFacebookSdk() {
    if (window.FB) return window.FB;
    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-vantix-meta-sdk]');
      if (existing) {
        const timer = setInterval(() => { if (window.FB) { clearInterval(timer); resolve(); } }, 100);
        setTimeout(() => { clearInterval(timer); reject(new Error('No fue posible cargar Meta SDK')); }, 10000);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://connect.facebook.net/es_LA/sdk.js';
      script.async = true;
      script.defer = true;
      script.dataset.vantixMetaSdk = '1';
      script.onload = resolve;
      script.onerror = () => reject(new Error('No fue posible cargar Meta SDK'));
      document.head.appendChild(script);
    });
    return window.FB;
  }

  async function renderNotifications() {
    const view = document.querySelector('#view');
    if (!view) return;
    view.innerHTML = '<div class="panel"><div class="pb">Cargando Notificaciones…</div></div>';
    try {
      const [cfgR, signupR, templatesR, eventsR, messagesR, trackingR] = await Promise.all([
        api('/api/v1/notificaciones/configuracion'),
        api('/api/v1/notificaciones/embedded-signup/config'),
        api('/api/v1/notificaciones/plantillas'),
        api('/api/v1/notificaciones/eventos'),
        api('/api/v1/notificaciones/mensajes?limit=50'),
        api('/api/v1/notificaciones/seguimiento?limit=30')
      ]);
      const cfg = cfgR.data || {};
      const signup = signupR.data || {};
      const templates = templatesR.data || [];
      const approved = templates.filter((t) => t.state === 'APPROVED');
      const events = eventsR.data || [];
      const messages = messagesR.data || [];
      const tracking = trackingR.data || [];

      view.innerHTML = `
        <div class="cards">
          <div class="card"><small>WhatsApp Business</small><strong>${cfg.connected ? '<span class="badge ok">Conectado</span>' : '<span class="badge warn">Sin conectar</span>'}</strong></div>
          <div class="card"><small>Embedded Signup</small><strong><span class="badge ${signup.ready ? 'ok' : 'warn'}">${esc(signup.embeddedSignupVersion || 'v4')}</span></strong></div>
          <div class="card"><small>Plantillas aprobadas</small><strong>${approved.length}</strong></div>
          <div class="card"><small>Mensajes en cola/fallo</small><strong>${messages.filter((x) => ['QUEUED','FAILED','SENDING'].includes(x.state)).length}</strong></div>
        </div>
        <div class="panel">
          <div class="ph"><strong>Notificaciones · WhatsApp Business</strong><span class="muted">Cada empresa conecta su propio número y marca.</span></div>
          <div class="pb">
            ${cfg.connected ? `
              <div class="notice"><strong>Tu WhatsApp Business ya está conectado.</strong> Número: ${esc(cfg.displayPhoneNumber || 'verificado por Meta')}</div>
              <div class="toolbar"><button class="btn danger" id="nDisconnect">Desconectar</button><button class="btn" id="nReconnect">Conectar otro número</button></div>
            ` : `
              <div class="muted" style="margin-bottom:12px">El administrador completa el popup oficial de Meta. VantixGC no solicita ni muestra tokens manuales.</div>
              <button class="btn primary" id="nConnect" ${signup.ready ? '' : 'disabled'}>Conectar mi WhatsApp Business</button>
              ${signup.ready ? '' : '<div class="notice">Faltan variables de servidor META_APP_ID, META_APP_SECRET, META_EMBEDDED_SIGNUP_CONFIG_ID y META_GRAPH_VERSION. No se permite pegar credenciales en esta pantalla.</div>'}
            `}
            <div class="grid" style="margin-top:16px">
              <div class="field"><label>Expiración del seguimiento después de completar (días)</label><input class="input" id="nExpiry" type="number" min="30" max="90" value="${Number(cfg.trackingExpiryDays || 60)}"></div>
              <div class="field" style="grid-column:span 2"><label>Respuesta si no se encuentra pedido activo</label><input class="input" id="nFallback" value="${esc(cfg.fallbackHumanContact || '')}" placeholder="Ej. Escríbenos al 3xx... / habla con recepción"></div>
            </div>
            <button class="btn" id="nSaveGeneral" style="margin-top:10px">Guardar preferencias</button>
          </div>
        </div>
        <div class="panel">
          <div class="ph"><strong>Plantillas Meta</strong><div class="toolbar"><button class="btn" id="nSyncTemplates" ${cfg.connected ? '' : 'disabled'}>Sincronizar estados</button></div></div>
          <div class="pb">
            <div class="grid">
              <div class="field"><label>Nombre técnico</label><input class="input" id="nTplName" placeholder="pedido_listo"></div>
              <div class="field"><label>Categoría</label><select class="select" id="nTplCategory"><option>UTILITY</option><option>MARKETING</option><option>AUTHENTICATION</option></select></div>
              <div class="field"><label>Idioma</label><input class="input" id="nTplLang" value="es_CO"></div>
              <div class="field" style="grid-column:span 4"><label>Mensaje</label><textarea id="nTplBody" placeholder="Tu pedido {{1}} está listo. Seguimiento: {{2}}"></textarea></div>
            </div>
            <button class="btn primary" id="nCreateTpl" style="margin-top:10px">Crear plantilla</button>
          </div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Nombre</th><th>Categoría</th><th>Idioma</th><th>Estado</th><th></th></tr></thead><tbody>
            ${templates.map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.category)}</td><td>${esc(t.languageCode)}</td><td><span class="badge ${t.state === 'APPROVED' ? 'ok' : t.state === 'REJECTED' ? 'bad' : 'warn'}">${esc(t.state)}</span>${t.rejectedReason ? `<br><small>${esc(t.rejectedReason)}</small>` : ''}</td><td>${['DRAFT','REJECTED'].includes(t.state) ? `<button class="btn" data-submit-template="${t.id}" ${cfg.connected ? '' : 'disabled'}>Enviar a Meta</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5">Sin plantillas.</td></tr>'}
          </tbody></table></div>
        </div>
        <div class="panel">
          <div class="ph"><strong>Eventos automáticos</strong><span class="muted">Un evento no se puede activar sin plantilla aprobada.</span></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Evento</th><th>Plantilla</th><th>Tipo</th><th>Activo</th><th></th></tr></thead><tbody>
            ${events.map((e) => `<tr><td>${esc(EVENT_LABELS[e.eventCode] || e.eventCode)}</td><td><select class="select" data-event-template="${e.eventCode}"><option value="">Seleccione aprobada</option>${approved.map((t) => `<option value="${t.id}" ${e.templateId === t.id ? 'selected' : ''}>${esc(t.name)} · ${esc(t.languageCode)}</option>`).join('')}</select></td><td>${e.marketing ? '<span class="badge warn">Marketing</span>' : '<span class="badge">Transaccional</span>'}</td><td><input type="checkbox" data-event-enabled="${e.eventCode}" ${e.enabled ? 'checked' : ''}></td><td><button class="btn" data-save-event="${e.eventCode}">Guardar</button></td></tr>`).join('')}
          </tbody></table></div>
        </div>
        <div class="panel">
          <div class="ph"><strong>Consentimiento · registro manual/QA</strong><span class="muted">Los verticales deben capturarlo explícitamente al recoger el teléfono.</span></div>
          <div class="pb"><div class="grid"><div class="field"><label>Teléfono E.164</label><input class="input" id="nConsentPhone" placeholder="+573001234567"></div><div class="field"><label>Alcance</label><select class="select" id="nConsentScope"><option>TRANSACTIONAL</option><option>MARKETING</option><option>ALL</option></select></div><div class="field"><label>Fuente</label><input class="input" id="nConsentSource" value="CONFIG_ADVANCED_MANUAL"></div></div><div class="toolbar" style="margin-top:10px"><button class="btn primary" id="nGrantConsent">Registrar consentimiento</button><button class="btn danger" id="nRevokeConsent">Dar de baja</button></div></div>
        </div>
        <div class="panel">
          <div class="ph"><strong>Cola y entrega</strong><button class="btn" id="nProcessQueue">Procesar ahora</button></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Evento</th><th>Destino</th><th>Estado</th><th>Intentos</th><th>Error</th></tr></thead><tbody>${messages.map((m) => `<tr><td>${new Date(m.creadoEn).toLocaleString()}</td><td>${esc(m.eventCode || '—')}</td><td>${esc(m.recipientPhoneE164)}</td><td><span class="badge ${['DELIVERED','READ','SENT'].includes(m.state) ? 'ok' : m.state === 'FAILED' ? 'bad' : 'warn'}">${esc(m.state)}</span></td><td>${m.retryCount}</td><td>${esc(m.lastError || '')}</td></tr>`).join('') || '<tr><td colspan="6">Sin mensajes.</td></tr>'}</tbody></table></div>
        </div>
        <div class="panel">
          <div class="ph"><strong>Magic Links de seguimiento</strong><span class="muted">Vista pública de solo lectura, token aleatorio no enumerable.</span></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Referencia</th><th>Origen</th><th>Estado</th><th>Expira</th><th>Link</th></tr></thead><tbody>${tracking.map((t) => `<tr><td>${esc(t.publicReference)}</td><td>${esc(t.originType)}</td><td>${esc(t.currentStatus)}</td><td>${new Date(t.expiresAt).toLocaleDateString()}</td><td><a href="${esc(t.publicUrl)}" target="_blank" rel="noopener">Abrir seguimiento</a></td></tr>`).join('') || '<tr><td colspan="5">Los verticales crearán los enlaces al abrir un documento rastreable.</td></tr>'}</tbody></table></div>
        </div>`;

      const saveGeneral = document.querySelector('#nSaveGeneral');
      if (saveGeneral) saveGeneral.onclick = async () => {
        try {
          await api('/api/v1/notificaciones/configuracion', { method: 'PUT', body: JSON.stringify({ trackingExpiryDays: Number(document.querySelector('#nExpiry').value), fallbackHumanContact: document.querySelector('#nFallback').value.trim() || null }) });
          flash('Preferencias de notificaciones guardadas.');
        } catch (e) { flash(e.message, true); }
      };

      async function launchSignup() {
        try {
          if (!signup.ready) throw new Error('Embedded Signup aún no está configurado en el servidor.');
          const FB = await loadFacebookSdk();
          let embedded = null;
          let code = null;
          let completed = false;
          const maybeComplete = async () => {
            if (completed || !embedded?.wabaId || !embedded?.phoneNumberId || !code) return;
            completed = true;
            await api('/api/v1/notificaciones/embedded-signup/complete', { method: 'POST', body: JSON.stringify({ code, wabaId: embedded.wabaId, phoneNumberId: embedded.phoneNumberId }) });
            flash('Tu WhatsApp Business ya está conectado.');
            window.removeEventListener('message', onMessage);
            await renderNotifications();
          };
          const onMessage = (event) => {
            if (!['https://www.facebook.com', 'https://web.facebook.com'].includes(event.origin)) return;
            let data = event.data;
            try { if (typeof data === 'string') data = JSON.parse(data); } catch { return; }
            if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
            if (data.event === 'FINISH') {
              embedded = { wabaId: data.data?.waba_id, phoneNumberId: data.data?.phone_number_id };
              maybeComplete().catch((e) => flash(e.message, true));
            }
          };
          window.addEventListener('message', onMessage);
          FB.init({ appId: signup.appId, autoLogAppEvents: true, xfbml: false, version: signup.graphVersion });
          FB.login((response) => {
            code = response?.authResponse?.code || null;
            if (!code) {
              window.removeEventListener('message', onMessage);
              flash('Meta no devolvió el código de autorización. El número no fue conectado.', true);
              return;
            }
            maybeComplete().catch((e) => flash(e.message, true));
          }, { config_id: signup.configId, response_type: 'code', override_default_response_type: true, extras: { feature: 'whatsapp_embedded_signup' } });
        } catch (e) { flash(e.message, true); }
      }

      const connect = document.querySelector('#nConnect'); if (connect) connect.onclick = launchSignup;
      const disconnect = document.querySelector('#nDisconnect'); if (disconnect) disconnect.onclick = async () => { try { await api('/api/v1/notificaciones/disconnect', { method: 'POST', body: '{}' }); flash('WhatsApp Business desconectado.'); await renderNotifications(); } catch (e) { flash(e.message, true); } };
      const reconnect = document.querySelector('#nReconnect'); if (reconnect) reconnect.onclick = async () => { try { await api('/api/v1/notificaciones/disconnect', { method: 'POST', body: '{}' }); await launchSignup(); } catch (e) { flash(e.message, true); } };

      document.querySelector('#nCreateTpl').onclick = async () => {
        try {
          await api('/api/v1/notificaciones/plantillas', { method: 'POST', body: JSON.stringify({ name: document.querySelector('#nTplName').value.trim(), category: document.querySelector('#nTplCategory').value, languageCode: document.querySelector('#nTplLang').value.trim(), bodyText: document.querySelector('#nTplBody').value.trim() }) });
          flash('Plantilla creada. Envíala a Meta para aprobación antes de activar eventos.'); await renderNotifications();
        } catch (e) { flash(e.message, true); }
      };
      document.querySelectorAll('[data-submit-template]').forEach((b) => b.onclick = async () => { try { await api(`/api/v1/notificaciones/plantillas/${b.dataset.submitTemplate}/enviar-aprobacion`, { method: 'POST', body: '{}' }); flash('Plantilla enviada a Meta.'); await renderNotifications(); } catch (e) { flash(e.message, true); } });
      document.querySelector('#nSyncTemplates').onclick = async () => { try { await api('/api/v1/notificaciones/plantillas/sincronizar', { method: 'POST', body: '{}' }); flash('Estados de plantillas sincronizados.'); await renderNotifications(); } catch (e) { flash(e.message, true); } };
      document.querySelectorAll('[data-save-event]').forEach((b) => b.onclick = async () => { const code = b.dataset.saveEvent; try { const enabled = document.querySelector(`[data-event-enabled="${code}"]`).checked; const templateId = document.querySelector(`[data-event-template="${code}"]`).value || null; await api(`/api/v1/notificaciones/eventos/${code}`, { method: 'PUT', body: JSON.stringify({ enabled, templateId }) }); flash(`Evento ${EVENT_LABELS[code] || code} guardado.`); await renderNotifications(); } catch (e) { flash(e.message, true); } });

      async function consent(revoke) {
        try {
          const body = { phoneE164: document.querySelector('#nConsentPhone').value.trim(), scope: document.querySelector('#nConsentScope').value, source: document.querySelector('#nConsentSource').value.trim(), evidence: { capturedFrom: 'CONFIGURACION_AVANZADA', explicit: !revoke } };
          await api(`/api/v1/notificaciones/consentimientos${revoke ? '/revocar' : ''}`, { method: 'POST', body: JSON.stringify(body) });
          flash(revoke ? 'Preferencia de baja registrada.' : 'Consentimiento registrado con auditoría.');
        } catch (e) { flash(e.message, true); }
      }
      document.querySelector('#nGrantConsent').onclick = () => consent(false);
      document.querySelector('#nRevokeConsent').onclick = () => consent(true);
      document.querySelector('#nProcessQueue').onclick = async () => { try { await api('/api/v1/notificaciones/cola/procesar', { method: 'POST', body: JSON.stringify({ limit: 25 }) }); await renderNotifications(); } catch (e) { flash(e.message, true); } };
    } catch (e) {
      view.innerHTML = `<div class="error">${esc(e.message)}</div>`;
    }
  }

  function installTab() {
    const tabs = document.querySelector('.tabs');
    if (!tabs || tabs.querySelector('[data-notifications-tab]')) return;
    const button = document.createElement('button');
    button.className = 'tab';
    button.type = 'button';
    button.dataset.notificationsTab = '1';
    button.textContent = 'Notificaciones';
    button.onclick = async () => { setActive(button); await renderNotifications(); };
    tabs.appendChild(button);
    tabs.querySelectorAll('.tab:not([data-notifications-tab])').forEach((b) => b.addEventListener('click', () => button.classList.remove('active')));
    const headMuted = document.querySelector('.head .muted');
    if (headMuted && !/notificaciones/i.test(headMuted.textContent)) headMuted.textContent = 'DIAN, permisos, impresión, nómina electrónica y notificaciones por tenant.';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installTab);
  else installTab();
})();
