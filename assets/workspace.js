/* Presentación progresiva: conserva los IDs y los controladores financieros originales. */
(() => {
  const svg = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">${body}</svg>`;
  const plus = svg('<path d="M12 5v14M5 12h14"/>');
  const arrow = svg('<path d="M5 12h14m-6-6 6 6-6 6"/>');
  const upload = svg('<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>');
  const brand = document.querySelector('.side-brand');
  brand.innerHTML='<img class="corporate-logo" src="assets/cicsa-logo.png" alt="CICSA · Alimentamos tu energía" width="1000" height="542"><span class="brand-caption">Control de egresos</span>';
  const mobileBrand=document.querySelector('.mt-title');
  if(mobileBrand) mobileBrand.innerHTML='<img src="assets/cicsa-logo.png" alt="CICSA" width="1000" height="542" class="mobile-corporate-logo">';
  const loginLogo=document.querySelector('.login-logo img');
  if(loginLogo){loginLogo.src='assets/cicsa-logo.png';loginLogo.alt='CICSA · Alimentamos tu energía';loginLogo.style.cssText='width:240px;height:130px;object-fit:contain';}
  const title=document.querySelector('.rs-title');
  title.textContent='Tu espacio de trabajo';
  const actions=document.createElement('section');
  actions.className='workspace-actions';actions.setAttribute('aria-label','Acciones principales');
  actions.innerHTML=`<article class="workspace-action workspace-capture"><h2>Una factura, todo en orden.</h2><p>Sube el documento, confirma los datos y registra el gasto en su categoría.</p><button class="btn" id="workspaceCapture">${plus} Capturar factura</button></article><article class="workspace-action workspace-review"><h2>Revisa tus gastos</h2><p>Consulta movimientos, filtra por categoría y revisa cómo se pagaron.</p><button class="btn" id="workspaceReview">Revisar gastos ${arrow}</button></article>`;
  document.querySelector('.rs-head').after(actions);
  document.getElementById('workspaceCapture').onclick=()=>showPage('captura');
  document.getElementById('workspaceReview').onclick=()=>showPage('gastos');
  const quick=document.querySelector('.rs-head>.btn');
  quick.textContent='Cambiar semana';quick.onclick=()=>openWeekModal();quick.className='btn btn-light';
  const capture=document.getElementById('page-captura');
  const header=document.createElement('header');header.className='workspace-head';
  header.innerHTML='<div><h1>Capturar factura</h1><p>Primero el documento. Después, revisa y confirma los datos.</p></div><button class="btn btn-light" id="workspaceGmail">Importar desde Gmail</button>';
  capture.prepend(header);
  document.getElementById('workspaceGmail').onclick=()=>showPage('gmail');
  const steps=document.createElement('ol');steps.className='capture-steps';steps.setAttribute('aria-label','Avance de captura');
  steps.innerHTML='<li aria-current="step"><span>1</span> Subir documento</li><li><span>2</span> Revisar datos</li><li><span>3</span> Guardar gasto</li>';
  header.after(steps);
  const cards=[...capture.querySelectorAll(':scope>.card')];
  const grid=document.createElement('div');grid.className='capture-bento';cards[0].before(grid);
  grid.append(cards[0],document.getElementById('extractedCard'));
  cards[0].querySelector('.card-title').textContent='Sube el documento';
  const help=document.createElement('aside');help.className='capture-help';
  help.innerHTML='<h2>Antes de guardar</h2><ol><li>Usa una foto legible o el PDF original de la factura.</li><li>Comprueba proveedor, fecha, folio e importe.</li><li>Selecciona la categoría y la forma de pago.</li></ol><p>La lectura automática puede equivocarse. Tú confirmas los datos antes de registrarlos.</p>';
  grid.append(help);
  cards.at(-1).classList.add('capture-manual');
  const manualToggle=cards.at(-1).querySelector('.card-title');
  manualToggle.tabIndex=0;manualToggle.setAttribute('role','button');manualToggle.setAttribute('aria-expanded','false');manualToggle.setAttribute('aria-controls','manualForm');
  manualToggle.addEventListener('click',()=>manualToggle.setAttribute('aria-expanded',String(manualOpen)));
  manualToggle.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();manualToggle.click();}};
  const zone=document.getElementById('dropzone');zone.tabIndex=0;zone.setAttribute('role','button');zone.setAttribute('aria-label','Seleccionar factura en imagen o PDF');
  zone.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();document.getElementById('fileIn').click();}};
  zone.querySelector('.dropzone-icon').innerHTML=upload;
  zone.querySelector('p').innerHTML='<strong>Selecciona tu factura</strong><br>o arrastra el archivo aquí';
  const format=zone.querySelector('p:last-child');format.textContent='Imagen o PDF · Verifica que el texto sea legible';format.style.color='var(--txt2)';
  document.getElementById('btnLeer').textContent='Leer documento';
  const clean=cards[0].querySelector('.btn-light');clean.textContent='Cambiar documento';clean.onclick=()=>document.getElementById('fileIn').click();
  document.getElementById('extractedCard').querySelector('.card-title').textContent='Revisa y confirma los datos';
  const sync=document.createElement('div');sync.className='capture-sync';sync.setAttribute('role','status');sync.setAttribute('aria-live','polite');capture.append(sync);
  window.actualizarEstadoCaptura=()=>{
    const pending=typeof _syncPending!=='undefined' && (_syncPending||_syncing);
    sync.dataset.pending=String(pending);
    sync.textContent=pending?'Cambios locales pendientes de sincronizar. Mantén abierta la aplicación.':_syncUltimo?'Datos sincronizados.':'Se confirmará la sincronización cuando se guarde un cambio.';
  };
  actualizarEstadoCaptura();
  const extracted=document.getElementById('extractedCard');
  const completion=document.createElement('section');completion.className='capture-complete';completion.hidden=true;
  completion.innerHTML='<h2>Gasto registrado en este dispositivo</h2><p>Consulta abajo el estado de sincronización. Los avisos del comprobante se muestran por separado.</p><div class="btn-row"><button class="btn btn-green" id="captureAnother">Capturar otra factura</button><button class="btn btn-light" id="captureViewExpense">Revisar gastos</button></div>';
  grid.before(completion);
  let saved=false;
  let visible=false;
  const updateStep=()=>{
    const next=extracted.style.display!=='none';
    help.hidden=next;
    const active=saved?2:next?1:0;
    [...steps.children].forEach((step,index)=>{if(index===active)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');});
    if(next&&!visible){extracted.setAttribute('tabindex','-1');extracted.focus({preventScroll:true});extracted.scrollIntoView({block:'nearest',behavior:'auto'});}
    visible=next;
  };
  new MutationObserver(updateStep).observe(extracted,{attributes:true,attributeFilter:['style']});
  const restart=()=>{
    document.getElementById('fileIn').value='';
    saved=false;completion.hidden=true;grid.hidden=false;grid.classList.remove('has-document');
    extracted.append(document.getElementById('statusGuardar'));
    document.getElementById('statusGuardar').style.display='none';
    limpiarCaptura();updateStep();
  };
  document.getElementById('captureAnother').onclick=restart;
  document.getElementById('captureViewExpense').onclick=()=>showPage('gastos');
  document.addEventListener('cicsa:gasto-registrado',()=>{
    saved=true;completion.hidden=false;grid.hidden=true;extracted.style.display='none';
    completion.append(document.getElementById('statusGuardar'));
    updateStep();actualizarEstadoCaptura();completion.tabIndex=-1;completion.focus({preventScroll:true});completion.scrollIntoView({block:'nearest'});
  });
  const originalHandleFile=handleFile;
  handleFile=async function(file){
    if(!file)return;
    await originalHandleFile(file);
    saved=false;completion.hidden=true;grid.hidden=false;extracted.style.display='none';
    extracted.append(document.getElementById('statusGuardar'));
    grid.classList.add('has-document');updateStep();
  };
  // El idioma del control nativo depende del navegador; la etiqueta visible es nuestra.
  const excel=document.getElementById('importExcelFile');
  if(excel){
    const wrapper=document.createElement('span');wrapper.className='spanish-file';
    const choose=document.createElement('button');choose.type='button';choose.className='btn btn-light';choose.textContent='Seleccionar Excel';choose.onclick=()=>excel.click();
    const filename=document.createElement('small');filename.textContent='Ningún archivo seleccionado';filename.setAttribute('aria-live','polite');
    excel.hidden=true;excel.after(wrapper);wrapper.append(choose,filename);
    excel.addEventListener('change',()=>filename.textContent=excel.files?.[0]?.name||'Ningún archivo seleccionado');
  }
  // Etiquetas programáticas para formularios heredados con label contenedor.
  document.querySelectorAll('label').forEach(label=>{
    if(label.htmlFor)return;
    const parent=label.parentElement;
    const input=parent.querySelector('input[id],select[id],textarea[id]');
    if(input && parent.querySelectorAll('label').length===1)label.htmlFor=input.id;
  });
  for(const id of ['statusLectura','statusGuardar','gmailStatus']){const node=document.getElementById(id);if(node){node.setAttribute('role','status');node.setAttribute('aria-live','polite');}}
})();
