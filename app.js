// CollabDoc browser application. Temporary test logging is removable later.
const $=id=>document.getElementById(id), frame=$('doc');
const traces=JSON.parse(localStorage.getItem('collabdoc-test-log')||'[]');
const trace=(event,details={})=>{
  const line=JSON.stringify({at:new Date().toISOString(),event,...details});
  traces.push(line);if(traces.length>500)traces.shift();
  localStorage.setItem('collabdoc-test-log',JSON.stringify(traces));
  console.info('[CollabDoc]',line);
};
const VERSION='v6',APP='CollabDoc '+VERSION;  // shown in the title bar
const FILE_TYPES=[{description:'HTML documents',accept:{'text/html':['.html','.htm']}}];
const BLANK='<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>Untitled</title></head>\n<body>\n<p><br></p>\n</body>\n</html>\n';
// handle: file handle of the open document (null for the sample or a new file).
// needSaveAs: the next save shows the Save As dialog (true after every open/new).
let handle=null,docName='sample-doc.html',needSaveAs=true,dirty=false,saving=false,
  registered=null,reloadForUpdate=false,updatePrompted=false;
trace('start',{version:VERSION,url:location.origin,standalone:matchMedia('(display-mode:standalone)').matches,
  secure:isSecureContext,launchQueue:!!window.launchQueue,serviceWorker:!!navigator.serviceWorker,
  sandbox:frame.getAttribute('sandbox'),userAgent:navigator.userAgent});
const report=e=>trace('error',{message:String(e?.message||e)});
const cancelled=e=>e?.name==='AbortError';

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

// Show html in the frame as the current document; the next save is a Save As.
function show(html,nextHandle,name){
  frame.srcdoc=html;
  handle=nextHandle;docName=name;needSaveAs=true;dirty=false;
  document.title=APP+' — '+name;
  $('setup').hidden=true;
}
async function openFile(next,restore=false){
  if(dirty&&!confirm('Discard unsaved changes?'))return;
  const text=await(await next.getFile()).text();
  show(text,next,next.name);
  trace('open',{name:next.name,length:text.length,restore});
  await storedHandle(next).catch(e=>trace('handle-store-error',{message:String(e)}));
}
async function openDialog(){
  const [picked]=await showOpenFilePicker({types:FILE_TYPES,multiple:false,startIn:handle||'documents'});
  await openFile(picked);
}
function newFile(){
  if(dirty&&!confirm('Discard unsaved changes?'))return;
  show(BLANK,null,'untitled.html');
  trace('new');
}
// Test stage: messages from the CLI arrive as web+collabdoc: links (protocol handler in the manifest).
// They are shown briefly and logged with the delay since the sender's timestamp (t=, ms since epoch).
function toast(text){
  const el=document.createElement('div');el.textContent=text;
  el.style.cssText='position:fixed;bottom:40px;right:8px;z-index:2;background:#ffe;border:1px solid #cc9;padding:6px 10px;font:13px sans-serif';
  document.body.appendChild(el);setTimeout(()=>el.remove(),5000);
}
// Messages from the CLI, through the relay (source 'relay') or as web+collabdoc: links (source 'protocol').
// connect: connect to the relay. agent-saved: the agent saved a file; shown in the footer and acknowledged,
// but the document is not reloaded yet. Anything else: earlier delivery tests, logged with their delay.
function message(source,text){
  const body=text.replace(/^web\+collabdoc:/i,''),kind=body.split('?')[0];
  const params=new URLSearchParams(body.includes('?')?body.slice(body.indexOf('?')+1):'');
  const sent=Number(params.get('t'))||null,delayMs=sent?Date.now()-sent:null;
  if(kind==='connect'){trace('connect-link',{source});connectRelay();return;}
  if(kind==='agent-saved'){
    const file=params.get('file')||'',version=params.get('v')||'';
    trace('agent-saved',{source,file,version,delayMs,open:file===docName});
    status('Agent saved '+file+(file===docName?' (not reloaded yet)':''),4000);
    if(relay&&relay.readyState===WebSocket.OPEN)relay.send('ack '+version);
    return;
  }
  trace(source+'-message',{text,delayMs,focused:document.hasFocus(),visibility:document.visibilityState});
  toast('CLI message ('+source+'): '+text);
}
function protocolMessage(targetURL){
  const text=new URL(targetURL).searchParams.get('msg');  // the whole web+collabdoc:... link, already decoded
  if(text)message('protocol',text);
}
// The relay: a local program on this computer (ws://127.0.0.1:47615), started by the CLI, that carries
// messages between the CLI and this app. Connects at start, when the window regains focus, and on a
// web+collabdoc:connect link from the CLI; never on a timer.
let relay=null;
function connectRelay(){
  if(relay&&(relay.readyState===WebSocket.OPEN||relay.readyState===WebSocket.CONNECTING))return;
  try{relay=new WebSocket('ws://127.0.0.1:47615');}catch(e){trace('relay-error',{message:String(e)});return;}
  relay.onopen=()=>trace('relay-open');
  relay.onclose=e=>trace('relay-close',{code:e.code});
  relay.onmessage=e=>message('relay',String(e.data));
}
connectRelay();
window.addEventListener('focus',connectRelay);
if('launchQueue'in window)launchQueue.setConsumer(({files,targetURL})=>{
  trace('launch',{files:files.length,targetURL:targetURL||null});
  if(targetURL&&targetURL.includes('msg='))protocolMessage(targetURL);
  if(files[0])openFile(files[0]).catch(report);
});

