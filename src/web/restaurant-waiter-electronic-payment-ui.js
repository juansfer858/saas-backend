(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const FALLBACK_MS = 5000;
  const state = { reports:[], streamAbort:null, reconnectTimer:null, fallbackTimer:null, ringTimer:null, audioContext:null, paused:false, booted:false };

  function readSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } }
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m])); }
  const money = (value) => new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 }).format(Number(value || 0));

  function headers(extra = {}) {
    const session = readSession();
    if (!session?.token || !session?.subdomain) return null;
    return { Authorization:`Bearer ${session.token}`, 'x-tenant-subdomain':session.subdomain, ...extra };
  }

  function ensureStyles() {
    if (document.getElementById('restaurantWaiterElectronicPaymentStyles')) return;
    const style = document.createElement('style');
    style.id = 'restaurantWaiterElectronicPaymentStyles';
    style.textContent = `
      .wep-stack{position:fixed;z-index:172;top:max(92px,calc(env(safe-area-inset-top) + 88px));left:50%;transform:translateX(-50%);display:grid;gap:8px;width:min(570px,calc(100% - 16px));pointer-events:none}
      .wep-card{pointer-events:auto;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:11px;align-items:center;padding:14px;border:2px solid #168454;border-radius:18px;background:#effbf5;color:#17212b;box-shadow:0 18px 44px rgba(15,23,42,.28);animation:wepPulse 1.2s ease-in-out infinite alternate}.wep-card.general{border-color:#0f766e;background:#effcfa}
      .wep-kicker{display:block;margin-bottom:4px;color:#087044;font-size:10px;font-weight:950;letter-spacing:.08em}.wep-copy b{display:block;font-size:20px;line-height:1.08}.wep-copy span{display:block;margin-top:4px;color:#53655d;font-size:12px;font-weight:760;line-height:1.35}.wep-copy strong{display:block;margin-top:6px;color:#087044;font-size:18px}.wep-action{min-width:150px;min-height:54px;padding:0 13px;border:0;border-radius:13px;background:#168454;color:#fff;font-weight:950}.wep-action:disabled{opacity:.55}
      @keyframes wepPulse{from{box-shadow:0 14px 34px rgba(15,23,42,.18)}to{box-shadow:0 20px 48px rgba(22,132,84,.30)}}
      @media(max-width:460px){.wep-card{grid-template-columns:1fr}.wep-action{width:100%}.wep-copy b{font-size:18px}}
    `;
    document.head.appendChild(style);
  }

  function ensureRoot() {
    ensureStyles();
    let root = document.getElementById('restaurantWaiterElectronicPaymentStack');
    if (root) return root;
    root = document.createElement('aside'); root.id = 'restaurantWaiterElectronicPaymentStack'; root.className = 'wep-stack'; root.setAttribute('aria-live','assertive');
    root.setAttribute('aria-label','Pagos electrónicos por confirmar'); document.body.appendChild(root); return root;
  }

  function tableTitle(report) { return report.table?.code || report.table?.name || 'Mesa'; }
  function destinationText(report) {
    const d = report.destination || {};
    const parts = [d.nombre || d.banco || 'Cuenta electrónica'];
    if (d.numeroCuenta) parts.push(d.numeroCuenta);
    return parts.filter(Boolean).join(' · ');
  }

  function render() {
    const root = ensureRoot();
    root.innerHTML = state.reports.map((report) => {
      const general = report.priority === 'GENERAL' || report.escalated;
      const person = Number(report.seatNumber || 0) > 0 ? `Persona ${Number(report.seatNumber)} · ` : '';
      const ref = report.reference ? ` · Ref. ${esc(report.reference)}` : '';
      return `<section class="wep-card ${general ? 'general' : ''}" data-payment-report="${esc(report.id)}">
        <div class="wep-copy"><small class="wep-kicker">${general ? 'PAGO ELECTRÓNICO · AVISO GENERAL' : 'PAGO ELECTRÓNICO POR CONFIRMAR'}</small>
          <b>${esc(tableTitle(report))} REPORTA PAGO</b><strong>${money(report.amount)}</strong>
          <span>${esc(person)}${esc(destinationText(report))}${ref}</span></div>
        <button type="button" class="wep-action" data-confirm-payment="${esc(report.id)}">CONFIRMAR PAGO</button>
      </section>`;
    }).join('');
    root.querySelectorAll('[data-confirm-payment]').forEach((button) => button.addEventListener('click', () => confirmPayment(button)));
    updateRinging();
  }

  function warmAudio() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext; if (!AudioContext) return;
      if (!state.audioContext) state.audioContext = new AudioContext(); state.audioContext.resume?.().catch(() => {});
    } catch {}
  }

  function beep() {
    try {
      warmAudio(); const ctx = state.audioContext; if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime; const gain = ctx.createGain(); gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(.17, now + .02); gain.gain.exponentialRampToValueAtTime(.0001, now + .7); gain.connect(ctx.destination);
      for (const [offset, frequency] of [[0,740],[.2,980],[.4,1180]]) { const osc=ctx.createOscillator(); osc.frequency.setValueAtTime(frequency, now+offset); osc.connect(gain); osc.start(now+offset); osc.stop(now+offset+.16); }
    } catch {}
    try { navigator.vibrate?.([260,100,260,100,380]); } catch {}
  }

  function ringTick() { state.ringTimer = null; if (!state.reports.length || state.paused || document.visibilityState === 'hidden') return; beep(); state.ringTimer = setTimeout(ringTick, 5000); }
  function updateRinging() {
    if (!state.reports.length || state.paused || document.visibilityState === 'hidden') { if (state.ringTimer) clearTimeout(state.ringTimer); state.ringTimer=null; try{navigator.vibrate?.(0);}catch{} return; }
    if (!state.ringTimer) ringTick();
  }

  function applySnapshot(snapshot) { state.reports = Array.isArray(snapshot?.reports) ? snapshot.reports : []; render(); }

  async function fetchSnapshot() {
    const h = headers({ Accept:'application/json' }); if (!h) return false;
    try {
      const response = await fetch('/api/public/restaurante/mesero-dispositivo/pagos-electronicos', { cache:'no-store', headers:h });
      const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
      applySnapshot(body?.data || { reports:[] }); return true;
    } catch { return false; }
  }

  async function confirmPayment(button) {
    const reportId = button?.dataset.confirmPayment; if (!reportId) return;
    const report = state.reports.find((row) => row.id === reportId); if (!report) return;
    const label = `${tableTitle(report)} por ${money(report.amount)}`;
    if (!confirm(`¿Confirmas que verificaste el pago electrónico de ${label}?\n\nAl confirmar, VantixGC registrará el pago y cerrará la cuenta si el total quedó cubierto.`)) return;
    const h = headers({ 'Content-Type':'application/json', Accept:'application/json' }); if (!h) return;
    button.disabled = true; button.textContent = 'CONFIRMANDO…';
    try {
      const response = await fetch(`/api/public/restaurante/mesero-dispositivo/pagos-electronicos/${encodeURIComponent(reportId)}/confirmar`, { method:'POST', cache:'no-store', headers:h, body:'{}' });
      const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body?.error?.message || body?.message || 'No fue posible confirmar el pago');
      state.reports = state.reports.filter((row) => row.id !== reportId); render();
      const tableId = report.table?.id || '';
      const tableButton = tableId ? document.querySelector(`#wvTables .wv-table[data-table="${CSS.escape(tableId)}"]`) : null; tableButton?.click();
      fetchSnapshot().catch(() => {});
    } catch (error) {
      button.disabled = false; button.textContent = 'CONFIRMAR PAGO';
      const message = document.getElementById('wvMessage'); if (message) message.innerHTML = `<div class="wv-msg err">${esc(error.message || 'No fue posible confirmar el pago')}</div>`; else alert(error.message);
    }
  }

  function parseSse(block) {
    const lines=block.split(/\r?\n/); let eventName='message'; const data=[];
    for(const line of lines){ if(line.startsWith('event:')) eventName=line.slice(6).trim(); else if(line.startsWith('data:')) data.push(line.slice(5).trim()); }
    if(eventName==='snapshot' && data.length){ try{applySnapshot(JSON.parse(data.join('\n')));}catch{} }
  }

  async function streamLoop(controller) {
    const h = headers({ Accept:'text/event-stream' }); if (!h) throw new Error('Sesión no disponible');
    const response = await fetch('/api/public/restaurante/mesero-dispositivo/pagos-electronicos/stream', { cache:'no-store', headers:h, signal:controller.signal });
    if (!response.ok || !response.body) throw new Error('Canal de pagos no disponible');
    const reader=response.body.getReader(); const decoder=new TextDecoder(); let buffer='';
    while(!controller.signal.aborted){ const {done,value}=await reader.read(); if(done)break; buffer+=decoder.decode(value,{stream:true}); let boundary; while((boundary=buffer.indexOf('\n\n'))>=0){ const block=buffer.slice(0,boundary); buffer=buffer.slice(boundary+2); if(block&&!block.startsWith(':'))parseSse(block); } }
  }

  function startStream() {
    if (state.paused || state.streamAbort || document.visibilityState === 'hidden') return;
    const controller=new AbortController(); state.streamAbort=controller;
    streamLoop(controller).catch(()=>{}).finally(()=>{ if(state.streamAbort===controller)state.streamAbort=null; if(!controller.signal.aborted)scheduleReconnect(); });
  }
  function scheduleReconnect() { if(state.paused||state.reconnectTimer||document.visibilityState==='hidden')return; state.reconnectTimer=setTimeout(()=>{state.reconnectTimer=null; fetchSnapshot().catch(()=>{}); startStream();},3000); }
  function stopStream() { state.streamAbort?.abort(); state.streamAbort=null; if(state.reconnectTimer)clearTimeout(state.reconnectTimer); state.reconnectTimer=null; }
  function scheduleFallback() { if(state.paused||state.fallbackTimer||document.visibilityState==='hidden'||navigator.onLine===false)return; state.fallbackTimer=setTimeout(async()=>{state.fallbackTimer=null;if(state.paused||document.visibilityState==='hidden')return;await fetchSnapshot().catch(()=>{});scheduleFallback();},FALLBACK_MS); }
  function stopFallback() { if(state.fallbackTimer)clearTimeout(state.fallbackTimer); state.fallbackTimer=null; }
  function pause() { state.paused=true; stopStream(); stopFallback(); updateRinging(); }
  function resume() { state.paused=false; ensureRoot(); fetchSnapshot().catch(()=>{}); startStream(); scheduleFallback(); updateRinging(); }
  function boot() { if(state.booted)return; state.booted=true; resume(); }

  window.addEventListener('pointerdown',warmAudio,{once:true,passive:true}); window.addEventListener('pagehide',pause); window.addEventListener('pageshow',resume); window.addEventListener('online',resume); window.addEventListener('focus',()=>{if(document.visibilityState!=='hidden')resume();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')pause();else resume();});
  window.VantixGCWaiterElectronicPayment = Object.freeze({ version:'1.0.0', sse:true, foregroundFallbackMs:FALLBACK_MS, waiterConfirmationRequired:true, intervalFree:true, observerFree:true });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
