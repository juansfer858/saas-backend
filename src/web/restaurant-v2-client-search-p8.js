/* VANTIX_RESTAURANT_V2_CLIENT_SEARCH_P8 */
(()=>{'use strict';
  const MARKER='VANTIX_RESTAURANT_V2_CLIENT_SEARCH_P8';
  const input=document.getElementById('menuSearch');const search=document.getElementById('menuSearchButton');const clear=document.getElementById('menuSearchClear');const list=document.getElementById('menuList');const empty=document.getElementById('menuSearchEmpty');
  if(!input||!list)return;
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  let query='';let switching=false;
  function showAllCategory(){if(!query||switching)return;const all=document.querySelector('#categoryNav [data-category="TODO"]');if(!all||all.getAttribute('aria-selected')==='true')return;switching=true;all.click();queueMicrotask(()=>{switching=false;apply()})}
  function apply(){query=normalize(input.value);if(clear)clear.hidden=!query;if(query)showAllCategory();const rows=[...list.querySelectorAll('.p7-row')];let visible=0;rows.forEach(row=>{const match=!query||normalize(row.textContent).includes(query);row.hidden=!match;if(match)visible+=1});if(empty){empty.hidden=!query||visible>0||!rows.length;empty.textContent=query&&!visible?'No encontramos productos con esa búsqueda.':''}}
  input.addEventListener('input',apply);input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();apply()}});search?.addEventListener('click',()=>{apply();input.focus()});
  clear?.addEventListener('click',()=>{input.value='';query='';apply();input.focus()});
  document.getElementById('categoryNav')?.addEventListener('click',event=>{if(!switching&&query&&event.target.closest?.('[data-category]')){input.value='';query='';if(clear)clear.hidden=true;if(empty)empty.hidden=true}});
  const observer=new MutationObserver(apply);observer.observe(list,{childList:true,subtree:true});apply();window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
  window.VantixGCRestaurantClientSearchP8=Object.freeze({marker:MARKER,searchesNameAndCategory:true,allCategoriesOnSearch:true,visibleSearchButton:true});
})();
