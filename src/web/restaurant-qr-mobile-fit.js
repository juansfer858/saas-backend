(() => {
  const viewport = document.querySelector('meta[name="viewport"]') || (() => {
    const node = document.createElement('meta');
    node.name = 'viewport';
    document.head.appendChild(node);
    return node;
  })();

  // Keep the first render tied to the physical device width without disabling pinch zoom.
  viewport.setAttribute('content', 'width=device-width, initial-scale=1, minimum-scale=1, viewport-fit=cover');

  if (!document.getElementById('restaurantQrMobileFitStyles')) {
    const style = document.createElement('style');
    style.id = 'restaurantQrMobileFitStyles';
    style.textContent = `
      html,body{width:100%;max-width:100%;min-width:0;overflow-x:hidden;overflow-x:clip;-webkit-text-size-adjust:100%;text-size-adjust:100%}
      body.qrv3,.qrv3-shell,.qrv3-frame{width:100%;max-width:100%;min-width:0}
      .qrv3-shell{min-height:100vh;min-height:100svh;min-height:100dvh;overflow-x:hidden;overflow-x:clip}
      .qrv3-frame{max-width:1080px}
      .qrv3-hero,.qrv3-status,.qrv3-content,.qrv3-grid,.qrv3-product,.qrv3-product-body,.qrv3-intro,.qrv3-cartbar,.qrv3-sheet,.qrv3-orderline{min-width:0;max-width:100%}
      .qrv3-hero>*,.qrv3-status>*,.qrv3-intro>*,.qrv3-cartbar>*,.qrv3-orderline>*{min-width:0}
      .qrv3-brand,.qrv3-product-name,.qrv3-cartcopy,.qrv3-status b,.qrv3-status span,.qrv-visit-card,.qrv-visit-person span{overflow-wrap:anywhere;word-break:break-word}
      .qrv3 img,.qrv3 svg,.qrv3 video,.qrv3 canvas{max-width:100%;height:auto}
      .qrv3-cartbar{max-width:calc(100dvw - 12px)}
      .qrv3-modal,.qrv-visit-overlay{max-width:100dvw;overflow-x:hidden;overflow-x:clip}
      .qrv-visit-card{min-width:0;max-width:min(620px,calc(100dvw - 20px))}
      @media(max-width:560px){
        .qrv3-hero{grid-template-columns:minmax(0,1fr) auto!important;width:100%}
        .qrv3-hero>div:first-child{min-width:0}
        .qrv3-table{min-width:0!important;max-width:112px}
        .qrv3-table-icon{flex:0 0 auto}
        .qrv3-status{width:100%}
        .qrv3-intro{align-items:flex-start;flex-wrap:wrap}
        .qrv3-sheet{width:100%;max-width:calc(100dvw - 12px)}
        .qrv-visit-overlay{width:100dvw;padding-left:max(10px,env(safe-area-inset-left));padding-right:max(10px,env(safe-area-inset-right))}
        .qrv-visit-card{width:100%;max-width:100%;max-height:calc(100dvh - 20px)}
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
    if (input && document.activeElement === input) {
      input.blur();
      requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
    }
  }

  const observer = new MutationObserver(() => settleMobileVisitOverlay());
  const startObserver = () => {
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    settleMobileVisitOverlay();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  else startObserver();

  window.addEventListener('orientationchange', () => setTimeout(() => window.scrollTo({ left: 0, behavior: 'auto' }), 120));
})();