// Make each loaded document editable (designMode on the framed document only; nothing is
// written into the user's file) and hook its keys. Runs once per loaded document.
const prepared=new WeakSet();
function prepare(){
  const doc=frame.contentDocument;
  if(!doc){trace('iframe-access-failed');return;}
  if(prepared.has(doc))return;
  prepared.add(doc);
  doc.designMode='on';
  doc.addEventListener('keydown',onKey);
  doc.addEventListener('input',()=>{if(!dirty)trace('edit-start');dirty=true;},{passive:true});
  trace('iframe-load',{editable:doc.designMode==='on',url:doc.URL});
}
frame.addEventListener('load',prepare);
// The sample may finish loading before this deferred script runs.
if(frame.contentDocument&&frame.contentDocument.URL!=='about:blank'&&frame.contentDocument.readyState==='complete')prepare();

// Returns true when saved, false when the user cancelled the Save As dialog.
async function save(){
  if(saving)return false;
  const doc=frame.contentDocument;
  if(!doc?.documentElement)throw Error('Document has not loaded');
  saving=true;trace('save-start',{name:docName,saveAs:needSaveAs||!handle});
  try{
    let target=handle;
    if(needSaveAs||!target){
      // Opens in the folder of the original file, preloaded with its name.
      target=await showSaveFilePicker({suggestedName:docName,types:FILE_TYPES,startIn:handle||'documents'});
    }else if(await target.requestPermission({mode:'readwrite'})!=='granted')throw Error('Write permission denied');
    const html=(doc.doctype?'<!doctype '+doc.doctype.name+'>\n':'')+doc.documentElement.outerHTML;
    const stream=await target.createWritable();
    try{await stream.write(html);await stream.close();}
    catch(error){await stream.abort().catch(()=>{});throw error;}
    handle=target;docName=target.name;needSaveAs=false;dirty=false;
    document.title=APP+' — '+docName;
    const bytes=new Blob([html]).size;
    trace('save-ok',{name:docName,bytes});
    if(relay&&relay.readyState===WebSocket.OPEN)relay.send('human-saved '+docName+' '+bytes);  // alert for the agent
    await storedHandle(target).catch(e=>trace('handle-store-error',{message:String(e)}));
    return true;
  }catch(error){
    if(cancelled(error)){trace('save-cancelled');return false;}
    trace('save-error',{message:String(error)});throw error;
  }finally{saving=false;}
}
const guard=(label,fn)=>()=>Promise.resolve().then(fn).catch(error=>{
  if(cancelled(error))return trace(label+'-cancelled');
  report(error);alert(label+' failed: '+(error?.message||error));
});
const saveClicked=guard('Save',save),openClicked=guard('Open',openDialog),newClicked=guard('New',newFile);
const KEYS={s:saveClicked,o:openClicked,n:newClicked};
function onKey(e){
  if(!(e.ctrlKey||e.metaKey)||e.altKey||e.shiftKey)return;
  const action=KEYS[e.key.toLowerCase()];
  if(!action)return;
  e.preventDefault();e.stopPropagation();action();
}
window.addEventListener('keydown',onKey);
$('save').addEventListener('click',saveClicked);
$('open').addEventListener('click',openClicked);
$('new').addEventListener('click',newClicked);
$('log').addEventListener('click',()=>{
  const blob=new Blob([traces.join('\n')+'\n'],{type:'text/plain'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='CollabDoc-browser-log.txt';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
});

// Download may be blocked because appinstalled is not always a user gesture.
// Keep a visible fallback link for the user to initiate the same download.
// The CLI's fingerprint (downloads/cli-version.json) is remembered when its installer is downloaded, so an
// app update downloads the CLI again only when the CLI changed.
async function cliFingerprint(){
  try{return (await(await fetch('./downloads/cli-version.json',{cache:'no-store'})).json()).cli||null;}
  catch(e){trace('cli-version-unavailable',{message:String(e)});return null;}
}
async function rememberCli(){const id=await cliFingerprint();if(id)try{localStorage.setItem('collabdoc-cli',id);}catch{}}
function downloadCli(reason){
  trace('cli-download-attempt',{reason});
  $('cli').click();
}
async function downloadCliIfChanged(){
  const id=await cliFingerprint();let last=null;
  try{last=localStorage.getItem('collabdoc-cli');}catch{}
  trace('cli-check',{current:id,last});
  if(id&&id!==last)downloadCli('cli changed');
}
$('cli').addEventListener('click',()=>{rememberCli();});  // manual or automatic, the downloaded CLI is recorded
window.addEventListener('appinstalled',()=>{trace('appinstalled');downloadCli('app installed');});

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
      try{if(!await save())return trace('update-deferred-unsaved');}catch(e){return report(e);}
    }
    reloadForUpdate=true;
    if(handle)sessionStorage.setItem('collabdoc-reopen','1');
    sessionStorage.setItem('collabdoc-updated','1');
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
// After an accepted update reloads the app, show "Updated" in the footer for a few seconds.
function status(text,ms){const el=$('status');el.textContent=text;el.hidden=false;setTimeout(()=>{el.hidden=true;},ms);}
if(sessionStorage.getItem('collabdoc-updated')==='1'){
  sessionStorage.removeItem('collabdoc-updated');
  status('Updated',4000);trace('updated-shown',{version:VERSION});
  downloadCliIfChanged();  // an update with a new CLI downloads its installer
}
if(sessionStorage.getItem('collabdoc-reopen')==='1'){
  sessionStorage.removeItem('collabdoc-reopen');
  storedHandle().then(h=>h&&openFile(h,true)).catch(e=>trace('restore-failed',{message:String(e)}));
}
checkUpdates().catch(report);
