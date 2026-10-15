/* Productos comprados: catálogo e historial de precio y cantidad, de los XML y de las lecturas.
   Egresos ya no publica a FORX; datos/precios queda congelado con sus últimos valores. */
(function(){
  'use strict';
  const C=window.CicsaIngredients;
  const store=window.CicsaIngredientStore({base:FB_BASE,key:FB_KEY,fetcher:(...args)=>fetch(...args),headers:fbAuthHeader,core:C,session:()=>auth.currentUser?.uid||''});
  const old={list:cargarCatalogo,update:fbUpdateDoc,create:fbCreateDoc,editor:abrirEditorProducto,cfdis:guardarCfdisEnStore};
  // La vista arranca en «Productos», no en «Por revisar»: sin la compuerta de validado esa
  // pestaña solo junta lo que no tiene compras o tiene una homologación sugerida, y casi
  // siempre está vacía. Abrir la pantalla en una lista vacía la hace parecer rota.
  let cached=new Map(),view='ingredientes',query='',busy=false,timer=null,lastStatus='',lastUid='',renderEpoch=0,analysisCache=null,manual=null;
  // Filtros de la pestaña Consulta. El texto lo comparte con el buscador de las otras vistas:
  // escribir «arroz» en Productos y cambiar a Consulta debe seguir hablando de arroz.
  let consulta={proveedor:'',desde:'',hasta:'',producto:''};
  const money=x=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(x);
  const unit=x=>({pz:'pieza',porcion:'porción',lt:'L',kg:'kg'}[x]||x);
  const unitN=(x,n)=>n===1?unit(x):({pz:'piezas',porcion:'porciones'}[x]||unit(x));
  const clean=p=>{const {id,...data}=p;return data;};
  const $=id=>document.getElementById(id);
  const e=s=>esc(String(s??''));
  function status(message,error=false){
    lastStatus=message;
    const el=$('ingStatus');
    if(el){el.textContent=message;el.classList.toggle('ing-error',error);}
  }
  function reset(){cached=new Map();analysisCache=null;manual=null;consulta={proveedor:'',desde:'',hasta:'',producto:''};_catalogoProductos=[];_catalogoProveedores=[];_catalogoCargado=false;query='';lastStatus='';clearTimeout(timer);renderEpoch++;}
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
    // El documento _forx_sync marcaba lo que faltaba publicar; ya no hay publicación que agendar.
    // Se deja donde está, sin leerlo: borrarlo sería una escritura a datos de producción por una
    // limpieza cosmética.
  }
  async function saveRows(rows){
    const expected=Object.fromEntries(rows.map(p=>[p.id,cached.get(p.id)??null]));
    await store.save(rows,expected);
    analysisCache=null;
    for(const p of rows){cached.set(p.id,structuredClone(clean(p)));const idx=_catalogoProductos.findIndex(x=>x.id===p.id);if(idx<0)_catalogoProductos.push(p);else _catalogoProductos[idx]=p;}
  }
  // Aquí vivían schedule() y publish(): cada guardado agendaba una escritura a datos/precios
  // para FORX. Egresos ya no publica. El documento se deja como está —congelado, no
  // borrado— para que lo que todavía lo lea no se quede sin nada.
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
      // La cantidad y el SKU van en la OBSERVACIÓN, no solo en el producto: el producto guarda
      // el último valor, y lo que sirve para un histórico es cuánto se compró en cada factura y
      // con qué clave la facturó el proveedor ese día. Ausente = no se sabe, que no es cero.
      const cantidad=Number(item.cantidad), sku=String(item.codigo_proveedor||'').trim();
      const observation={id:observationId,precio:Number(item.precio),fecha:C.date(context.fecha)||'',folio:receipt,proveedor:supplier||'',unidad:item.unidad||'',origen:'factura',evidencia:context.evidencia||'lectura',descripcion:name,
        ...(Number.isFinite(cantidad)&&cantidad>0?{cantidad}:{}),...(sku?{codigo_proveedor:sku}:{})};
      const updated=C.recordPurchase(p,observation);
      // Clasificación operativa separada del ingrediente y de su conversión.
      // Una compra antigua no reemplaza los metadatos de la presentación vigente.
      if(!p.fecha_precio||(C.date(context.fecha)&&C.date(context.fecha)>=p.fecha_precio)){
        if(item.tipo_alimento)updated.tipo_alimento=item.tipo_alimento;
        if(item.codigo_proveedor)updated.codigo_proveedor=item.codigo_proveedor;
        if(item.categoria)updated.categoria_operativa=item.categoria;
      }
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
      // cantidad y sku venían en el concepto y se perdían aquí: el mapeo solo pasaba cuatro
      // campos. El XML es la fuente exacta de los dos — dato fiscal, no leído por IA.
      await ingest((c.conceptos||[]).map(k=>({nombre:k.desc,precio:k.precio,cantidad:k.cantidad,codigo_proveedor:k.sku||'',unidad:unidadDesdeClaveSAT(k.unidad),categoria:k.categoria||''})),c.proveedor,c.uuid||c.folio,{uuid:c.uuid,fecha:c.fecha_hora||c.fecha,evidencia:'xml'});
    }
  }
  async function saveEditor(id,data){
    const current=id?_catalogoProductos.find(p=>p.id===id):null;
    let p={...current,...data,id:id||'p_'+crypto.randomUUID()};
    if(current){
      p.compras_forx=C.observations(current);
      if(data.fecha_precio===current.fecha_precio?.slice(0,10))p.fecha_precio=current.fecha_precio;
    }
    // Aquí estaba la compuerta de «validado»: para dar por bueno un producto exigía su unidad de
    // costeo, su conversión, una fecha y el nombre del ingrediente de FORX. Es lo que producía los
    // «Por verificar». Un producto comprado no necesita que nadie lo apruebe para existir.
    // Una fecha de precio inválida sí seguía importando y se sigue exigiendo abajo, al registrar
    // la compra: sin fecha, el historial no se puede ordenar.
    const priceChanged=!current||Number(current.precio_actual)!==Number(p.precio_actual)||current.fecha_precio!==p.fecha_precio||current.precio_origen!==p.precio_origen;
    if(Number(p.precio_actual)>0&&priceChanged){
      const history=C.observations(p);
      const existing=history.find(o=>o.fecha===current?.fecha_precio&&Number(o.precio)===Number(current?.precio_actual));
      const observation={id:existing?.id||'manual:'+crypto.randomUUID(),precio:Number(p.precio_actual),fecha:p.fecha_precio||'',folio:p.factura_origen||'',proveedor:p.proveedor_nombre||'',origen:p.precio_origen||'factura',fuente:p.precio_fuente||'',evidencia:'manual',corregidoPor:auth.currentUser?.uid||''};
      observation.fecha_consulta=p.precio_fecha_consulta||'';observation.vigencia_hasta=p.precio_vigencia_hasta||'';
      if(existing)observation.correcciones=[...(existing.correcciones||[]),{precio:existing.precio,fecha:existing.fecha,conversion_forx:existing.conversion_forx||null,ts:new Date().toISOString()}];
      p=C.recordPurchase(p,observation);
    }
    p.compras_forx=C.observations(p);
    if(current?.ingrediente_id&&C.norm(C.ingredientName(current))!==C.norm(data.ingrediente_generico))throw new Error('Este producto está homologado. Conserva el nombre del grupo; para separarlo usa “Separar presentación”.');
    await saveRows([p]);
    closeProductoModal();await render();status('Producto guardado. La publicación se comprobará automáticamente.');
  }
  function labelState(result){return {excluido:'Omitido',pendiente:'Por verificar',conflicto:'Revisar conflicto',listo:'Verificado'}[result.state];}
  function quickActions(p){
    return `<div class="ing-actions ing-quick"><button type="button" data-action="manual-open" data-id="${e(p.id)}">Homologar manualmente</button><button type="button" data-action="omit" data-id="${e(p.id)}" title="Sacarlo de la lista sin borrar compras ni historial">Omitir</button></div>`;
  }
  function productDetails(p){
    const reason=C.destination(p);
    const ultimo=Number(p.precio_actual)>0?money(p.precio_actual)+' por presentación':'Sin precio registrado';
    return `<div class="ing-presentation"><div><strong>${e(p.nombre_comercial)}</strong><p>${e(p.proveedor_nombre||'Proveedor no registrado')} · ${e(p.presentacion||'Presentación sin definir')}</p><p>${e(ultimo)} · ${e(p.fecha_precio||'Sin fecha de factura')}</p></div><div class="ing-actions"><button type="button" data-action="edit" data-id="${e(p.id)}">Revisar</button>${reason.include?`<button type="button" data-action="omit" data-id="${e(p.id)}">Omitir</button>`:`<button type="button" data-action="include" data-id="${e(p.id)}">Recuperar para revisión</button>`}${p.ingrediente_id?`<button type="button" data-action="split" data-id="${e(p.id)}">Separar presentación</button>`:''}</div></div>`;
  }
  function manualResults(){
    const results=C.manualTargets(_catalogoProductos,manual.sourceId,manual.query);
    if(C.norm(manual.query).length<2)return '<p>Escribe al menos dos letras. La búsqueda incluye nombres de productos y proveedores.</p>';
    return results.length?`<p>${results.length} ingrediente(s) encontrados. Elige solo si representan el mismo alimento.</p><ul class="ing-targets">${results.slice(0,8).map(g=>`<li><div><strong>${e(g.name)}</strong><p>${e(g.products.map(p=>p.nombre_comercial).join(' · '))}</p></div><button type="button" data-action="manual-select" data-id="${e(manual.sourceId)}" data-other="${e(g.targetId)}">Elegir ${e(g.name)}</button></li>`).join('')}</ul>${results.length>8?'<p>Se muestran ocho resultados. Escribe más para acotar la búsqueda.</p>':''}`:'<p>No hay otros ingredientes con ese texto. Prueba otro nombre o recupera primero el producto desde Omitidos.</p>';
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
      body=`<p>El nombre principal será <strong>${e(C.ingredientName(target))}</strong>. Se vincularán ${merged.length} presentaciones, no solo las dos seleccionadas.</p><ul class="ing-merge-members">${[a,b].map(g=>`<li><strong>${e(g.name)}</strong><p>${e(g.products.map(p=>p.nombre_comercial).join(' · '))}</p></li>`).join('')}</ul><p>Se conservan las compras y los historiales de las dos. Ningún producto se elimina.</p><p>${price.state==='listo'?'Última compra del grupo: '+money(price.winner.precio)+' por presentación · '+e(price.winner.fecha)+'.':e(price.reason||'Sin compras registradas todavía')+'.'}</p>${previouslyDistinct?'<p class="ing-reason">Antes marcaste estos grupos como distintos. Confirma únicamente si revisaste esa decisión y son el mismo ingrediente.</p>':''}<div class="ing-actions"><button type="button" class="ing-primary" data-action="manual-confirm" data-id="${e(source.id)}" data-other="${e(target.id)}">Confirmar homologación</button><button type="button" data-action="manual-back" data-id="${e(source.id)}">Elegir otro ingrediente</button>${cancel}</div>`;
    }
    return `<section class="ing-manual" aria-labelledby="ingManualTitle"><h4 id="ingManualTitle" tabindex="-1">Homologar manualmente</h4>${body}<p id="ingManualError" class="ing-error" role="alert">${e(manual.error||'')}</p></section>`;
  }
  function suggestions(p,other){
    return `<div class="ing-match"><p>¿<strong>${e(p.nombre_comercial)}</strong> y <strong>${e(C.ingredientName(other))}</strong> corresponden al mismo ingrediente?</p><div class="ing-actions"><button type="button" class="ing-primary" data-action="merge" data-id="${e(p.id)}" data-other="${e(other.id)}">Sí, homologar</button><button type="button" data-action="different" data-id="${e(p.id)}" data-other="${e(other.id)}">No, son distintos</button></div><details><summary>Comparar detalles</summary>${productDetails(p)}${productDetails(other)}<p>Se conservan ambas presentaciones e historiales. El nombre principal será «${e(C.ingredientName(other))}».</p></details></div>`;
  }
  // ─── Consulta: filtros, gráfica y tabla del historial de compras ─────────────
  // Tres ranuras del palette categórico validado (azul, naranja, aqua). Se topa en tres a
  // propósito: con más, dos líneas que se cruzan dejan de distinguirse para quien no ve bien
  // el color, y la tabla de abajo ya carga todo lo que la gráfica no alcanza a dibujar.
  const SERIE_COLOR=['#2a78d6','#eb6834','#1baf7a'],SERIE_TOPE=3;
  const corto=v=>Number.isInteger(v)?new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',maximumFractionDigits:0}).format(v):money(v);
  const plural=(n,uno,varios)=>n.toLocaleString('es-MX')+' '+(n===1?uno:varios);
  const fecha=d=>{const s=String(d||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return s;const [a,m,x]=s.split('-');return x+'/'+m+'/'+a;};
  // Un día a número para poder colocarlo en el eje. Mediodía UTC evita que el huso lo corra un día.
  const dayNum=d=>Math.floor(Date.parse(d+'T12:00:00Z')/86400000);
  // Marcas del eje en números con los que se piensa ($50, $100, $250…), no en los extremos
  // crudos del rango, que salen en $513 y nadie lee.
  function ticks(min,max,tope=4){
    const rango=max-min;
    if(!(rango>0))return [min];
    const marcas=paso=>{const inicio=Math.ceil(min/paso)*paso,out=[];
      for(let i=0;;i++){const v=inicio+i*paso;if(v>max+paso/1e9)break;out.push(v===0?0:v);}
      return out;};
    // Se prueba la escalera 1·2·2.5·5 por década de menor a mayor y se toma el primer paso que
    // no pase del tope. Buscar un paso «parecido al rango/2» daba una sola marca y caía al
    // extremo crudo del eje: $905 y $513, que es justo lo que se quería evitar.
    for(let exp=Math.floor(Math.log10(rango))-1;exp<=Math.ceil(Math.log10(rango))+1;exp++)
      for(const m of [1,2,2.5,5]){
        const out=marcas(m*Math.pow(10,exp));
        if(out.length>=2&&out.length<=tope)return out;
      }
    return [min,max];
  }
  function chart(series){
    const dibujables=series.slice(0,SERIE_TOPE).map((s,i)=>({...s,color:SERIE_COLOR[i]}));
    const puntos=dibujables.flatMap(s=>s.puntos);
    if(puntos.length<2)return '';
    const W=680,H=260,L=64,R=120,T=18,B=34;
    const xs=puntos.map(p=>dayNum(p.dia)),ys=puntos.map(p=>p.precio);
    const x0=Math.min(...xs),x1=Math.max(...xs);
    let y0=Math.min(...ys),y1=Math.max(...ys);
    // El eje no arranca en cero: la pregunta es cuánto se movió el precio, y pegarlo al cero
    // aplana justo eso. A cambio, el eje va rotulado en los dos extremos para que nadie lea
    // una subida del 4% como si fuera del 400%.
    const margen=(y1-y0)||Math.abs(y1)||1;y0-=margen*0.12;y1+=margen*0.12;
    const px=v=>L+(x1===x0?(W-L-R)/2:((dayNum(v)-x0)/(x1-x0))*(W-L-R));
    const py=v=>T+(1-(v-y0)/(y1-y0))*(H-T-B);
    const rejilla=ticks(y0,y1).map(v=>{const y=py(v);
      return `<line x1="${L}" y1="${y.toFixed(1)}" x2="${W-R}" y2="${y.toFixed(1)}" stroke="#e3e9e5" stroke-width="1"></line>`
        +`<text x="${L-8}" y="${(y+4).toFixed(1)}" text-anchor="end" fill="#51665d" font-size="11">${e(corto(v))}</text>`;}).join('');
    const ejeX=[x0,x1].filter((v,i,a)=>i===0||v!==a[0]).map((v,i,a)=>{
      const d=new Date(v*86400000).toISOString().slice(0,10);
      return `<text x="${(i===0&&a.length>1?L:i===0?L+(W-L-R)/2:W-R).toFixed(1)}" y="${H-10}" text-anchor="${i===0&&a.length>1?'start':a.length>1?'end':'middle'}" fill="#51665d" font-size="11">${e(fecha(d))}</text>`;}).join('');
    const lineas=dibujables.map(s=>{
      const d=s.puntos.map((p,i)=>(i?'L':'M')+px(p.dia).toFixed(1)+' '+py(p.precio).toFixed(1)).join(' ');
      const marcas=s.puntos.map(p=>`<circle cx="${px(p.dia).toFixed(1)}" cy="${py(p.precio).toFixed(1)}" r="4" fill="${s.color}" stroke="#fff" stroke-width="2"><title>${e(fecha(p.dia)+' · '+money(p.precio)+' · '+s.presentacion)}</title></circle>`).join('');
      const fin=s.puntos[s.puntos.length-1];
      // Etiqueta al final de la línea: la identidad no puede depender solo del color.
      const etiqueta=`<text x="${(W-R+8).toFixed(1)}" y="${(py(fin.precio)+4).toFixed(1)}" fill="#1b3a2c" font-size="11" font-weight="600">${e(money(fin.precio))}</text>`;
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>${marcas}${etiqueta}`;
    }).join('');
    const leyenda=dibujables.map(s=>`<li><span class="ing-key" style="background:${s.color}"></span>${e(s.presentacion||'Sin nombre')}${s.proveedor?' · '+e(s.proveedor):''}</li>`).join('');
    const sobran=series.length>SERIE_TOPE?`<p>Se dibujan ${SERIE_TOPE} de ${series.length} presentaciones. Acota la búsqueda o el proveedor para ver las demás; la tabla de abajo las trae todas.</p>`:'';
    // Cada línea va en la unidad en que la factura el proveedor: una en pesos por caja y otra
    // en pesos por litro caben en el mismo eje pero no son comparables entre sí. Decirlo.
    const aviso=`<p>Cada línea usa la unidad con la que la factura su proveedor. Sirven para ver cómo se movió cada presentación, no para compararlas entre ellas.</p>`;
    return `<figure class="ing-chart"><figcaption>Precio unitario de cada presentación, en el tiempo</figcaption>`
      +`<svg viewBox="0 0 ${W} ${H}" role="img" width="100%" aria-label="Gráfica de precio por presentación. Los mismos datos están en la tabla de abajo.">`
      +`<line x1="${L}" y1="${T}" x2="${L}" y2="${H-B}" stroke="#cfd9d3" stroke-width="1"></line>${rejilla}${ejeX}${lineas}</svg>`
      +`<ul class="ing-legend">${leyenda}</ul>${aviso}${sobran}</figure>`;
  }
  function consultaMarkup(){
    const todas=C.purchaseRows(_catalogoProductos);
    // El desplegable se arma SIN el filtro de producto: si se armara con él, elegir uno dejaría
    // una sola opción en la lista y no habría forma de cambiar de producto sin limpiar todo.
    const base=C.filterPurchases(todas,{...consulta,producto:'',grupo:'',texto:query});
    const productos=C.productList(base);
    // Si el texto o las fechas cambiaron y el producto elegido ya no está entre las opciones,
    // se ignora en vez de dejar la pantalla vacía sin explicar por qué.
    const elegido=productos.some(x=>x.grupoId===consulta.producto)?consulta.producto:'';
    const rows=elegido?base.filter(r=>r.grupoId===elegido):base;
    const proveedores=C.supplierList(todas);
    const series=C.priceSeries(rows);
    const conImporte=rows.filter(r=>r.importe!=null);
    const importe=conImporte.reduce((s,r)=>s+r.importe,0);
    const filtros=`<div class="ing-filters" role="group" aria-label="Filtros de la consulta">`
      +`<div><label for="ingDesde">Desde</label><input id="ingDesde" type="date" value="${e(consulta.desde)}"></div>`
      +`<div><label for="ingHasta">Hasta</label><input id="ingHasta" type="date" value="${e(consulta.hasta)}"></div>`
      +`<div><label for="ingProveedor">Proveedor</label><select id="ingProveedor"><option value="">Todos los proveedores</option>`
      +proveedores.map(p=>`<option value="${e(p)}"${C.norm(p)===C.norm(consulta.proveedor)?' selected':''}>${e(p)}</option>`).join('')+`</select></div>`
      +`<div class="ing-f-ancho"><label for="ingSearch">Buscar por nombre, SKU o folio</label><input id="ingSearch" type="search" value="${e(query)}" placeholder="Ej. papa, 7501..., A-1234" autocomplete="off"></div>`
      +`<div class="ing-f-ancho"><label for="ingProducto">Producto${productos.length>1?` (${productos.length})`:''}</label><select id="ingProducto"><option value="">Todos los productos</option>`
      +productos.map(g=>`<option value="${e(g.grupoId)}"${g.grupoId===elegido?' selected':''}>${e(g.nombre)} — ${e(plural(g.compras,'compra','compras'))}${g.presentaciones>1?', '+e(plural(g.presentaciones,'presentación','presentaciones')):''}</option>`).join('')
      +`</select></div>`
      +(elegido||consulta.proveedor||consulta.desde||consulta.hasta||query?`<button type="button" data-action="limpiar">Limpiar filtros</button>`:'')
      +`</div>`;
    const resumen=`<div class="ing-tiles">`
      +`<div><strong>${rows.length.toLocaleString('es-MX')}</strong><span>compras</span></div>`
      +`<div><strong>${new Set(rows.map(r=>r.productoId)).size.toLocaleString('es-MX')}</strong><span>presentaciones</span></div>`
      +`<div><strong>${new Set(rows.map(r=>r.proveedor).filter(Boolean)).size.toLocaleString('es-MX')}</strong><span>proveedores</span></div>`
      // Es la suma de precio × cantidad de los renglones que traen cantidad. No es el total del
      // gasto: va sin IVA y deja fuera lo que se capturó a mano sin cantidad. Se dice cuántos.
      +`<div><strong>${e(money(importe))}</strong><span>importe de ${e(plural(conImporte.length,'renglón','renglones'))} con cantidad, sin IVA</span></div>`
      +`</div>`;
    // La gráfica contesta «cómo se movió el precio de ESTO». Buscar «papa» trae Papa, Papaya,
    // Puré de papa y Papa Casera revueltos: ahí no hay un «esto», y tres líneas sueltas entre
    // trece son ruido con pinta de dato. Se pide elegir producto, que es para lo que está el
    // desplegable.
    const grupos=new Set(rows.map(r=>r.grupoId));
    const grafica=!series.length?''
      :(grupos.size===1||series.length<=SERIE_TOPE)?chart(series)
      :`<div class="ing-chart ing-chart-vacia"><p><strong>Elige un producto para ver la gráfica.</strong> `
        +`Esta consulta trae ${e(plural(grupos.size,'producto','productos'))} distintos con `
        +`${e(plural(series.length,'presentación','presentaciones'))}; dibujarlos juntos no diría nada. `
        +`Usa el desplegable de arriba.</p></div>`;
    const tope=300,visibles=rows.slice(0,tope);
    // Producto y Presentación traían el mismo texto en casi todos los renglones —solo difieren
    // si el producto está homologado— y dos columnas de nombres largos se desbordaban una
    // encima de otra. Va una sola: la presentación, con el nombre del grupo debajo si no coinciden.
    const tabla=visibles.length?`<div class="ing-table-wrap"><table class="ing-table"><thead><tr>`
      +['Fecha','Producto','Proveedor','SKU','Cantidad','Precio unitario','Importe','Folio'].map(h=>`<th scope="col">${h}</th>`).join('')
      +`</tr></thead><tbody>`+visibles.map(r=>`<tr><td class="ing-nw">${e(fecha(r.dia))}</td>`
      +`<td>${e(r.presentacion||r.producto)}${r.producto&&C.norm(r.producto)!==C.norm(r.presentacion)?`<span class="ing-sub">${e(r.producto)}</span>`:''}</td>`
      +`<td>${e(r.proveedor||'—')}</td><td>${e(r.sku||'—')}</td>`
      +`<td class="ing-num">${r.cantidad==null?'—':e(r.cantidad.toLocaleString('es-MX'))+(r.unidad?' '+e(unitN(r.unidad,r.cantidad)):'')}</td>`
      +`<td class="ing-num">${e(money(r.precio))}${r.unidad?`<span class="ing-sub">por ${e(unit(r.unidad))}</span>`:''}</td>`
      +`<td class="ing-num">${r.importe==null?'—':e(money(r.importe))}</td><td class="ing-folio" title="${e(r.folio||'')}">${e(r.folio||'—')}</td></tr>`).join('')
      +`</tbody></table></div>`+(rows.length>tope?`<p>Mostrando ${tope} de ${rows.length.toLocaleString('es-MX')} compras. Acota las fechas, el proveedor o el producto.</p>`:'')
      :`<div class="ing-empty"><h3>No hay compras con esos filtros</h3><p>Prueba otro rango de fechas, otro proveedor o limpia la búsqueda.</p></div>`;
    return filtros+resumen+grafica+tabla;
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
    analysisCache={grouped,matches};
    }
    const needs=g=>g.result.state!=='excluido'&&(g.result.state!=='listo'||g.result.issues?.length||matches.has(g.id));
    // La vista «Solo Egresos» tenía dentro 391 productos excluidos por categoría o por nombre.
    // Ya no: lo único que sale de la lista es lo que alguien omitió a mano. La vista se queda
    // —ahora «Omitidos»— porque sin ella «Omitir» sería una puerta de un solo sentido: el
    // producto desaparecería sin forma de verlo ni de recuperarlo.
    const omitted=g=>g.products.filter(p=>!C.destination(p).include);
    const counts={revision:grouped.filter(needs).length,ingredientes:grouped.filter(g=>g.result.state!=='excluido').length,omitidos:grouped.filter(g=>omitted(g).length).length};
    const consultando=view==='consulta';
    const visible=consultando?[]:grouped.filter(g=>view==='revision'?needs(g):view==='omitidos'?omitted(g).length:g.result.state!=='excluido')
      .map(g=>{if(view!=='omitidos')return g;const subset={...g,products:omitted(g)};return {...subset,result:C.priceForGroup(subset)};})
      .filter(g=>C.norm([g.name,...g.products.map(p=>p.nombre_comercial+' '+p.proveedor_nombre)].join(' ')).includes(C.norm(query)));
    const rows=visible.slice(0,100).map(g=>{
      const r=g.result,w=r.winner;
      const match=matches.get(g.id),reviews=view==='revision'&&match?suggestions(match.p,match.other):'';
      const active=g.products.find(p=>C.destination(p).include),openManual=manual&&g.products.some(p=>p.id===manual.sourceId);
      const shortcuts=active?(g.products.length===1?quickActions(active):`<div class="ing-actions ing-quick"><button type="button" data-action="manual-open" data-id="${e(active.id)}">Homologar manualmente</button></div>`):'';
      return `<article class="ing-row"><div class="ing-row-head"><div><h3>${e(g.name)}</h3><p>${g.products.length} presentación(es) vinculada(s)</p></div><div class="ing-price">${w?`<strong>${money(w.precio)} <span>por presentación</span></strong><p>Factura: ${e(w.fecha)}</p>`:'<strong>Sin compras</strong>'}</div><span class="ing-state ${r.state==='listo'?'ing-ready':''}">${labelState(r)}</span></div>${r.reason?`<p class="ing-reason">${e(r.reason)}</p>`:''}${shortcuts}${openManual?manualPanel():''}<details ${r.state==='pendiente'?'open':''}><summary>Ver presentaciones, proveedor e historial</summary>${g.products.map(p=>productDetails(p)+`<details class="ing-history"><summary>Compras de esta presentación</summary>${C.observations(p).map(o=>`<p>${e(o.fecha||'Sin fecha')}${o.cantidad?' · '+e(String(o.cantidad))+(o.unidad?' '+e(unit(o.unidad)):''):''} · ${money(o.precio)} por presentación${o.codigo_proveedor?' · SKU '+e(o.codigo_proveedor):''} · ${e(o.folio||'Sin folio')} · ${e(o.proveedor)}</p>`).join('')||'<p>Sin compras registradas.</p>'}</details>`).join('')}</details>${openManual?'':reviews}</article>`;
    }).join('');
    return `<section class="ing-workspace" aria-label="Productos comprados"><header class="ing-heading"><div><h2>Productos comprados</h2><p>Todo lo que entra por factura, con su historial de precio y cantidad.</p></div><div class="ing-actions"><button type="button" data-action="refresh">Actualizar</button><button type="button" data-action="new" class="ing-primary">Agregar ingrediente</button></div></header><div class="ing-toolbar" role="group" aria-label="Vista del catálogo">${Object.entries({revision:'Por revisar',ingredientes:'Productos',omitidos:'Omitidos',consulta:'Consulta'}).map(([key,label])=>`<button type="button" data-action="view" data-view="${key}" aria-pressed="${key===view}">${label}${counts[key]==null?'':` <span>${counts[key]}</span>`}</button>`).join('')}</div>${consultando?'':`<div class="ing-search"><label for="ingSearch">Buscar producto, SKU o proveedor</label><input id="ingSearch" type="search" value="${e(query)}" placeholder="Ej. aderezo ranch" autocomplete="off"></div>`}<div class="ing-publication"><p id="ingStatus" role="status" aria-live="polite">${e(lastStatus||'Se registra todo lo comprado, de los XML y de las facturas leídas.')}</p></div>${consultando?consultaMarkup():`<div id="ingRows">${rows||'<div class="ing-empty"><h3>No hay productos en esta vista</h3><p>Cambia de vista o limpia la búsqueda.</p></div>'}</div>${visible.length>100?`<p>Mostrando 100 de ${visible.length}. Usa la búsqueda para acotar los resultados.</p>`:''}`}</section>`;
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
    if(action==='limpiar'){consulta={proveedor:'',desde:'',hasta:'',producto:''};query='';await render();$('ingSearch')?.focus();return;}
    if(action==='edit'||action==='new'){abrirEditorProducto(id||null);return;}
    if(action==='manual-cancel'){manual=null;await render();$('ingSearch')?.focus();return;}
    busy=true;button.disabled=true;
    try{
      if(action==='refresh'){manual=null;await render(true);return;}
      const p=_catalogoProductos.find(x=>x.id===id);
      if(!p)throw new Error('Actualiza el catálogo para encontrar este producto.');
      if(action==='manual-open'){
        if(!C.destination(p).include)throw new Error('Recupera primero el producto desde Omitidos.');
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
        status('Producto omitido: '+p.nombre_comercial+'. Se conserva en Omitidos con todo su historial; puedes recuperarlo.');
      }else if(action==='include'||action==='exclude'){
        // Las dos acciones eran «autorizar la excepción para FORX» y «mandar a Solo Egresos».
        // Sin destino que elegir, lo único que queda de ellas es recuperar lo omitido.
        await saveRows([{...p,estado:p.estado==='ignorado'?'pendiente':p.estado}]);
        status('Producto recuperado: '+p.nombre_comercial+'. Sus compras nunca se tocaron.');
      }else if(action==='split'){
        await saveRows([{...p,ingrediente_id:'ing:'+crypto.randomUUID(),ingrediente_nombre:p.nombre_comercial,ingrediente_generico:p.nombre_comercial,sinonimos_menu:[],estado:'pendiente'}]);
        status('Presentación separada. Su historial de compras se conserva.');
      }
      // La acción 'choose' desempataba dos precios de la misma fecha para decidir cuál
      // publicar a FORX. Sin publicación no hay empate que romper: el historial muestra
      // las dos compras y ya.
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
  setCatProdFiltro=function(filter){view=filter==='ignorado'?'omitidos':filter==='todos'||filter==='validado'?'ingredientes':'revision';render();};
  // Las dos puertas viejas hacia FORX quedan tapiadas aquí a propósito: el modal de index.html
  // sí sabe escribir datos/precios, y dejar su función original al descubierto reabriría la
  // publicación por la puerta de atrás.
  abrirSyncMenuModal=function(){view='ingredientes';render().catch(err=>status(err.message,true));};
  confirmarSyncMenu=()=>{status('Egresos ya no publica precios a FORX.');};
  window.abrirRevisionIngredientesCfdi=async function(){
    try{await ingestXml(_cfdisStore||[]);view='revision';showPage('catalogo-productos',$('navCatalogoProductos'));await render(true);}
    catch(err){setStatus('satStatus',err.message,'err');}
  };
  cambiarEstadoRapido=async function(id,state){
    const p=_catalogoProductos.find(x=>x.id===id);if(!p)return;
    try{await saveRows([{...p,estado:state}]);await render();
    }catch(err){status(err.message,true);}
  };
  // Aquí se pintaba «Precio que verá Menú»: el precio por kilo o por porción, con la merma
  // descontada. Se retiró junto con sus campos y con el oninput que la llamaba.
  abrirEditorProducto=function(id){
    old.editor(id);const p=_catalogoProductos.find(x=>x.id===id);
    $('pcFechaPrecio').value=p?.fecha_precio?.slice(0,10)||'';
    const modal=$('productoModal');
    modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Verificar producto para FORX');
    $('pcDetalles').style.display='none';
    $('pcDetallesBtn').textContent='▸ Más detalles (proveedor, marca, categoría…)';
    $('pcBtnEliminar').style.display='none';
    // Aquí se dibujaba el selector «Destino del producto» (automático / usar en FORX /
    // Solo Egresos). No hay destino que elegir: todo lo comprado se registra.
    $('pcForxControls')?.remove();
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
  page.addEventListener('change',event=>{
    const campo=event.target.id;
    if(campo==='ingProducto')consulta={...consulta,producto:event.target.value};
    else if(campo==='ingProveedor')consulta={...consulta,proveedor:event.target.value};
    else if(campo==='ingDesde')consulta={...consulta,desde:event.target.value};
    else if(campo==='ingHasta')consulta={...consulta,hasta:event.target.value};
    else return;
    render().then(()=>$(campo)?.focus());
  });
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
  auth.onAuthStateChanged(user=>{if(user?.uid!==lastUid){reset();lastUid=user?.uid||'';}if(user)timer=setTimeout(()=>load(true).catch(()=>{}),4000);});
  window.CicsaCatalog={ingest,ingestXml,saveEditor,load,store,render};
})();
