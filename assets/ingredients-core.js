/* Dominio de ingredientes. Sin DOM, red ni fechas de carga como fechas de precio. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CicsaIngredients = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const unique = values => [...new Set(values.filter(Boolean))];
  const number = x => x === '' || x == null ? NaN : Number(x);
  const positive = x => Number.isFinite(number(x)) && number(x) > 0;
  function date(value) {
    const s = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/.test(s)) return '';
    if (s.length > 10 && (Number(s.slice(11,13)) > 23 || Number(s.slice(14,16)) > 59 || Number(s.slice(17,19)) > 59)) return '';
    const day = s.slice(0, 10), d = new Date(day + 'T12:00:00Z');
    return Number.isFinite(+d) && d.toISOString().slice(0, 10) === day ? s : '';
  }
  function destination(p) {
    if (p.estado === 'ignorado') return { include:false, reason:'Ignorado' };
    if (p.forx_destino === 'incluir') return { include:true, reason:'Excepción autorizada' };
    if (p.forx_destino === 'excluir') return { include:false, reason:'Solo Egresos (decisión guardada)' };
    const category = norm(p.categoria);
    if (/limpieza|desechables|refrescos|mantenimiento|combustible|transporte|nomina|gastos generales|servicios|oficina/.test(category) || category === 'gas')
      return { include:false, reason:'Categoría de operación' };
    const name = norm(p.nombre_comercial || p.nombre);
    // Reglas por partida. Nunca se hereda la categoría global de una factura mixta.
    if (/\b(detergente|cloro|desengrasante|limpiador|suavizante|jabon|escoba|trapeador|servilletas?|papel higienico|refrescos?|pepsi|coca cola|sprite|fanta)\b/.test(name) || /\b(desechables?|unicel)\b/.test(name))
      return { include:false, reason:'Producto de operación' };
    return { include:true, reason:'Candidato a ingrediente' };
  }
  function ingredientName(p) { return String(p.ingrediente_nombre || p.ingrediente_generico || p.nombre_comercial || '').trim(); }
  function groupId(p) { return p.ingrediente_id || (p.ingrediente_generico ? 'legacy:' + norm(p.ingrediente_generico) : 'producto:' + p.id); }
  const aliases = p => unique([p.nombre_comercial, p.nombre_normalizado, ...(p.alias_factura || [])].map(norm));
  function findProduct(products, input) {
    const name = norm(input.nombre), supplier = norm(input.proveedor);
    const candidates = products.filter(p => aliases(p).includes(name) && (!p.proveedor_nombre || norm(p.proveedor_nombre) === supplier));
    // Ambigüedad y cambios de unidad no se resuelven por posición en el arreglo.
    const fits = candidates.filter(p => !p.unidad_compra || !input.unidad || norm(p.unidad_compra) === norm(input.unidad));
    return fits.length === 1 ? fits[0] : null;
  }
  function conversion(p, price = p.precio_actual) {
    if (!positive(price)) return { ok:false, reason:'Falta un precio mayor que cero' };
    const waste = p.merma_pct == null || p.merma_pct === '' ? 0 : number(p.merma_pct);
    if (!Number.isFinite(waste) || waste < 0 || waste >= 100) return { ok:false, reason:'Revisa la merma (0 a menos de 100 %)' };
    const unit = p.unidad_base;
    if (!['kg','lt','pz','porcion'].includes(unit)) return { ok:false, reason:'Elige kilo, litro, pieza o porción como unidad de costeo' };
    let qty;
    if (unit === 'pz') {
      if (!positive(p.piezas_por_presentacion)) return { ok:false, reason:'Falta cuántas piezas trae la presentación' };
      qty = number(p.piezas_por_presentacion);
    } else {
      if (!positive(p.contenido_cantidad)) return { ok:false, reason:'Falta el contenido real de la presentación' };
      const units = { kg:['peso',1], g:['peso',0.001], lt:['volumen',1], l:['volumen',1], ml:['volumen',0.001] };
      const source = units[p.contenido_unidad], dest = units[unit];
      if (!source) return { ok:false, reason:'Revisa la unidad del contenido' };
      qty = number(p.contenido_cantidad) * source[1];
      if (unit === 'porcion') {
        const portion = units[p.porcion_unidad];
        if (!positive(p.porcion_valor) || !portion || portion[0] !== source[0]) return { ok:false, reason:'La porción debe tener una medida compatible con el contenido' };
        qty /= number(p.porcion_valor) * portion[1];
      } else if (!dest || dest[0] !== source[0]) return { ok:false, reason:'No se convierten litros a kilos sin una equivalencia revisada' };
      // Datos heredados como «3.8L» capturados como kg no se publican silenciosamente.
      const label = norm(p.nombre_comercial);
      const volume = /\d\s*(?:l|lt|litros?|ml)\b/.test(label);
      const mass = /\d\s*(?:kg|kilos?|gr|gramos?)\b/.test(label);
      if (!p.conversion_revisada && ((volume && source[0] === 'peso') || (mass && source[0] === 'volumen')))
        return { ok:false, reason:'El nombre y la unidad no coinciden: revisa la presentación' };
    }
    const usable = qty * (1 - waste / 100), result = number(price) / usable;
    if (!Number.isFinite(result) || result <= 0) return { ok:false, reason:'Conversión inválida' };
    return { ok:true, price:Math.round(result * 100) / 100, unit, usable };
  }
  function observations(p) {
    const result = [...(p.compras_forx || [])];
    if (!result.length && positive(p.precio_actual)) result.push({
      id:'legacy:' + p.id, precio:number(p.precio_actual), fecha:p.fecha_precio || '',
      folio:p.factura_origen || '', proveedor:p.proveedor_nombre || '', origen:p.precio_origen || 'factura',
      fuente:p.precio_fuente || '', unidad:p.unidad_compra || '',
      fecha_consulta:p.precio_fecha_consulta || '', vigencia_hasta:p.precio_vigencia_hasta || '',
    });
    return result.map(o => {
      if (Object.hasOwn(o,'conversion_forx') || p.estado !== 'validado') return o;
      const calc = conversion(p,o.precio);
      return calc.ok ? {...o,conversion_forx:{unidad:calc.unit,contenido_util:calc.usable}} : o;
    });
  }
  function observationPrice(p,o) {
    if (!o.conversion_forx) return conversion(p,o.precio);
    const s=o.conversion_forx;
    if (!positive(o.precio) || !positive(s.contenido_util) || !['kg','lt','pz','porcion'].includes(s.unidad)) return {ok:false,reason:'La conversión histórica requiere revisión'};
    return {ok:true,price:Math.round(number(o.precio)/number(s.contenido_util)*100)/100,unit:s.unidad,usable:number(s.contenido_util)};
  }
  function recordPurchase(p, obs) {
    if (!positive(obs.precio) || !obs.id) throw new Error('La partida necesita identificador y precio válido');
    const purchases = observations(p), at = purchases.findIndex(x => x.id === obs.id);
    const previous = at >= 0 ? purchases[at] : null;
    // Un XML puede completar la misma evidencia, no una compra adicional.
    if (previous && previous.evidencia === 'xml' && obs.evidencia !== 'xml' && !obs.correcciones?.length) return p;
    const calc=conversion(p,obs.precio), recorded={...obs};
    if (!Object.hasOwn(recorded,'conversion_forx')) {
      if (previous?.conversion_forx) recorded.conversion_forx=previous.conversion_forx;
      else if (p.estado === 'validado' && calc.ok) recorded.conversion_forx={unidad:calc.unit,contenido_util:calc.usable};
    }
    if (at >= 0) purchases[at] = { ...previous, ...recorded }; else purchases.push(recorded);
    const updated = { ...p, compras_forx:purchases };
    const valid = purchases.filter(x => date(x.fecha) && positive(x.precio));
    const xmlReceipts=new Set(valid.filter(x=>x.evidencia==='xml'&&x.folio).map(x=>norm(x.folio)));
    const evidence=valid.filter(x=>x.evidencia==='xml'||x.correcciones?.length||!xmlReceipts.has(norm(x.folio)));
    const invoices = evidence.filter(x => x.origen !== 'web');
    const best = (invoices.length ? invoices : evidence).sort((a,b) => date(b.fecha).localeCompare(date(a.fecha)) || a.id.localeCompare(b.id))[0];
    if (best) Object.assign(updated, { precio_actual:best.precio, fecha_precio:best.fecha, factura_origen:best.folio || '', precio_origen:best.origen || 'factura' });
    return updated;
  }
  function keys(p) {
    const names = [ingredientName(p), ...(p.sinonimos_menu || [])];
    return unique(names.flatMap(name => {
      const s = String(name || '').trim(), lower = s.toLowerCase();
      return [s, lower, lower.charAt(0).toUpperCase() + lower.slice(1)].flatMap(x => [x, x.normalize('NFD').replace(/[\u0300-\u036f]/g, '')]);
    }));
  }
  function groups(products) {
    const map = new Map();
    products.filter(p => !p._internal).forEach(p => {
      const id = groupId(p);
      if (!map.has(id)) map.set(id, { id, name:ingredientName(p), products:[] });
      map.get(id).products.push(p);
    });
    return [...map.values()].sort((a,b) => a.name.localeCompare(b.name, 'es'));
  }
  function priceForGroup(group) {
    const included = group.products.filter(p => destination(p).include);
    if (!included.length) return { state:'excluido', reason:destination(group.products[0]).reason };
    const candidates = [], issues = [];
    for (const p of included) {
      if (p.estado !== 'validado') { issues.push('Falta verificar ' + p.nombre_comercial); continue; }
      if (!String(p.ingrediente_nombre||p.ingrediente_generico||'').trim()) { issues.push('Define el ingrediente de FORX para '+p.nombre_comercial); continue; }
      for (const o of observations(p)) {
        const calc = observationPrice(p, o);
        if (!calc.ok || !date(o.fecha)) { issues.push(calc.reason || 'Falta la fecha de factura'); continue; }
        if (o.origen === 'web' && !String(o.fuente || p.precio_fuente || '').trim()) { issues.push('Precio provisional sin fuente'); continue; }
        candidates.push({ ...o, productId:p.id, calc });
      }
    }
    if (!candidates.length) return { state:'pendiente', reason:issues[0] || 'Sin precio verificable' };
    // No se mezclan precios por litro, kilo o porción bajo una sola llave de FORX.
    if (new Set(candidates.map(x => x.calc.unit)).size > 1) return { state:'conflicto', reason:'Las presentaciones usan unidades distintas', candidates:[] };
    const xmlReceipts=new Set(candidates.filter(x=>x.evidencia==='xml'&&x.folio).map(x=>x.productId+'|'+norm(x.folio)));
    const evidence=candidates.filter(x=>x.evidencia==='xml'||x.correcciones?.length||!xmlReceipts.has(x.productId+'|'+norm(x.folio)));
    const invoices = evidence.filter(x => x.origen !== 'web');
    const eligible = invoices.length ? invoices : evidence;
    // Si solo se conoce el día, no se inventa un orden por la hora de carga.
    const day = eligible.map(x => x.fecha.slice(0,10)).sort().at(-1);
    let latest = eligible.filter(x => x.fecha.slice(0,10) === day);
    if (latest.every(x => x.fecha.length > 10)) {
      const timestamp = latest.map(x => x.fecha).sort().at(-1);
      latest = latest.filter(x => x.fecha === timestamp);
    }
    latest.sort((a,b) => a.id.localeCompare(b.id));
    const preference = included.map(p => p.forx_preferido).find(x => x && x.fecha === day && x.candidatos === latest.map(c=>c.id+':'+c.calc.price).join('|'));
    let winner = preference && latest.find(x => x.id === preference.id);
    if (!winner && new Set(latest.map(x => x.calc.price)).size > 1) return { state:'conflicto', reason:'Precios distintos en la misma fecha', candidates:latest };
    winner = winner || latest[0];
    return { state:'listo', winner, issues, candidates:latest };
  }
  function homologate(products, sourceId, targetId) {
    const source = products.find(p => p.id === sourceId), target = products.find(p => p.id === targetId);
    if (!source || !target || sourceId === targetId) throw new Error('Selecciona dos productos distintos');
    if (!destination(source).include || !destination(target).include) throw new Error('Autoriza primero el producto para usarlo en FORX');
    const sourceGroup = groupId(source), targetGroup = groupId(target);
    if (sourceGroup === targetGroup) return [];
    const members = products.filter(p => [sourceGroup,targetGroup].includes(groupId(p)));
    const name = ingredientName(target), id = target.ingrediente_id || 'ing:' + target.id;
    const synonyms = unique(members.flatMap(p => [ingredientName(p), ...(p.sinonimos_menu || [])])).filter(x => norm(x) !== norm(name));
    return members.map(p => ({ ...p, compras_forx:observations(p), ingrediente_id:id, ingrediente_nombre:name, ingrediente_generico:name, sinonimos_menu:synonyms }));
  }
  function createMatcher(products) {
    const words=p=>new Set(norm(ingredientName(p)+' '+p.nombre_comercial).split(' ').filter(w=>w.length>2&&!/^\d+$/.test(w)&&!['para','con','sin','bote','caja','bolsa','lata'].includes(w)));
    const byId=new Map(products.map(p=>[p.id,{p,group:groupId(p),include:destination(p).include,words:words(p)}]));
    const index=new Map(),rejected=new Map();
    for(const m of byId.values()){
      if(m.include)for(const w of m.words){if(!index.has(w))index.set(w,[]);index.get(w).push(m);}
      for(const id of m.p.forx_distintos||[]){
        const other=byId.get(id);if(!other)continue;
        for(const [a,b] of [[m.group,other.group],[other.group,m.group]]){if(!rejected.has(a))rejected.set(a,new Set());rejected.get(a).add(b);}
      }
    }
    return function(source,limit=3){
      if(!destination(source).include)return [];
      const own=byId.get(source.id)||{group:groupId(source),words:words(source)};
      const pool=new Set([...own.words].flatMap(w=>index.get(w)||[])),seen=new Set();
      return [...pool].filter(m=>m.group!==own.group&&!rejected.get(own.group)?.has(m.group))
        .map(m=>({m,score:[...own.words].filter(w=>m.words.has(w)).length/Math.max(own.words.size,m.words.size)}))
        .filter(x=>x.score>=0.2).sort((a,b)=>b.score-a.score||a.m.p.id.localeCompare(b.m.p.id))
        .filter(({m})=>{if(seen.has(m.group))return false;seen.add(m.group);return true;}).slice(0,limit).map(x=>x.m.p);
    };
  }
  const suggest=(products,source,limit=3)=>createMatcher(products)(source,limit);
  function publication(products, previous = {}, managed = [], publishedDay = '') {
    const next = Object.assign(Object.create(null), previous), desired = Object.create(null), held = new Set(), conflicts = [], owners = new Map(), excluded = new Set();
    const grouped = groups(products);
    for (const group of grouped) {
      const result = priceForGroup(group), names = unique(group.products.flatMap(keys));
      if (result.state !== 'excluido') for (const k of names) {
        if (owners.has(k) && owners.get(k) !== group.id) {
          held.add(k);
          for (const id of [group.id,owners.get(k)]) if (!conflicts.some(c=>c.id===id)) conflicts.push({id,reason:'Nombre de receta compartido entre ingredientes distintos: '+k});
        } else owners.set(k,group.id);
      }
      if (result.state === 'pendiente' || result.state === 'conflicto') { names.forEach(k=>held.add(k)); conflicts.push({ id:group.id, reason:result.reason }); continue; }
      if (result.state === 'excluido') { names.forEach(k=>excluded.add(k)); continue; }
      const w = result.winner;
      // Conserva `fecha` como fecha de publicación para el consumidor heredado;
      // `fecha_precio` siempre representa la compra, nunca el orden de carga.
      const value = { precio:w.calc.price, unidad_base:w.calc.unit, fecha_precio:w.fecha, fecha:(publishedDay||w.fecha.slice(0,10)).split('-').reverse().join('/'), origen:w.origen || 'factura', provisional:w.origen === 'web', ingrediente_id:group.id };
      if(value.provisional){
        const start=new Date((date(w.fecha_consulta)||w.fecha).slice(0,10)+'T12:00:00Z');
        start.setUTCDate(start.getUTCDate()+60);
        value.vigencia=date(w.vigencia_hasta)||start.toISOString().slice(0,10);
        value.revaluar=Boolean(publishedDay&&value.vigencia.slice(0,10)<publishedDay);
      }
      names.forEach(k => { desired[k] = value; });
    }
    // Solo se retiran llaves que este publicador administraba; nunca se borra todo el mapa.
    for (const k of managed) if (!held.has(k) && !Object.hasOwn(desired,k)) delete next[k];
    // Migra exclusiones heredadas únicamente para nombres presentes en el catálogo.
    // Una excepción activa con el mismo nombre conserva la propiedad de su llave.
    for (const k of excluded) if (!owners.has(k)) delete next[k];
    for (const [k,v] of Object.entries(desired)) if (!held.has(k)) next[k] = v;
    return { prices:next, managed:unique([...Object.keys(desired).filter(k=>!held.has(k)), ...managed.filter(k=>held.has(k))]), conflicts,
      changed:JSON.stringify(next) !== JSON.stringify(previous) };
  }
  return { norm, date, destination, ingredientName, groupId, findProduct, conversion, observations, observationPrice, recordPurchase, keys, groups, priceForGroup, homologate, createMatcher, suggest, publication };
});
