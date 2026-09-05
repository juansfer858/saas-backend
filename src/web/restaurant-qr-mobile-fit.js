(() => {
  const MOBILE_COMPACT_MARKER = 'RESTAURANT_QR_MOBILE_COMPACT_V29';
  const viewport = document.querySelector('meta[name="viewport"]') || (() => {
    const node = document.createElement('meta');
    node.name = 'viewport';
    document.head.appendChild(node);
    return node;
  })();

  // Keep the first render tied to the physical device width. Pinch zoom remains available,
  // while touch-action + 16px focused fields prevent the browser's automatic tap/input zoom.
  viewport.setAttribute('content', 'width=device-width, initial-scale=1, minimum-scale=1, viewport-fit=cover');
  document.documentElement.dataset.restaurantQrMobile = MOBILE_COMPACT_MARKER;

  function syncVisibleViewport() {
    const visual = window.visualViewport;
    const height = Math.max(1, Math.round(visual?.height || window.innerHeight || document.documentElement.clientHeight || 1));
    const width = Math.max(1, Math.round(visual?.width || window.innerWidth || document.documentElement.clientWidth || 1));
    const top = Math.max(0, Math.round(visual?.offsetTop || 0));
    document.documentElement.style.setProperty('--qrv-visible-height', `${height}px`);
    document.documentElement.style.setProperty('--qrv-visible-width', `${width}px`);
    document.documentElement.style.setProperty('--qrv-visible-top', `${top}px`);
  }

  syncVisibleViewport();
  window.visualViewport?.addEventListener('resize', syncVisibleViewport, { passive:true });
  window.visualViewport?.addEventListener('scroll', syncVisibleViewport, { passive:true });
  window.addEventListener('resize', syncVisibleViewport, { passive:true });
  window.addEventListener('orientationchange', () => setTimeout(() => {
    syncVisibleViewport();
    window.scrollTo({ left:0, behavior:'auto' });
  }, 120));

  if (!document.getElementById('restaurantQrMobileFitStyles')) {
    const style = document.createElement('style');
    style.id = 'restaurantQrMobileFitStyles';
    style.textContent = `
      html,body{width:100%;max-width:100%;min-width:0;overflow-x:hidden;overflow-x:clip;-webkit-text-size-adjust:100%;text-size-adjust:100%}
      body.qrv3,.qrv3-shell,.qrv3-frame{width:100%;max-width:100%;min-width:0}
      body.qrv3{-webkit-tap-highlight-color:transparent;overscroll-behavior-x:none}
      .qrv3-shell{min-height:100vh;min-height:100svh;min-height:100dvh;overflow-x:hidden;overflow-x:clip}
      .qrv3-frame{max-width:1080px}
      .qrv3 button,.qrv3 [role="button"],.qrv-visit-card button{touch-action:manipulation}
      .qrv3-hero,.qrv3-status,.qrv3-content,.qrv3-grid,.qrv3-product,.qrv3-product-body,.qrv3-intro,.qrv3-cartbar,.qrv3-sheet,.qrv3-orderline{min-width:0;max-width:100%}
      .qrv3-hero>*,.qrv3-status>*,.qrv3-intro>*,.qrv3-cartbar>*,.qrv3-orderline>*{min-width:0}
      .qrv3-brand,.qrv3-product-name,.qrv3-cartcopy,.qrv3-status b,.qrv3-status span,.qrv-visit-card,.qrv-visit-person span{overflow-wrap:anywhere;word-break:break-word}
      .qrv3 img,.qrv3 svg,.qrv3 video,.qrv3 canvas{max-width:100%;height:auto}
      .qrv3-cartbar{max-width:calc(100dvw - 12px)}
      html body .qrv3-modal,html body .qrv-visit-overlay{top:var(--qrv-visible-top,0px)!important;right:0!important;bottom:auto!important;left:0!important;width:100%!important;height:var(--qrv-visible-height,100dvh)!important;max-width:var(--qrv-visible-width,100dvw)!important;max-height:var(--qrv-visible-height,100dvh)!important;overflow-x:hidden!important;overflow-x:clip!important}
      .qrv3-sheet{max-height:calc(var(--qrv-visible-height,100dvh) - 12px);overscroll-behavior:contain;scroll-padding-bottom:18px}
      .qrv-visit-card{min-width:0;max-width:min(620px,calc(100dvw - 20px));overscroll-behavior:contain;scroll-padding-bottom:18px}

      @media (hover:none),(pointer:coarse){
        .qrv3 input,.qrv3 textarea,.qrv3 select,.qrv-visit-card input,.qrv-visit-card textarea,.qrv-visit-card select{font-size:16px!important}
        .qrv3 button,.qrv3 [role="button"],.qrv-visit-card button{touch-action:manipulation;-webkit-user-select:none;user-select:none}
      }

      @media(max-width:560px){
        body.qrv3{font-size:13px}
        .qrv3-shell{padding:6px 6px calc(76px + env(safe-area-inset-bottom))!important}
        .qrv3-hero{grid-template-columns:minmax(0,1fr) auto!important;width:100%;gap:7px!important;padding:10px!important;border-radius:13px!important}
        .qrv3-hero>div:first-child{min-width:0}
        .qrv3-kicker{margin-bottom:3px!important;font-size:8px!important;letter-spacing:.09em!important}
        .qrv3-brand{font-size:26px!important;line-height:1!important}
        .qrv3-table{min-width:0!important;max-width:94px!important;gap:6px!important;padding:5px 6px!important;border-radius:11px!important}
        .qrv3-table-icon{flex:0 0 auto;width:30px!important;height:30px!important;border-radius:9px!important;font-size:16px!important}
        .qrv3-table small{font-size:8px!important}.qrv3-table strong{font-size:18px!important}
        .qrv3-help{grid-column:1/-1!important;width:100%!important;min-height:36px!important;padding:0 10px!important;border-radius:10px!important;font-size:11px!important}
        .qrv3-status{grid-template-columns:minmax(0,1fr) auto!important;width:100%;gap:6px!important;margin:6px 0!important;padding:7px 8px!important;border-radius:10px!important}
        .qrv3-status b{font-size:11px!important;line-height:1.2!important}.qrv3-status span{font-size:13px!important;line-height:1.15!important;text-align:right}
        .qrv3-nav-wrap{margin:0 -6px!important;padding:5px 6px!important}
        .qrv3-nav{gap:5px!important}
        .qrv3-filter{min-height:38px!important;padding:0 10px!important;border-radius:11px!important;font-size:11px!important}
        .qrv3-content{padding:8px 0!important}
        .qrv3-intro{align-items:flex-start;flex-wrap:wrap;gap:5px!important;margin:2px 1px 7px!important}
        .qrv3-intro h2{font-size:19px!important}.qrv3-intro p,.qrv3-intro strong{font-size:10px!important}.qrv3-intro p{margin-top:3px!important}
        .qrv3-menu-list{border-radius:13px!important}
        .qrv3-menu-row{grid-template-columns:minmax(0,1fr) auto!important;gap:5px 7px!important;padding:9px 8px!important}
        .qrv3-menu-row-spotlight{margin-bottom:8px!important;padding-left:8px!important;border-left-width:3px!important;border-radius:13px!important}
        .qrv3-badge{margin-bottom:4px!important;padding:3px 5px!important;border-radius:6px!important;font-size:8px!important}
        .qrv3-product-name,.qrv3-menu-row-spotlight .qrv3-product-name{font-size:15px!important;line-height:1.12!important}
        .qrv3-product-meta{margin-top:3px!important;font-size:10px!important;line-height:1.25!important}
        .qrv3-price{grid-column:1!important;grid-row:2!important;font-size:15px!important;line-height:1.1!important}
        .qrv3-menu-actions{grid-column:2!important;grid-row:1/3!important;min-width:112px!important}
        .qrv3-stepper{grid-template-columns:36px 38px 40px!important;min-height:40px!important;border-radius:10px!important}
        .qrv3-stepper button{font-size:21px!important}.qrv3-stepper span{font-size:14px!important}
        .qrv3-unavailable{min-height:40px!important;padding:0 8px!important;border-radius:10px!important;font-size:10px!important}
        .qrv3-menu-actions .qrv3-review{max-width:112px!important;min-height:40px!important;padding:5px 7px!important;border-radius:10px!important;font-size:10px!important;white-space:normal!important;line-height:1.08!important}
        .qrv3-empty{padding:20px 12px!important;border-radius:13px!important}.qrv3-empty strong{font-size:16px!important}.qrv3-empty span{font-size:11px!important}
        .qrv3-closed{padding:18px 12px!important;border-radius:14px!important}.qrv3-closed-icon{font-size:38px!important}.qrv3-closed h2{font-size:21px!important}.qrv3-closed p{font-size:13px!important}
        .qrv3-cartbar{grid-template-columns:auto minmax(0,1fr) auto!important;gap:6px!important;width:calc(100% - 8px)!important;max-width:calc(100dvw - 8px)!important;bottom:max(4px,env(safe-area-inset-bottom))!important;padding:5px 6px!important;border-radius:12px!important}
        .qrv3-cartcount{min-width:40px!important;height:40px!important;border-radius:10px!important;font-size:16px!important}
        .qrv3-cartcopy b{font-size:13px!important;line-height:1.1!important}.qrv3-cartcopy span{font-size:9px!important}
        .qrv3-review{min-height:42px!important;padding:0 10px!important;border-radius:10px!important;font-size:11px!important}
        .qrv3-carttotal{display:none!important}
        .qrv3-modal{padding:3px!important;place-items:end center!important}
        .qrv3-sheet{width:100%!important;max-width:calc(100dvw - 6px)!important;max-height:calc(var(--qrv-visible-height,100dvh) - 6px)!important;border-radius:15px 15px 8px 8px!important}
        .qrv3-sheet-head{gap:7px!important;padding:9px 10px!important}.qrv3-sheet-head h2{font-size:18px!important}.qrv3-sheet-head button{width:38px!important;height:38px!important;border-radius:10px!important;font-size:20px!important}
        .qrv3-sheet-body{padding:9px 10px!important}
        .qrv3-orderline{gap:8px!important;padding:8px 0!important}.qrv3-orderline b{font-size:13px!important}.qrv3-orderline small{font-size:10px!important}
        .qrv3-order-controls{gap:5px!important}.qrv3-order-controls button{width:38px!important;height:38px!important;border-radius:9px!important;font-size:19px!important}.qrv3-order-controls span{min-width:20px!important;font-size:13px!important}
        .qrv3-order-total{padding:10px 0!important;font-size:17px!important}
        .qrv3-form{gap:7px!important;margin-top:4px!important;padding-top:9px!important}.qrv3-form label{font-size:11px!important}
        .qrv3-phone{min-height:44px!important;margin-top:4px!important;padding:0 10px!important;border-radius:10px!important}
        .qrv3-consent{gap:7px!important;font-size:11px!important}.qrv3-consent input{width:18px!important;height:18px!important}
        .qrv3-send{min-height:46px!important;margin-top:4px!important;border-radius:10px!important;font-size:13px!important}
        .qrv3-helpsteps{gap:7px!important}.qrv3-helpstep{grid-template-columns:34px 1fr!important;gap:8px!important;padding:8px!important;border-radius:11px!important}.qrv3-helpstep span{width:34px!important;height:34px!important;font-size:15px!important}.qrv3-helpstep b{font-size:13px!important}.qrv3-helpstep small{font-size:10px!important}
        .qrv3-success{padding:22px 12px!important}.qrv3-success-mark{width:56px!important;height:56px!important;font-size:28px!important}.qrv3-success h2{font-size:23px!important}.qrv3-success p{font-size:12px!important}.qrv3-success button{min-height:44px!important;font-size:12px!important}

        html body .qrv-visit-overlay{width:100%!important;padding:3px max(6px,env(safe-area-inset-right)) 3px max(6px,env(safe-area-inset-left))!important;place-items:end center!important}
        html body .qrv-visit-card{width:100%!important;max-width:100%!important;max-height:calc(var(--qrv-visible-height,100dvh) - 6px)!important;padding:13px!important;border-radius:15px 15px 8px 8px!important}
        html body .qrv-visit-card h2{font-size:21px!important;line-height:1.05!important}
        html body .qrv-visit-card>p{margin:6px 0 10px!important;font-size:12px!important;line-height:1.3!important}
        html body .qrv-visit-code-label{font-size:11px!important}
        html body .qrv-visit-code{height:56px!important;margin-top:4px!important;border-radius:11px!important;font-size:28px!important;letter-spacing:.22em!important;padding-left:.22em!important}
        html body .qrv-visit-seat-title{margin:11px 0 5px!important;font-size:11px!important}
        html body .qrv-visit-seats{gap:6px!important}
        html body .qrv-visit-seat{min-height:42px!important;border-radius:10px!important;font-size:12px!important}
        html body .qrv-visit-submit{min-height:48px!important;margin-top:10px!important;border-radius:10px!important;font-size:13px!important}
        html body .qrv-visit-secondary{min-height:40px!important;margin-top:5px!important;border-radius:9px!important;font-size:11px!important}
        html body .qrv-visit-error{margin-top:7px!important;padding:8px 9px!important;border-radius:9px!important;font-size:11px!important}
        html body .qrv-visit-note{gap:6px!important;margin-top:7px!important;padding:7px!important;border-radius:9px!important;font-size:9px!important;line-height:1.25!important}
        html body .qrv-visit-person{gap:6px!important;margin-top:6px!important;padding:6px 8px!important;border-radius:9px!important;font-size:10px!important}
        html body .qrv-visit-person button{min-height:34px!important;padding:0 8px!important;border-radius:8px!important;font-size:10px!important}
      }

      @media(max-width:390px){
        .qrv3-brand{font-size:23px!important}
        .qrv3-table{max-width:86px!important}.qrv3-table-icon{width:28px!important;height:28px!important}.qrv3-table strong{font-size:17px!important}
        .qrv3-cartcopy span{display:none!important}
        .qrv3-menu-actions{min-width:106px!important}.qrv3-stepper{grid-template-columns:34px 36px 36px!important}
      }
    `;
    document.head.appendChild(style);
  }

  const mobileLike = window.matchMedia?.('(hover: none), (pointer: coarse)').matches ?? false;

  // QR scanners often open an in-app browser. Do not force the keyboard on first paint:
  // the customer should first see a correctly fitted screen, then tap the code field.
  function settleMobileVisitOverlay() {
    if (!mobileLike) return;
    const input = document.querySelector('#restaurantVisitCode');
    if (input && document.activeElement === input && !input.dataset.qrvInitialFocusSettled) {
      input.dataset.qrvInitialFocusSettled = 'true';
      input.blur();
      requestAnimationFrame(() => window.scrollTo({ top:0, left:0, behavior:'auto' }));
    }
  }

  const observer = new MutationObserver(() => settleMobileVisitOverlay());
  const startObserver = () => {
    if (document.body) observer.observe(document.body, { childList:true, subtree:true });
    settleMobileVisitOverlay();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once:true });
  else startObserver();

  document.addEventListener('focusin', (event) => {
    if (!mobileLike) return;
    const field = event.target;
    if (!(field instanceof HTMLElement) || !field.matches('.qrv3-modal input,.qrv3-modal textarea,.qrv3-modal select,.qrv-visit-overlay input,.qrv-visit-overlay textarea,.qrv-visit-overlay select')) return;
    setTimeout(() => {
      syncVisibleViewport();
      field.scrollIntoView({ block:'center', inline:'nearest', behavior:'auto' });
    }, 180);
  });
})();
