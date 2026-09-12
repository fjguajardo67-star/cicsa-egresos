/* Firestore REST: escrituras atómicas de producto + pendiente, publicación con CAS. */
(function(root,factory){
  if(typeof module==='object' && module.exports) module.exports=factory;
  else root.CicsaIngredientStore=factory;
})(typeof globalThis!=='undefined'?globalThis:this,function(options){
  'use strict';
  const {base,key,fetcher,headers,core,session}=options;
  const collection='productos_comerciales', markerPath=collection+'/_forx_sync';
  const documentName=path=>base.slice(base.indexOf('projects/'))+'/'+path;
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const fields=data=>({json:{stringValue:JSON.stringify(data)},ts:{stringValue:new Date().toISOString()}});
  async function request(path, options={}){
    const uid=session();
    if(!uid) throw new Error('Inicia sesión para guardar los ingredientes.');
    const auth=await headers();
    if(session()!==uid) throw new Error('La sesión cambió. Vuelve a abrir el catálogo.');
    const response=await fetcher(base+path+(path.includes('?')?'&':'?')+'key='+key,{...options,headers:{...auth,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000)});
    if(session()!==uid) throw new Error('La sesión cambió durante la operación.');
    if(response.status===404 && !options.method) return null;
    if(!response.ok){
      const detail=await response.json().catch(()=>({}));
      const error=new Error(response.status===401||response.status===403?'No se pudo autorizar la operación. Revisa tu sesión.':'No se pudo guardar. Conservamos los pendientes; vuelve a intentar.');
      error.status=response.status;error.conflict=[409,412].includes(response.status)||['FAILED_PRECONDITION','ABORTED'].includes(detail?.error?.status);throw error;
    }
    return response.json();
  }
  const decode=doc=>{
    if(!doc) return null;
    try { return {id:doc.name.split('/').pop(),data:JSON.parse(doc.fields.json.stringValue),version:doc.updateTime}; }
    catch(_){ throw new Error('Hay un documento de catálogo ilegible. Se detuvo la publicación para proteger los precios.'); }
  };
  async function get(path){ return decode(await request('/'+path)); }
  async function list(){
    const out=[],seen=new Set(),uid=session();let token='';
    do{
      const data=await request('/'+collection+'?pageSize=300'+(token?'&pageToken='+encodeURIComponent(token):''));
      if(!data) throw new Error('No se pudo leer el catálogo completo.');
      if(session()!==uid)throw new Error('La sesión cambió.');
      out.push(...(data.documents||[]).map(decode));token=data.nextPageToken||'';
      if(token&&(seen.has(token)||seen.size>=500))throw new Error('La lectura del catálogo no avanzó. Se detuvo para proteger los precios.');
      if(token)seen.add(token);
    }while(token);
    return out;
  }
  function write(path,data,version){
    if(new TextEncoder().encode(JSON.stringify(data)).length>850000) throw new Error('Este historial requiere archivarse antes de agregar más compras. No se descartó información.');
    return {update:{name:documentName(path),fields:fields(data)},currentDocument:version?{updateTime:version}:{exists:false}};
  }
  async function commit(writes){ return request(':commit',{method:'POST',body:JSON.stringify({writes})}); }
  async function save(changes,expected={}){
    if(!changes.length) return;
    const uid=session();
    if(changes.length>400) throw new Error('Selecciona como máximo 400 productos por operación.');
    for(let attempt=0;attempt<3;attempt++){
      const [marker,docs]=await Promise.all([get(markerPath),Promise.all(changes.map(p=>get(collection+'/'+encodeURIComponent(p.id))))]);
      const writes=changes.map((p,i)=>{
        if(Object.hasOwn(expected,p.id) && !same(expected[p.id],docs[i]?.data??null)) throw new Error('Otro usuario modificó un producto. Actualiza el catálogo antes de confirmar.');
        const {id,...data}=p;return write(collection+'/'+id,data,docs[i]?.version);
      });
      const data={...(marker?.data||{}),_internal:true,pending:true,revision:(marker?.data.revision||0)+1};
      writes.push(write(markerPath,data,marker?.version));
      if(session()!==uid)throw new Error('La sesión cambió antes de guardar.');
      try { await commit(writes);return; }catch(e){ if(!e.conflict||attempt===2) throw e; }
    }
  }
  async function publish(){
    const uid=session();
    for(let attempt=0;attempt<3;attempt++){
      const marker=await get(markerPath);
      if(!marker?.data.pending) return {state:'sin-pendientes',marker:marker?.data};
      const [docs,previous]=await Promise.all([list(),get('datos/precios')]);
      const products=docs.filter(x=>!x.data._internal && x.id!=='_forx_sync').map(x=>({id:x.id,...x.data}));
      const plan=core.publication(products,previous?.data||{},marker.data.managedKeys||[],new Date().toISOString().slice(0,10));
      const metadata={...marker.data,pending:false,publishedRevision:marker.data.revision,managedKeys:plan.managed,publishedAt:new Date().toISOString(),conflicts:plan.conflicts};
      const writes=[write(markerPath,metadata,marker.version)];
      if(plan.changed) writes.push(write('datos/precios',plan.prices,previous?.version));
      else if(previous) writes.push({verify:documentName('datos/precios'),currentDocument:{updateTime:previous.version}});
      if(session()!==uid)throw new Error('La sesión cambió antes de publicar.');
      try { await commit(writes);return {state:'publicado',marker:metadata,plan}; }
      catch(e){ if(!e.conflict||attempt===2) throw e; }
    }
  }
  return {get,list,save,publish,markerPath};
});
