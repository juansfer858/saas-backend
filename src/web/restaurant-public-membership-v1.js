(()=>{
  'use strict';
  const READY='VANTIXGC_RESTAURANT_SINGLE_MEMBERSHIP_V1';

  function text(el,value){if(el)el.textContent=value}
  function findText(root,selector,re){return [...root.querySelectorAll(selector)].find(el=>re.test(el.textContent||''))}

  function updateBand(){
    const stats=[...document.querySelectorAll('.band .stat')];
    if(stats[1]){text(stats[1].querySelector('strong'),'1 membresía');text(stats[1].querySelector('span'),'todas las herramientas incluidas')}
    if(stats[3]){text(stats[3].querySelector('strong'),'LAN + Cloud');text(stats[3].querySelector('span'),'incluido en la membresía')}
  }

  function replaceMembership(){
    const section=document.querySelector('#membresia');
    if(!section)return;
    const wrap=section.querySelector('.wrap')||section;
    wrap.innerHTML=`
      <div class="section-head vr-membership-head">
        <div class="eyebrow">Una sola membresía · todo incluido</div>
        <h2>No escoges módulos. Recibes VantixGC Restaurantes completo.</h2>
        <p class="lead">Una sola tarifa por sede para operar salón, producción, caja, autoatención, inventario, domicilios, administración y continuidad local. La implementación se cobra una sola vez según la complejidad de la sede.</p>
      </div>
      <div class="vr-membership-grid">
        <article class="plan featured vr-membership-card">
          <span class="plan-ribbon">Todo incluido</span>
          <small>VantixGC Restaurantes</small>
          <h3>Membresía completa</h3>
          <p class="plan-desc">Todo el software del restaurante, sin niveles ni funciones bloqueadas.</p>
          <div class="price"><strong>$159.900</strong><span>COP / mes</span></div>
          <div class="price-note">por sede activa · después de la prueba</div>
          <ul class="vr-membership-features">
            <li>Mesas, meseros, pedidos y personas</li>
            <li>Producción / KDS por estaciones</li>
            <li>Caja POS, turnos y división de cuenta</li>
            <li>Carta, inventario, clientes y crédito</li>
            <li>Autopedido y autoatención desde la mesa</li>
            <li>Domicilios</li>
            <li>Empleados, dispositivos y métodos de pago</li>
            <li>Reportes y administración</li>
            <li>Edge · LAN + Cloud y continuidad local</li>
            <li>Actualizaciones del SaaS</li>
          </ul>
          <a class="btn primary" href="/restaurantes/crear">Crear mi restaurante</a>
        </article>
        <aside class="vr-implementation-card">
          <div class="eyebrow">Puesta en marcha</div>
          <h3>Implementación desde $800.000 COP</h3>
          <p class="vr-implementation-once">Pago único · no se repite cada mes</p>
          <p>Preparamos VantixGC para la operación real de tu sede y acompañamos el arranque.</p>
          <ul>
            <li>Configuración de sede y salón</li>
            <li>Carga inicial de carta y estaciones</li>
            <li>Caja y métodos de pago</li>
            <li>Empleados y permisos iniciales</li>
            <li>Autoatención y QR de acceso</li>
            <li>Impresión y Edge cuando aplique</li>
            <li>Capacitación y acompañamiento de salida</li>
          </ul>
          <div class="vr-implementation-note"><b>Equipos físicos aparte.</b><span>Impresoras, computadores, tablets, hardware Edge y desplazamientos especiales se cotizan cuando sean necesarios.</span></div>
        </aside>
      </div>
      <p class="plans-note"><b>14 días gratis y sin tarjeta.</b> No hay cobro automático al terminar la prueba. Cada sede activa usa la misma membresía de $159.900 COP al mes.</p>`;
  }

  function updateLocal(){
    const local=document.querySelector('#local');
    if(!local)return;
    const p=[...local.querySelectorAll('p')];
    if(p[0])p[0].textContent='VantixGC Edge y LAN + Cloud hacen parte de la membresía completa. Cuando la sede necesita operación local, Caja, KDS y tablets pueden trabajar por la red del restaurante mientras VantixGC Cloud centraliza Core, usuarios, administración y sincronización.';
    const strong=local.querySelector('p strong');
    if(strong)strong.textContent='Las capacidades preparadas para Edge continúan localmente ante una caída de Internet y sincronizan al recuperar conexión.';
    const cta=local.querySelector('a.btn');
    if(cta){cta.href='/restaurantes/crear';cta.textContent='Crear mi restaurante'}
  }

  function updateSteps(){
    const steps=[...document.querySelectorAll('.steps .step')];
    if(steps[3]){
      text(steps[3].querySelector('b'),'Activa la membresía');
      text(steps[3].querySelector('p'),'Después de probar, continúas con una sola membresía y todas las herramientas incluidas.');
    }
  }

  function updateFaq(){
    const faq=document.querySelector('.faq-list');
    if(!faq)return;
    const plan=findText(faq,'details',/¿Qué plan me conviene\?/i);
    if(plan){text(plan.querySelector('summary'),'¿Qué incluye la membresía?');text(plan.querySelector('p'),'Incluye todo VantixGC Restaurantes: operación de mesas y pedidos, KDS, Caja, división, inventario, domicilios, clientes, crédito, autoatención, reportes, administración, dispositivos y capacidades Edge · LAN + Cloud.')}
    const change=findText(faq,'details',/¿Puedo cambiar de plan después\?/i);
    if(change){text(change.querySelector('summary'),'¿La implementación se paga cada mes?');text(change.querySelector('p'),'No. La implementación es un cobro de puesta en marcha que comienza desde $800.000 COP y se paga una sola vez. La mensualidad del software es $159.900 COP por sede activa.')}
    const install=findText(faq,'details',/¿Tengo que instalar algo para probar\?/i);
    if(install)text(install.querySelector('p'),'No. Puedes usar el demo interactivo y la prueba en navegador. Si tu operación requiere Edge local, impresión o equipos físicos, esa puesta en marcha se define durante la implementación.');
    const internet=findText(faq,'details',/¿Qué pasa si se cae Internet\?/i);
    if(internet)text(internet.querySelector('p'),'Las capacidades preparadas para Edge pueden continuar contra el runtime local y sincronizar con el Core cuando regresa Internet. Los servicios externos que necesariamente usan nube siguen requiriendo conectividad.');
    const billing=findText(faq,'details',/¿Me cobran automáticamente/i);
    if(billing)text(billing.querySelector('p'),'No. La prueba no genera un cobro automático. Antes de activar la membresía se confirman la mensualidad, la implementación y cualquier equipo o servicio adicional que realmente necesite la sede.');
  }

  function updateFinal(){
    const final=document.querySelector('.final-card');
    if(!final)return;
    text(final.querySelector('h2'),'Prueba el restaurante completo. Después sólo decides si continúas.');
    text(final.querySelector('p'),'No hay módulos por escoger: la membresía incluye todas las herramientas de VantixGC Restaurantes por $159.900 COP al mes por sede.');
  }

  function updateNavigationAndMeta(){
    const nav=[...document.querySelectorAll('a[href="#membresia"]')];
    nav.forEach(a=>a.textContent='Membresía');
    document.title='VantixGC Restaurantes · Una sola membresía, todo incluido';
    const desc=document.querySelector('meta[name="description"]');
    if(desc)desc.setAttribute('content','VantixGC Restaurantes: una sola membresía de $159.900 COP al mes por sede con operación completa, autopedido, Caja, KDS, inventario, domicilios, administración y Edge · LAN + Cloud.');
  }

  function run(){
    updateBand();
    replaceMembership();
    updateLocal();
    updateSteps();
    updateFaq();
    updateFinal();
    updateNavigationAndMeta();
    document.documentElement.dataset.vantixMembership=READY;
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run();
})();