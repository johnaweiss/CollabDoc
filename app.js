// CollabDoc browser application. Temporary test logging is removable later.
const $=id=>document.getElementById(id), frame=$('doc');
const traces=JSON.parse(localStorage.getItem('collabdoc-test-log')||'[]');
const trace=(event,details={})=>{
  const line=JSON.stringify({at:new Date().toISOString(),event,...details});
  traces.push(line);if(traces.length>500)traces.shift();
  localStorage.setItem('collabdoc-test-log',JSON.stringify(traces));
  console.info('[CollabDoc]',line);
};
let handle=null,dirty=false,saving=false,registered=null,reloadForUpdate=false,updatePrompted=false;
trace('start',{url:location.origin,standalone:matchMedia('(display-mode:standalone)').matches,
  secure:isSecureContext,launchQueue:!!window.launchQueue,serviceWorker:!!navigator.serviceWorker,
  sandbox:frame.getAttribute('sandbox'),userAgent:navigator.userAgent});
const report=e=>trace('error',{message:String(e?.message||e)});

// File handle persistence solely for reopening the document after an app update.
function handles(){return new Promise((resolve,reject)=>{
  const request=indexedDB.open('collabdoc-files',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('files');
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
});}
async function storedHandle(value){
  const db=await handles();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('files',value?'readwrite':'readonly');
    const req=value?tx.objectStore('files').put(value,'last'):tx.objectStore('files').get('last');
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });}finally{db.close();}
}
async function openFile(next,restore=false){
  if(dirty&&!confirm('Discard unsaved changes?'))return;
  const text=await(await next.getFile()).text();
  handle=next;frame.srcdoc=text;dirty=false;
  document.title=next.name+' — CollabDoc';
  $('setup').hidden=true;
  trace('open',{name:next.name,length:text.length,restore});
  await storedHandle(next).catch(e=>trace('handle-store-error',{message:String(e)}));
}
if('launchQueue'in window)launchQueue.setConsumer(({files})=>{
  trace('launch',{files:files.length});
  if(files[0])openFile(files[0]).catch(report);
});
frame.addEventListener('load',()=>{
  const doc=frame.contentDocument;
  if(!doc){trace('iframe-access-failed');return;}
  doc.addEventListener('keydown',onKey);
  doc.addEventListener('input',()=>{if(!dirty)trace('edit-start');dirty=true;},{passive:true});
  trace('iframe-load',{editable:doc.body?.isContentEditable||false});
});

async function save(){
  if(saving)return;
  if(!handle)throw Error('Open an HTML file through CollabDoc first');
  saving=true;trace('save-start',{name:handle.name});
  try{
    if(await handle.requestPermission({mode:'readwrite'})!=='granted')throw Error('Write permission denied');
    const doc=frame.contentDocument;
    if(!doc?.documentElement)throw Error('Document has not loaded');
    const html=(doc.doctype?'<!doctype '+doc.doctype.name+'>\n':'')+doc.documentElement.outerHTML;
    const stream=await handle.createWritable();
    try{await stream.write(html);await stream.close();}
    catch(error){await stream.abort().catch(()=>{});throw error;}
    dirty=false;trace('save-ok',{bytes:new Blob([html]).size});
  }catch(error){trace('save-error',{message:String(error)});throw error;}
  finally{saving=false;}
}
function saveClicked(){save().catch(error=>alert('Save failed: '+error.message));}
function onKey(e){if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){
  e.preventDefault();e.stopPropagation();saveClicked();
}}
window.addEventListener('keydown',onKey);
$('save').addEventListener('click',saveClicked);
$('log').addEventListener('click',()=>{
  const blob=new Blob([traces.join('\n')+'\n'],{type:'text/plain'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='CollabDoc-browser-log.txt';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
});

// Download may be blocked because appinstalled is not always a user gesture.
// Keep a visible fallback link for the user to initiate the same download.
function downloadCli(){
  trace('cli-download-attempt');
  $('cli').click();
}
window.addEventListener('appinstalled',()=>{trace('appinstalled');downloadCli();});

// Ask on EVERY launch; Chrome fetches new service-worker code from the HTTPS origin.
async function checkUpdates(){
  if(!('serviceWorker'in navigator))return trace('service-worker-unavailable');
  registered=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
  trace('service-worker-register',{scope:registered.scope});
  const offer=async()=>{
    if(!registered.waiting||!navigator.serviceWorker.controller||updatePrompted)return;
    updatePrompted=true;trace('update-available');
    if(!confirm('CollabDoc update available. Install now?'))return trace('update-declined');
    if(dirty){
      if(!confirm('Save your document before updating?'))return trace('update-deferred-unsaved');
      try{await save();}catch(e){return report(e);}
    }
    reloadForUpdate=true;
    sessionStorage.setItem('collabdoc-reopen','1');
    registered.waiting.postMessage({type:'ACTIVATE'});
    trace('update-accepted');
  };
  if(registered.waiting)await offer();
  registered.addEventListener('updatefound',()=>{
    const worker=registered.installing;
    trace('update-found');
    worker?.addEventListener('statechange',()=>{
      trace('worker-state',{state:worker.state});
      if(worker.state==='installed')offer().catch(report);
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    trace('controllerchange',{reload:reloadForUpdate});
    if(reloadForUpdate)location.reload();
  });
  try{await registered.update();trace('update-check-done');}catch(e){trace('update-check-offline',{message:String(e)});}
}
if(sessionStorage.getItem('collabdoc-reopen')==='1'){
  sessionStorage.removeItem('collabdoc-reopen');
  storedHandle().then(h=>h&&openFile(h,true)).catch(e=>trace('restore-failed',{message:String(e)}));
}
checkUpdates().catch(report);
