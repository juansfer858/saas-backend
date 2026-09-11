(()=>{
  'use strict';
  const READY='VANTIXGC_RESTAURANT_AUTOPEDIDO_V1';
  function txt(el,value){if(el)el.textContent=value}
  function enhance(){
    const main=document.querySelector('main');
    if(!main||document.querySelector('#autopedido'))return;

    const kicker=document.querySelector('.hero .kicker');
    txt(kicker,'Autoatención + operación conectada');
    const heroP=document.querySelector('.hero p');
    txt(heroP,'Tu cliente puede consultar la carta, hacer su propio pedido y gestionar el pago desde la mesa. El pedido entra a Producción, Caja y el resto de la operación sin volver a digitarlo ni hacer esperar al cliente.');

    const proof=[...document.querySelectorAll('.hero .proof span')];
    if(proof[0])proof[0].textContent='Autopedido desde la mesa';
    if(proof[1])proof[1].textContent='Menos esperas y filas';
    if(proof[2])proof[2].textContent='Menos carga para el personal';

    const nav=document.querySelector('.nav');
    if(nav&&!nav.querySelector('a[href="#autopedido"]')){
      const a=document.createElement('a');a.href='#autopedido';a.textContent='Autoatención';
      const plans=nav.querySelector('a[href="#membresia"]');nav.insertBefore(a,plans||nav.firstChild);
    }

    const section=document.createElement('section');
    section.id='autopedido';
    section.className='vr-autopedido';
    section.innerHTML=`<div class="wrap vr-autopedido-grid">
      <div class="vr-autopedido-copy">
        <div class="eyebrow">Autopedido · autoatención real</div>
        <h2>El cliente hace su pedido. Tu equipo se concentra en atender mejor.</h2>
        <p>El QR no es el producto: es la puerta de entrada. El cliente abre la carta, elige, envía el pedido y puede avanzar hasta la cuenta y el pago sin esperar a que un mesero vuelva a la mesa. VantixGC conecta ese recorrido con Producción y Caja para reducir pasos manuales.</p>
        <div class="vr-auto-impact">
          <div><b>Menos espera</b><span>El cliente no depende de encontrar al mesero para pedir o solicitar la cuenta.</span></div>
          <div><b>Más capacidad operativa</b><span>El personal dedica menos tiempo a tomar pedidos repetitivos y más a servir.</span></div>
          <div><b>Menos doble digitación</b><span>El pedido entra al flujo operativo sin volver a copiarlo en otra pantalla.</span></div>
        </div>
        <div class="vr-auto-cta"><a class="btn primary" href="/restaurantes/demo">Ver el flujo interactivo</a><a class="btn" href="#membresia">Ver planes con autoatención</a></div>
      </div>
      <div class="vr-auto-flow" aria-label="Flujo de autoatención del cliente">
        <div class="vr-auto-flow-title"><strong>De la mesa a producción</strong><span>Automatizado</span></div>
        <div class="vr-auto-step"><i>1</i><div><b>Consulta la carta</b><p>El cliente entra desde su mesa y ve productos, precios y opciones disponibles.</p></div></div>
        <div class="vr-auto-step"><i>2</i><div><b>Hace su propio pedido</b><p>Selecciona productos y envía la orden sin esperar a que alguien la transcriba.</p></div></div>
        <div class="vr-auto-step"><i>3</i><div><b>Producción recibe</b><p>Cocina, Barra o Postres reciben el pedido dentro del mismo flujo operativo.</p></div></div>
        <div class="vr-auto-step"><i>4</i><div><b>Cuenta y pago</b><p>El cliente puede solicitar su cuenta y gestionar el pago según los métodos habilitados por el restaurante.</p></div></div>
        <div class="vr-auto-summary">Resultado: menos filas, menos esperas y menos tareas repetitivas para el equipo del restaurante.</div>
      </div>
    </div>`;

    const product=document.querySelector('#producto');
    if(product)main.insertBefore(section,product);else main.appendChild(section);

    [...document.querySelectorAll('.plan li')].forEach(li=>{
      if(/Autoatención: pedido y pago desde la mesa/i.test(li.textContent||''))li.classList.add('vr-autopedido-plan-highlight');
    });
    document.documentElement.dataset.vrAutopedido=READY;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',enhance,{once:true});else enhance();
})();
