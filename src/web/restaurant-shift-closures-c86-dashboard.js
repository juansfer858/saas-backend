/* VANTIX_RESTAURANT_SHIFT_CLOSURES_C86_DASHBOARD */
(()=>{'use strict';
const MARKER='VANTIX_RESTAURANT_SHIFT_CLOSURES_C86_DASHBOARD';
let observer=null;
function install(){const actions=document.querySelector('[data-dashboard-actions="single-owner-v1"]');if(!actions)return false;const restaurant=actions.querySelector('[data-restaurant-dashboard-entry]');if(!restaurant)return false;if(actions.querySelector('[data-c86-closures]'))return true;const button=document.createElement('button');button.className='btn';button.type='button';button.dataset.c86Closures='1';button.textContent='Cierres';button.addEventListener('click',()=>window.location.assign('/app/cierres'));restaurant.insertAdjacentElement('afterend',button);document.documentElement.dataset.restaurantClosuresC86='1';return true}
function start(){install();if(observer)return;observer=new MutationObserver(()=>install());observer.observe(document.body,{childList:true,subtree:true});setTimeout(()=>{install()},400)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
window.VantixGCRestaurantClosuresDashboardC86=Object.freeze({marker:MARKER,path:'/app/cierres'});
})();
