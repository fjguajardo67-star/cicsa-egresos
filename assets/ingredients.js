/* Interfaz de revisión por excepciones. FORX consume datos/precios; no edita precios aquí. */
(function(){
  'use strict';
  const C=window.CicsaIngredients;
  const store=window.CicsaIngredientStore({base:FB_BASE,key:FB_KEY,fetcher:(...args)=>fetch(...args),headers:fbAuthHeader,core:C,session:()=>auth.currentUser?.uid||''});
  const old={list:cargarCatalogo,update:fbUpdateDoc,create:fbCreateDoc,editor:abrirEditorProducto,cfdis:guardarCfdisEnStore};
  let cached=new Map(),view='revision',query='',busy=false,publishing=null,timer=null,retries=0,lastStatus='',lastUid='',renderEpoch=0,analysisCache=null,manual=null;
  const money=x=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(x);
  const unit=x=>({pz:'pieza',porcion:'porción',lt:'L',kg:'kg'}[x]||x);
  const clean=p=>{const {id,...data}=p;return data;};
  const $=id=>document.getElementById(id);
  const e=s=>esc(String(s??''));
  function status(message,error=false){
    lastStatus=message;
    const el=$('ingStatus');
    if(el){el.textContent=message;el.classList.toggle('ing-error',error);}
  }
  function reset(){cached=new Map();analysisCache=null;manual=null;_catalogoProductos=[];_catalogoProveedores=[];_catalogoCargado=false;query='';lastStatus='';clearTimeout(timer);retries=0;renderEpoch++;}
  async function load(force=false){
    const uid=auth.currentUser?.uid;
    if(!uid) throw new Error('Inicia sesión para abrir los ingredientes.');
    if(uid!==lastUid){reset();lastUid=uid;}
    if(_catalogoCargado&&!force)return;
    const [docs,suppliers]=await Promise.all([store.list(),fbListCollection(PROVEEDORES_COL)]);
    if(auth.currentUser?.uid!==uid)throw new Error('La sesión cambió.');
    cached=new Map(docs.filter(x=>!x.data._internal&&x.id!=='_forx_sync').map(x=>[x.id,structuredClone(x.data)]));
    _catalogoProductos=[...cached].map(([id,data])=>({id,...structuredClone(data)}));
    analysisCache=null;
    _catalogoProveedores=suppliers;_catalogoCargado=true;
    const meta=docs.find(x=>x.id==='_forx_sync')?.data;
    if(meta?.pending)schedule();
    else if(meta?.publishedAt&&!lastStatus)status('Última publicación para FORX: '+new Date(meta.publishedAt).toLocaleString('es-MX')+'. Recepción en FORX no verificada.');
  }
  async function saveRows(rows){
    const expected=Object.fromEntries(rows.map(p=>[p.id,cached.get(p.id)??null]));
    await store.save(rows,expected);
    analysisCache=null;
    for(const p of rows){cached.set(p.id,structuredClone(clean(p)));const idx=_catalogoProductos.findIndex(x=>x.id===p.id);if(idx<0)_catalogoProductos.push(p);else _catalogoProductos[idx]=p;}
    retries=0;schedule();
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>publish().catch(()=>{}),800);}
  async function publish(){
    if(publishing)return publishing;
    const uid=auth.currentUser?.uid;
    if(!uid)return;
    publishing=(async()=>{
      status('Comprobando los precios pendientes de publicación…');
      try{
        const result=await store.publish();
        if(auth.currentUser?.uid!==uid)return;
        retries=0;
        const conflicts=result.plan?.conflicts.length||result.marker?.conflicts?.length||0;
        status((result.state==='publicado'?'Precios publicados para FORX. ':'Sin publicaciones pendientes. ')+(conflicts?conflicts+' ingrediente(s) requieren revisión; sus precios anteriores se conservaron. ':'')+'La recepción en FORX no está verificada.');
        const newer=await store.get(store.markerPath);
        if(newer?.data.pending)schedule();
        return result;
      }catch(err){
        if(auth.currentUser?.uid===uid){status('Pendiente de publicar para FORX. '+err.message,true);if(![401,403].includes(err.status)&&retries<2){retries++;clearTimeout(timer);timer=setTimeout(()=>publish().catch(()=>{}),2000*retries);}}
        throw err;
      }finally{publishing=null;}
    })();
    return publishing;
  }
  async function hash(text){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
  async function ingest(items,supplier,folio,context={}){
    await load(true);
    const working=[..._catalogoProductos],changes=new Map();
    const result={nuevos:0,actualizados:0,ignorados:[],detalle:[]};
    for(let index=0;index<(items||[]).length;index++){
      const item=items[index];const name=String(item.nombre||'').trim();
      if(!name||!Number.isFinite(Number(item.precio))||Number(item.precio)<=0)continue;
      const input={nombre:name,proveedor:supplier||'',unidad:item.unidad||''};
      let p=C.findProduct(working,input),created=!p;
      const stableKey=[C.norm(supplier),C.norm(name),C.norm(item.unidad)].join('|');
      if(!p){
        const id='p_'+(await hash(stableKey)).slice(0,32);
        if(working.some(x=>x.id===id))throw new Error('Hay más de una coincidencia para «'+name+'». Homologa sus presentaciones antes de reintentar esta factura.');
        p={id,nombre_comercial:name,nombre_normalizado:name,alias_factura:[name],proveedor_nombre:supplier||'',categoria:item.categoria||'',unidad_compra:item.unidad||'',unidad_factura:item.unidad||'',estado:'pendiente',sinonimos_menu:[]};
        created=!cached.has(id);
      }
      const receipt=context.uuid||folio||context.gastoId;
      if(!receipt)throw new Error('Falta el folio o identificador del gasto para registrar sus partidas sin duplicarlas.');
      const observationId=await hash([C.norm(supplier),receipt,C.norm(name),C.norm(item.unidad),context.evidencia==='xml'?index:Number(item.precio)].join('|'));
      const observation={id:observationId,precio:Number(item.precio),fecha:C.date(context.fecha)||'',folio:receipt,proveedor:supplier||'',unidad:item.unidad||'',origen:'factura',evidencia:context.evidencia||'lectura',descripcion:name};
      const updated=C.recordPurchase(p,observation);
      if(JSON.stringify(updated)!==JSON.stringify(p)||created){
        changes.set(updated.id,updated);const at=working.findIndex(x=>x.id===updated.id);if(at<0)working.push(updated);else working[at]=updated;
      }
      if(created)result.nuevos++;else result.actualizados++;
      if(!C.destination(updated).include)result.ignorados.push(name);
      result.detalle.push({nombre:name,destino:updated.nombre_comercial,viaAlias:C.norm(name)!==C.norm(updated.nombre_comercial)});
    }
    if(changes.size)await saveRows([...changes.values()]);
    return result;
  }
  async function ingestXml(cfdis){
    const own=String(rfcPropio()||'').toUpperCase();
    if(!own){status('Configura el RFC de la empresa para identificar automáticamente los productos de XML.',true);return;}
    for(const c of cfdis||[]){
      const stored=(_cfdisStore||[]).find(x=>(x.uuid||'')===(c.uuid||''));
      if(c.ignorado||stored?.ignorado||c.tipo!=='I'||String(c.rfcReceptor||'').toUpperCase()!==own||String(c.rfc||'').toUpperCase()===own)continue;
      await ingest((c.conceptos||[]).map(k=>({nombre:k.desc,precio:k.precio,unidad:unidadDesdeClaveSAT(k.unidad),categoria:k.categoria||''})),c.proveedor,c.uuid||c.folio,{uuid:c.uuid,fecha:c.fecha_hora||c.fecha,evidencia:'xml'});
    }
  }
  async function saveEditor(id,data){
    const current=id?_catalogoProductos.find(p=>p.id===id):null;
    let p={...current,...data,id:id||'p_'+crypto.randomUUID(),forx_destino:$('pcForxDestino')?.value||current?.forx_destino||'auto'};
    if(current){
      p.compras_forx=C.observations(current);
      if(data.fecha_precio===current.fecha_precio?.slice(0,10))p.fecha_precio=current.fecha_precio;
    }
    // El contenido sigue perteneciendo a esta presentación, nunca al grupo entero.
    if(p.estado==='validado'&&C.destination(p).include){
      const calc=C.conversion(p);
      if(!calc.ok)throw new Error(calc.reason);
      if(!C.date(p.fecha_precio))throw new Error('Falta una fecha de precio válida.');
      if(!String(p.ingrediente_generico||'').trim())throw new Error('Escribe el nombre del ingrediente de FORX.');
      if(p.precio_origen==='web'&&!String(p.precio_fuente||'').trim())throw new Error('Indica la fuente del precio provisional.');
    }
    const oldCalc=current&&C.conversion(current),newCalc=C.conversion(p);
    const conversionChanged=current&&newCalc.ok&&(!oldCalc.ok||oldCalc.unit!==newCalc.unit||oldCalc.usable!==newCalc.usable);
    const priceChanged=!current||Number(current.precio_actual)!==Number(p.precio_actual)||current.fecha_precio!==p.fecha_precio||current.precio_origen!==p.precio_origen;
    if(Number(p.precio_actual)>0&&(priceChanged||conversionChanged)){
      const history=C.observations(p);
      const existing=history.find(o=>o.fecha===current?.fecha_precio&&Number(o.precio)===Number(current?.precio_actual));
      const observation={id:existing?.id||'manual:'+crypto.randomUUID(),precio:Number(p.precio_actual),fecha:p.fecha_precio||'',folio:p.factura_origen||'',proveedor:p.proveedor_nombre||'',origen:p.precio_origen||'factura',fuente:p.precio_fuente||'',evidencia:'manual',corregidoPor:auth.currentUser?.uid||''};
      observation.fecha_consulta=p.precio_fecha_consulta||'';observation.vigencia_hasta=p.precio_vigencia_hasta||'';
      if(existing)observation.correcciones=[...(existing.correcciones||[]),{precio:existing.precio,fecha:existing.fecha,conversion_forx:existing.conversion_forx||null,ts:new Date().toISOString()}];
      if(newCalc.ok)observation.conversion_forx={unidad:newCalc.unit,contenido_util:newCalc.usable};
      p=C.recordPurchase(p,observation);
    }
    p.compras_forx=C.observations(p);
    if(current?.ingrediente_id&&C.norm(C.ingredientName(current))!==C.norm(data.ingrediente_generico))throw new Error('Este producto está homologado. Conserva el nombre del grupo; para separarlo usa “Separar presentación”.');
    await saveRows([p]);
    closeProductoModal();await render();status('Producto guardado. La publicación se comprobará automáticamente.');
  }
  function labelState(result){return {excluido:'Solo Egresos',pendiente:'Por verificar',conflicto:'Revisar conflicto',listo:'Verificado'}[result.state];}
  function quickActions(p){
    return `<div class="ing-actions ing-quick"><button type="button" data-action="manual-open" data-id="${e(p.id)}">Homologar manualmente</button><button type="button" data-action="omit" data-id="${e(p.id)}" title="Mover a Solo Egresos sin borrar compras ni historial">Omitir</button></div>`;
  }
  function productDetails(p){
    const calc=C.conversion(p),reason=C.destination(p);
    return `<div class="ing-presentation"><div><strong>${e(p.nombre_comercial)}</strong><p>${e(p.proveedor_nombre||'Proveedor no registrado')} · ${e(p.presentacion||'Presentación sin definir')}</p><p>${calc.ok?money(calc.price)+' / '+e(unit(calc.unit)):e(calc.reason)} · ${e(p.fecha_precio||'Sin fecha de factura')}</p></div><div class="ing-actions"><button type="button" data-action="edit" data-id="${e(p.id)}">Revisar</button>${reason.include?`<button type="button" data-action="omit" data-id="${e(p.id)}">Omitir</button>`:`<button type="button" data-action="include" data-id="${e(p.id)}">Recuperar para revisión</button>`}${p.ingrediente_id?`<button type="button" data-action="split" data-id="${e(p.id)}">Separar presentación</button>`:''}</div></div>`;
  }
  function manualResults(){
    const results=C.manualTargets(_catalogoProductos,manual.sourceId,manual.query);
    if(C.norm(manual.query).length<2)return '<p>Escribe al menos dos letras. La búsqueda incluye nombres de productos y proveedores.</p>';
    return results.length?`<p>${results.length} ingrediente(s) encontrados. Elige solo si representan el mismo alimento.</p><ul class="ing-targets">${results.slice(0,8).map(g=>`<li><div><strong>${e(g.name)}</strong><p>${e(g.products.map(p=>p.nombre_comercial).join(' · '))}</p></div><button type="button" data-action="manual-select" data-id="${e(manual.sourceId)}" data-other="${e(g.targetId)}">Elegir ${e(g.name)}</button></li>`).join('')}</ul>${results.length>8?'<p>Se muestran ocho resultados. Escribe más para acotar la búsqueda.</p>':''}`:'<p>No hay otros ingredientes con ese texto. Prueba otro nombre o recupera primero el producto desde Solo Egresos.</p>';
  }
  function manualPanel(){
    const source=_catalogoProductos.find(p=>p.id===manual.sourceId),target=_catalogoProductos.find(p=>p.id===manual.targetId);
    if(!source)return '';
    const cancel=`<button type="button" data-action="manual-cancel" data-id="${e(source.id)}">Cancelar</button>`;
    let body;
    if(!target){body=`<p>Vincula «${e(C.ingredientName(source))}» con un ingrediente existente aunque sus nombres sean diferentes.</p><label for="ingManualSearch">Buscar ingrediente de destino</label><input id="ingManualSearch" type="search" autocomplete="off" value="${e(manual.query)}"><div id="ingManualResults" aria-live="polite">${manualResults()}</div><div class="ing-actions">${cancel}</div>`;}
    else{
      const groups=C.groups(_catalogoProductos),a=groups.find(g=>g.id===C.groupId(source)),b=groups.find(g=>g.id===C.groupId(target));
      const previouslyDistinct=a.products.some(p=>(p.forx_distintos||[]).some(id=>b.products.some(o=>o.id===id)))||b.products.some(p=>(p.forx_distintos||[]).some(id=>a.products.some(o=>o.id===id)));
      const merged=C.homologate(_catalogoProductos,source.id,target.id),price=C.priceForGroup(C.groups(merged)[0]);
      body=`<p>El nombre principal será <strong>${e(C.ingredientName(target))}</strong>. Se vincularán ${merged.length} presentaciones, no solo las dos seleccionadas.</p><ul class="ing-merge-members">${[a,b].map(g=>`<li><strong>${e(g.name)}</strong><p>${e(g.products.map(p=>p.nombre_comercial).join(' · '))}</p></li>`).join('')}</ul><p>Se conservan compras, conversiones e historiales. Ningún producto se elimina ni se valida por esta acción.</p><p>${price.state==='listo'?'Precio resultante: '+money(price.winner.calc.price)+' / '+e(unit(price.winner.calc.unit))+' · factura '+e(price.winner.fecha)+'.':'El precio requiere revisión: '+e(price.reason||'faltan datos')+'. No se publicará un precio nuevo para este grupo hasta resolverlo.'}</p>${previouslyDistinct?'<p class="ing-reason">Antes marcaste estos grupos como distintos. Confirma únicamente si revisaste esa decisión y son el mismo ingrediente.</p>':''}<div class="ing-actions"><button type="button" class="ing-primary" data-action="manual-confirm" data-id="${e(source.id)}" data-other="${e(target.id)}">Confirmar homologación</button><button type="button" data-action="manual-back" data-id="${e(source.id)}">Elegir otro ingrediente</button>${cancel}</div>`;
    }
    return `<section class="ing-manual" aria-labelledby="ingManualTitle"><h4 id="ingManualTitle" tabindex="-1">Homologar manualmente</h4>${body}<p id="ingManualError" class="ing-error" role="alert">${e(manual.error||'')}</p></section>`;
  }
  function suggestions(p,other){
    return `<div class="ing-match"><p>¿<strong>${e(p.nombre_comercial)}</strong> y <strong>${e(C.ingredientName(other))}</strong> corresponden al mismo ingrediente?</p><div class="ing-actions"><button type="button" class="ing-primary" data-action="merge" data-id="${e(p.id)}" data-other="${e(other.id)}">Sí, homologar</button><button type="button" data-action="different" data-id="${e(p.id)}" data-other="${e(other.id)}">No, son distintos</button></div><details><summary>Comparar detalles</summary>${productDetails(p)}${productDetails(other)}<p>Se conservan ambas presentaciones e historiales. El nombre principal será «${e(C.ingredientName(other))}».</p></details></div>`;
  }
  function markup(){
    let grouped=analysisCache?.grouped,matches=analysisCache?.matches;
    if(!analysisCache){
    grouped=C.groups(_catalogoProductos).map(g=>({...g,result:C.priceForGroup(g)}));
    matches=new Map();const seenPairs=new Set(),suggest=C.createMatcher(_catalogoProductos);
    for(const g of grouped){
      for(const p of g.products){
        const other=suggest(p).find(o=>!seenPairs.has([g.id,C.groupId(o)].sort().join('|')));
        if(other){seenPairs.add([g.id,C.groupId(other)].sort().join('|'));matches.set(g.id,{p,other});break;}
      }
    }
    const collisions=C.publication(_catalogoProductos).conflicts.filter(c=>c.reason.startsWith('Nombre de receta'));
    for(const c of collisions){const g=grouped.find(g=>g.id===c.id);if(g)g.result={state:'conflicto',reason:c.reason,candidates:[]};}
    analysisCache={grouped,matches};
    }
    const needs=g=>g.result.state!=='excluido'&&(g.result.state!=='listo'||g.result.issues?.length||matches.has(g.id));
    const omitted=g=>g.products.filter(p=>!C.destination(p).include);
    const counts={revision:grouped.filter(needs).length,ingredientes:grouped.filter(g=>g.result.state!=='excluido').length,operacion:grouped.filter(g=>omitted(g).length).length};
    const visible=grouped.filter(g=>view==='revision'?needs(g):view==='operacion'?omitted(g).length:g.result.state!=='excluido')
      .map(g=>{if(view!=='operacion')return g;const subset={...g,products:omitted(g)};return {...subset,result:C.priceForGroup(subset)};})
      .filter(g=>C.norm([g.name,...g.products.map(p=>p.nombre_comercial+' '+p.proveedor_nombre)].join(' ')).includes(C.norm(query)));
    const rows=visible.slice(0,100).map(g=>{
      const r=g.result,w=r.winner;
      const choices=r.state==='conflicto'&&(r.candidates||[]).length?r.candidates.map(c=>`<button type="button" data-action="choose" data-id="${e(c.productId)}" data-observation="${e(c.id)}">Usar ${money(c.calc.price)}/${e(unit(c.calc.unit))} · ${e(c.proveedor)} · ${e(c.folio)}</button>`).join(''):'';
      const match=matches.get(g.id),reviews=view==='revision'&&match?suggestions(match.p,match.other):'';
      const active=g.products.find(p=>C.destination(p).include),openManual=manual&&g.products.some(p=>p.id===manual.sourceId);
      const shortcuts=active?(g.products.length===1?quickActions(active):`<div class="ing-actions ing-quick"><button type="button" data-action="manual-open" data-id="${e(active.id)}">Homologar manualmente</button></div>`):'';
      return `<article class="ing-row"><div class="ing-row-head"><div><h3>${e(g.name)}</h3><p>${g.products.length} presentación(es) vinculada(s)</p></div><div class="ing-price">${w?`<strong>${money(w.calc.price)} <span>/ ${e(unit(w.calc.unit))}</span></strong><p>Factura: ${e(w.fecha)}</p>`:'<strong>Sin cambio de precio</strong>'}</div><span class="ing-state ${r.state==='listo'?'ing-ready':''}">${labelState(r)}</span></div>${r.reason?`<p class="ing-reason">${e(r.reason)}</p>`:''}${r.issues?.length?`<p class="ing-reason">Hay presentaciones por verificar. Se usa la última compra válida.</p>`:''}${choices?`<div class="ing-actions">${choices}</div>`:''}${shortcuts}${openManual?manualPanel():''}<details ${r.state==='pendiente'?'open':''}><summary>Ver presentaciones, proveedor e historial</summary>${g.products.map(p=>productDetails(p)+`<details class="ing-history"><summary>Compras de esta presentación</summary>${C.observations(p).map(o=>`<p>${e(o.fecha||'Sin fecha')} · ${money(o.precio)} por presentación · ${e(o.folio||'Sin folio')} · ${e(o.proveedor)}</p>`).join('')||'<p>Sin compras registradas.</p>'}</details>`).join('')}</details>${openManual?'':reviews}</article>`;
    }).join('');
    return `<section class="ing-workspace" aria-label="Ingredientes y precios para FORX"><header class="ing-heading"><div><h2>Ingredientes para FORX</h2><p>Identifica una vez. Las siguientes compras actualizan el precio automáticamente.</p></div><div class="ing-actions"><button type="button" data-action="refresh">Actualizar</button><button type="button" data-action="new" class="ing-primary">Agregar ingrediente</button></div></header><div class="ing-toolbar" role="group" aria-label="Vista del catálogo">${Object.entries({revision:'Por revisar',ingredientes:'Ingredientes',operacion:'Solo Egresos'}).map(([key,label])=>`<button type="button" data-action="view" data-view="${key}" aria-pressed="${key===view}">${label} <span>${counts[key]}</span></button>`).join('')}</div><div class="ing-search"><label for="ingSearch">Buscar ingrediente, producto o proveedor</label><input id="ingSearch" type="search" value="${e(query)}" placeholder="Ej. aderezo ranch" autocomplete="off"></div><div class="ing-publication"><p id="ingStatus" role="status" aria-live="polite">${e(lastStatus||'Los precios se publican al guardar cambios verificados.')}</p><button type="button" data-action="publish">Comprobar publicación</button></div><p class="ing-policy">Limpieza, refrescos y desechables permanecen en Solo Egresos. Autoriza individualmente las excepciones de Grill Express.</p><div id="ingRows">${rows||'<div class="ing-empty"><h3>No hay ingredientes en esta vista</h3><p>Cambia de vista o limpia la búsqueda. Las compras siguen registradas en Egresos.</p></div>'}</div>${visible.length>100?`<p>Mostrando 100 de ${visible.length}. Usa la búsqueda para acotar los resultados.</p>`:''}</section>`;
  }
  async function render(force=false){
    const epoch=++renderEpoch;
    const page=$('page-catalogo-productos');if(!page)return;
    try{await load(force);if(epoch!==renderEpoch)return;page.innerHTML=markup();}
    catch(err){page.innerHTML='<div class="ing-workspace"><h2>No se pudo abrir el catálogo</h2><p role="alert">'+e(err.message)+'</p><button type="button" data-action="refresh">Reintentar</button></div>';}
  }
  async function action(button){
    if(busy)return;
    const action=button.dataset.action,id=button.dataset.id;
    if(action==='view'){manual=null;view=button.dataset.view;await render();return;}
    if(action==='edit'||action==='new'){abrirEditorProducto(id||null);return;}
    if(action==='manual-cancel'){manual=null;await render();$('ingSearch')?.focus();return;}
    busy=true;button.disabled=true;
    try{
      if(action==='refresh'){manual=null;await render(true);return;}
      if(action==='publish'){retries=0;await publish();return;}
      const p=_catalogoProductos.find(x=>x.id===id);
      if(!p)throw new Error('Actualiza el catálogo para encontrar este producto.');
      if(action==='manual-open'){
        if(!C.destination(p).include)throw new Error('Recupera primero el producto desde Solo Egresos.');
        manual={sourceId:id,targetId:'',query:'',error:''};await render();$('ingManualSearch')?.focus();return;
      }else if(action==='manual-select'||action==='manual-back'){
        if(!manual||manual.sourceId!==id)throw new Error('Vuelve a abrir la homologación manual.');
        if(action==='manual-select'&&!C.manualTargets(_catalogoProductos,id,manual.query).some(g=>g.targetId===button.dataset.other))throw new Error('El destino cambió. Busca y selecciona de nuevo el ingrediente.');
        manual.targetId=action==='manual-back'?'':button.dataset.other;manual.error='';await render();$(manual.targetId?'ingManualTitle':'ingManualSearch')?.focus();return;
      }else if(action==='merge'||action==='manual-confirm'){
        if(action==='manual-confirm'&&(!manual||manual.sourceId!==id||manual.targetId!==button.dataset.other))throw new Error('Revisa el destino antes de confirmar.');
        const changes=C.homologate(_catalogoProductos,id,button.dataset.other);
        if(!changes.length)throw new Error('Estos productos ya pertenecen al mismo ingrediente.');
        await saveRows(changes);manual=null;status('Homologación guardada. Se conservaron presentaciones e historiales.');
      }else if(action==='different'){
        const other=_catalogoProductos.find(x=>x.id===button.dataset.other);
        await saveRows([{...p,forx_distintos:[...new Set([...(p.forx_distintos||[]),other.id])]},{...other,forx_distintos:[...new Set([...(other.forx_distintos||[]),p.id])]}]);
        status('Son distintos. Esta sugerencia no volverá a aparecer.');
      }else if(action==='omit'){
        await saveRows([{...p,estado:'ignorado'}]);manual=null;
        status('Producto omitido: '+p.nombre_comercial+'. Se conserva en Solo Egresos; puedes recuperarlo para revisión.');
      }else if(action==='include'||action==='exclude'){
        await saveRows([{...p,forx_destino:action==='include'?'incluir':'excluir',estado:p.estado==='ignorado'?'pendiente':p.estado}]);
        status(action==='include'?'Excepción autorizada. Revisa su conversión antes de publicarla.':'Producto guardado en Solo Egresos. Sus compras se conservan.');
      }else if(action==='split'){
        await saveRows([{...p,ingrediente_id:'ing:'+crypto.randomUUID(),ingrediente_nombre:p.nombre_comercial,ingrediente_generico:p.nombre_comercial,sinonimos_menu:[],estado:'pendiente'}]);
        status('Presentación separada. Revisa su ingrediente antes de volver a publicarla.');
      }else if(action==='choose'){
        const group=C.groups(_catalogoProductos).find(g=>g.id===C.groupId(p)),result=C.priceForGroup(group);
        const selected=result.candidates?.find(c=>c.id===button.dataset.observation);
        if(!selected)throw new Error('El conflicto cambió. Actualiza el catálogo.');
        const pref={fecha:selected.fecha.slice(0,10),id:selected.id,candidatos:result.candidates.map(c=>c.id+':'+c.calc.price).join('|')};
        await saveRows(group.products.map(x=>({...x,forx_preferido:pref})));status('Precio elegido para esta fecha. Una factura posterior prevalecerá automáticamente.');
      }
      await render();
    }catch(err){status(err.message,true);if(manual){manual.error=err.message;$('ingManualError').textContent=err.message;}}
    finally{busy=false;button.disabled=false;}
  }
  // Las rutas heredadas de escritura también generan el pendiente atómicamente.
  fbUpdateDoc=async function(col,id,data){
    if(col!==CATALOGO_COL)return old.update(col,id,data);
    await load();const before=cached.get(id)||{};let updated={...before,...data,id};
    if(Number(updated.precio_actual)>0&&(before.precio_actual!==updated.precio_actual||before.fecha_precio!==updated.fecha_precio)){
      updated.compras_forx=C.observations({...before,id});
      const observationId=await hash([updated.proveedor_nombre,updated.factura_origen,updated.fecha_precio,updated.precio_actual].join('|'));
      updated=C.recordPurchase(updated,{id:'captura:'+observationId,precio:Number(updated.precio_actual),fecha:C.date(updated.fecha_precio)||'',folio:updated.factura_origen||'',proveedor:updated.proveedor_nombre||'',origen:updated.precio_origen||'factura',fuente:updated.precio_fuente||'',evidencia:'lectura'});
    }
    await saveRows([updated]);return true;
  };
  fbCreateDoc=async function(col,data){
    if(col!==CATALOGO_COL)return old.create(col,data);
    await load();const id='p_'+crypto.randomUUID();await saveRows([{id,...data}]);
    // Los tres llamadores heredados agregan el documento a su propia lista al regresar.
    _catalogoProductos=_catalogoProductos.filter(p=>p.id!==id);return id;
  };
  cargarCatalogo=load;
  renderCatalogoProductos=render;
  setCatProdFiltro=function(filter){view=filter==='ignorado'?'operacion':filter==='todos'||filter==='validado'?'ingredientes':'revision';render();};
  abrirSyncMenuModal=function(){view='ingredientes';render().then(()=>publish()).catch(err=>status(err.message,true));};
  confirmarSyncMenu=()=>publish().catch(err=>status(err.message,true));
  window.abrirRevisionIngredientesCfdi=async function(){
    try{await ingestXml(_cfdisStore||[]);view='revision';showPage('catalogo-productos',$('navCatalogoProductos'));await render(true);}
    catch(err){setStatus('satStatus',err.message,'err');}
  };
  cambiarEstadoRapido=async function(id,state){
    const p=_catalogoProductos.find(x=>x.id===id);if(!p)return;
    try{if(state==='validado'&&C.destination(p).include){const calc=C.conversion(p);if(!calc.ok||!C.date(p.fecha_precio))throw new Error(calc.reason||'Falta fecha de factura.');}
      await saveRows([{...p,estado:state}]);await render();
    }catch(err){status(err.message,true);}
  };
  actualizarCalculoPorcion=function(){
    syncUnidadBase();
    const p={nombre_comercial:$('pcNombre').value,precio_actual:$('pcPrecioActual').value,unidad_base:$('pcUnidadBase').value,
      contenido_cantidad:$('pcContCantidad').value,contenido_unidad:$('pcContUnidad').value,piezas_por_presentacion:$('pcPiezasPorPresentacion').value,
      porcion_valor:$('pcPorcionValor').value,porcion_unidad:$('pcPorcionUnidad').value,merma_pct:$('pcMermaPct').value};
    const calc=C.conversion(p);$('pcCalcPreview').style.display='block';
    $('pcCalcBody').textContent=calc.ok?'Contenido utilizable: '+calc.usable.toFixed(3)+' '+unit(calc.unit)+'. Precio para FORX: '+money(calc.price)+' / '+unit(calc.unit)+'.':calc.reason+'. No se publicará hasta completar estos datos.';
  };
  abrirEditorProducto=function(id){
    old.editor(id);const p=_catalogoProductos.find(x=>x.id===id);
    $('pcFechaPrecio').value=p?.fecha_precio?.slice(0,10)||'';
    const modal=$('productoModal');
    modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Verificar producto para FORX');
    $('pcDetalles').style.display='none';
    $('pcDetallesBtn').textContent='▸ Más detalles (proveedor, marca, categoría…)';
    $('pcBtnEliminar').style.display='none';
    $('pcForxControls')?.remove();
    const controls=document.createElement('div');controls.id='pcForxControls';controls.className='ing-editor-destination';
    controls.innerHTML=`<label for="pcForxDestino">Destino del producto</label><select id="pcForxDestino"><option value="auto">Automático según el producto y su categoría</option><option value="incluir">Usar en recetas de FORX (excepción individual)</option><option value="excluir">Solo Egresos</option></select><p>Limpieza, refrescos y desechables se excluyen automáticamente. Autoriza aquí las excepciones de Grill Express. Corregir la conversión modifica la compra mostrada y las futuras; el resto del historial se conserva.</p><p id="pcForxError" role="alert"></p>`;
    modal.querySelector('h3').after(controls);$('pcForxDestino').value=p?.forx_destino||'auto';
    if(!p)$('pcGenerico').value='';
    if(p?.ingrediente_id)$('pcGenerico').value=C.ingredientName(p);
    setTimeout(()=>$('pcNombre').focus(),0);
  };
  guardarCfdisEnStore=async function(cfdis){
    const result=await old.cfdis(cfdis);
    try{await ingestXml(cfdis);}catch(err){status('Los CFDI se guardaron; hay productos pendientes de procesar. '+err.message,true);throw err;}
    return result;
  };
  const page=$('page-catalogo-productos');
  page.addEventListener('click',event=>{const b=event.target.closest('button[data-action]');if(b)return action(b);});
  let searchTimer;
  page.addEventListener('input',event=>{
    if(event.target.id==='ingManualSearch'&&manual){manual.query=event.target.value;manual.targetId='';manual.error='';$('ingManualResults').innerHTML=manualResults();$('ingManualError').textContent='';return;}
    if(event.target.id!=='ingSearch')return;manual=null;query=event.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(async()=>{const pos=event.target.selectionStart;await render();const input=$('ingSearch');input?.focus();try{input?.setSelectionRange(pos,pos);}catch(_){}},200);
  });
  document.addEventListener('keydown',event=>{
    const modal=$('productoModal');
    if(manual&&event.key==='Escape'&&!modal.classList.contains('open')){manual=null;render().then(()=>$('ingSearch')?.focus());return;}
    if(!modal.classList.contains('open'))return;
    if(event.key==='Escape'){closeProductoModal();$('ingSearch')?.focus();}
    if(event.key==='Tab'){const nodes=[...modal.querySelectorAll('input,select,button,[href]')].filter(x=>!x.disabled&&x.type!=='hidden'&&x.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  });
  window.addEventListener('online',()=>{retries=0;schedule();});
  auth.onAuthStateChanged(user=>{if(user?.uid!==lastUid){reset();lastUid=user?.uid||'';}if(user)timer=setTimeout(()=>load(true).catch(()=>{}),4000);});
  window.CicsaCatalog={ingest,ingestXml,saveEditor,publish,load,store,render};
})();
