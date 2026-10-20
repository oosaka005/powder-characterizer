'use strict';

let settings = null;
let latestState = null;
let previewUrl = null;
let reposeConfirmationUrl = null;
let reposeConfirmationId = null;
let materialRows = [];
let historyRecords = [];
let historyLoaded = false;
let historyRequest = 0;
let numericTarget = null;
let textShift = false;
let confirmResolver = null;
let bulkDensityReplicates = Array.from({length:3},()=>({mass_g:null,volume_ml:null}));
let pendingManualBulk = null;

const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function toast(message, error=false) {
  const element = $('toast');
  element.textContent = message;
  element.style.background = error ? '#9d3131' : '#25332d';
  element.style.display = 'block';
  clearTimeout(element._timer);
  element._timer = setTimeout(() => { element.style.display = 'none'; }, 4500);
}

async function api(url, options={}) {
  const response = await fetch(url, {headers:{'Content-Type':'application/json',...(options.headers || {})}, ...options});
  if (!response.ok) {
    let message = response.statusText;
    try { message = (await response.json()).detail || message; } catch (_) {}
    throw new Error(message);
  }
  const type = response.headers.get('content-type') || '';
  return type.includes('application/json') ? response.json() : response.blob();
}

function showPage(name) {
  document.querySelectorAll('.page').forEach(element => element.classList.remove('active'));
  document.querySelectorAll('#main-nav button').forEach(button => button.classList.toggle('active', button.dataset.page === name));
  $('page-' + name).classList.add('active');
  if (name === 'materials') loadMaterials();
  if (name === 'history') loadHistory();
  window.scrollTo({top:0, behavior:'instant'});
}

function showAutoView(name) {
  document.querySelectorAll('.auto-view').forEach(element => element.classList.remove('active'));
  document.querySelectorAll('[data-auto-view]').forEach(button => button.classList.toggle('active', button.dataset.autoView === name));
  $('auto-' + name).classList.add('active');
  window.scrollTo({top:0, behavior:'instant'});
}

document.querySelectorAll('#main-nav button').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));
document.querySelectorAll('[data-auto-view]').forEach(button => button.addEventListener('click', () => showAutoView(button.dataset.autoView)));

function choiceButtons(groupId) { return [...$(groupId).querySelectorAll('.choice-button')]; }
function setSingleChoice(groupId, value) { choiceButtons(groupId).forEach(button => button.classList.toggle('selected', button.dataset.value === String(value))); }
function getSingleChoice(groupId) { return choiceButtons(groupId).find(button => button.classList.contains('selected'))?.dataset.value; }
function setMultiChoices(groupId, values) { const selected = new Set(values.map(String)); choiceButtons(groupId).forEach(button => button.classList.toggle('selected', selected.has(button.dataset.value))); }
function getMultiChoices(groupId) { return choiceButtons(groupId).filter(button => button.classList.contains('selected')).map(button => Number(button.dataset.value)); }

document.addEventListener('click', event => {
  const button = event.target.closest('.choice-button');
  if (!button) return;
  const group = button.closest('.choice-group');
  if (group.dataset.selection === 'multi') button.classList.toggle('selected');
  else group.querySelectorAll('.choice-button').forEach(candidate => candidate.classList.toggle('selected', candidate === button));
  if (group.id === 'history-evaluation') rebuildHistoryFilters();
});

function decimalsFor(stepper) { return Number(stepper.dataset.decimals || 0); }
function getStepValue(id) { return Number($(id).dataset.value ?? $(id).textContent); }
function setStepValue(idOrElement, value) {
  const display = typeof idOrElement === 'string' ? $(idOrElement) : idOrElement;
  const stepper = display.closest('.touch-stepper');
  const minimum = Number(stepper.dataset.min);
  const maximum = Number(stepper.dataset.max);
  const decimals = decimalsFor(stepper);
  const clamped = Math.min(maximum, Math.max(minimum, Number(value)));
  display.dataset.value = String(clamped);
  display.textContent = decimals === 0 ? String(Math.round(clamped)) : clamped.toFixed(decimals);
}

document.querySelectorAll('.touch-stepper').forEach(stepper => {
  const display = stepper.querySelector('.stepper-value');
  stepper.querySelector('.stepper-minus').addEventListener('click', () => setStepValue(display, getStepValue(display.id) - Number(stepper.dataset.step)));
  stepper.querySelector('.stepper-plus').addEventListener('click', () => setStepValue(display, getStepValue(display.id) + Number(stepper.dataset.step)));
  display.addEventListener('click', () => openNumericKeypad(display));
});

function buildNumericKeypad() {
  const keypad = $('numeric-keypad');
  ['7','8','9','4','5','6','1','2','3','0','.','⌫'].forEach(key => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = key;
    button.addEventListener('click', () => numericKey(key));
    keypad.appendChild(button);
  });
}

function openNumericKeypad(display) {
  numericTarget = display;
  $('numeric-title').textContent = display.dataset.numericTitle || display.closest('div')?.previousElementSibling?.textContent || 'Enter a Number';
  $('numeric-display').textContent = Number.isFinite(Number(display.dataset.value)) ? display.dataset.value : '0';
  $('numeric-dialog').showModal();
}

function numericKey(key) {
  const output = $('numeric-display');
  let value = output.textContent;
  if (key === '⌫') value = value.slice(0, -1);
  else if (key === '.' && value.includes('.')) return;
  else value = value === '0' && key !== '.' ? key : value + key;
  output.textContent = value || '0';
}

$('numeric-ok').addEventListener('click', event => {
  event.preventDefault();
  const value = Number($('numeric-display').textContent);
  if (!Number.isFinite(value) || !numericTarget) return;
  if(numericTarget.classList.contains('bulk-value-button')){
    if(value<=0){toast('Enter a value greater than zero.',true);return;}
    const row=Number(numericTarget.dataset.row),field=numericTarget.dataset.field;
    bulkDensityReplicates[row][field]=value;
    numericTarget.dataset.value=String(value);numericTarget.textContent=formatNumber(value,3);
    renderBulkDensitySummary();
  }else setStepValue(numericTarget, value);
  $('numeric-dialog').close('default');
});

function buildTextKeyboard() {
  const keyboard = $('text-keyboard');
  [['1234567890','ten'],['QWERTYUIOP','ten'],['ASDFGHJKL','nine'],['ZXCVBNM','seven']].forEach(([letters, className]) => {
    const row = document.createElement('div'); row.className = `keyboard-row ${className}`;
    [...letters].forEach(letter => { const button=document.createElement('button'); button.type='button'; button.textContent=letter; button.addEventListener('click',()=>textKey(letter)); row.appendChild(button); });
    keyboard.appendChild(row);
  });
  const actions = document.createElement('div'); actions.className='keyboard-row actions';
  [['shift','Aa'],['hyphen','-'],['space','Space'],['back','⌫']].forEach(([key,label]) => { const button=document.createElement('button'); button.type='button'; button.textContent=label; button.addEventListener('click',()=>textKey(key)); actions.appendChild(button); });
  keyboard.appendChild(actions);
}

function textKey(key) {
  const output = $('text-display');
  if (key === 'shift') { textShift = !textShift; return; }
  if (key === 'space') output.textContent += ' ';
  else if (key === 'hyphen') output.textContent += '-';
  else if (key === 'back') output.textContent = output.textContent.slice(0,-1);
  else { output.textContent += textShift ? key : key.toLowerCase(); textShift = false; }
}

$('new-material').addEventListener('click', () => { $('text-display').textContent=''; textShift=false; $('text-dialog').showModal(); });
$('text-ok').addEventListener('click', event => {
  event.preventDefault();
  const name = $('text-display').textContent.trim();
  if (!name) { toast('Enter a material name.', true); return; }
  const select = $('material_name');
  if (![...select.options].some(option => option.value === name)) select.add(new Option(name, name));
  select.value = name;
  $('text-dialog').close('default');
});

function setToggle(id, enabled) { $(id).setAttribute('aria-checked', enabled ? 'true':'false'); }
function getToggle(id) { return $(id).getAttribute('aria-checked') === 'true'; }
['manual_aug','update-db'].forEach(id => $(id).addEventListener('click', () => setToggle(id, !getToggle(id))));

function confirmAction(title, message, confirmLabel='Continue', tone='danger') {
  $('confirm-title').textContent=title; $('confirm-message').textContent=message; $('confirm-ok').textContent=confirmLabel;
  $('confirm-ok').className=tone==='primary'?'primary':'danger';
  $('confirm-dialog').returnValue='';
  $('confirm-dialog').showModal();
  return new Promise(resolve => { confirmResolver=resolve; });
}
$('confirm-dialog').addEventListener('close', () => { if (confirmResolver) { confirmResolver($('confirm-dialog').returnValue === 'default'); confirmResolver=null; } });
$('reload-page').addEventListener('click',async()=>{
  const approved=await confirmAction('Reload Screen','Reload the Web UI now? An active measurement will continue on the Raspberry Pi. Unsaved manual entries will be lost.','Reload','primary');
  if(approved)location.reload();
});

function populateMaterialOptions(rows, currentName='') {
  const names = [...new Set(rows.map(row => row.mat_name).filter(Boolean))];
  if (currentName && !names.includes(currentName)) names.push(currentName);
  names.sort((a,b)=>a.localeCompare(b));
  $('material_name').replaceChildren(...names.map(name => new Option(name, name)));
  if (currentName) $('material_name').value=currentName;
}

function fillSettings(value) {
  settings=value;
  const material=value.material, calibration=value.calibration, tapped=value.tapped_density, manual=value.manual;
  $('disk_id').innerHTML=Object.keys(value.disk_master).map(id=>`<button class="choice-button" data-value="${escapeHtml(id)}">${escapeHtml(id)}</button>`).join('');
  populateMaterialOptions(materialRows, material.material_name);
  setSingleChoice('part_type',material.part_type); setSingleChoice('disk_id',material.disk_id);
  setMultiChoices('vib_levels',calibration.vib_levels); setMultiChoices('vib_times',calibration.vib_time_candidates);
  setStepValue('steps_per_level',calibration.steps_per_level); setStepValue('stability_steps',calibration.stability_steps); setStepValue('noise_threshold',calibration.noise_threshold_g);
  setStepValue('tapped_repeats',tapped.repeats); setStepValue('tapped_level',tapped.vib_level); setStepValue('tapped_sec',tapped.vib_sec);
  setStepValue('manual_level',manual.manual_vibration_level); setStepValue('manual_sec',manual.manual_vibration_sec); setStepValue('manual_count',manual.manual_dose_count); setToggle('manual_aug',manual.manual_use_aug);
  setSingleChoice('focus_mode',manual.manual_camera_focus_mode); setStepValue('lens_position',manual.manual_camera_lens_position);
}

function collectSettings() {
  const result=structuredClone(settings);
  const levels=getMultiChoices('vib_levels'), times=getMultiChoices('vib_times');
  if (!levels.length) throw new Error('Select at least one vibration level.');
  if (!times.length) throw new Error('Select at least one vibration time.');
  Object.assign(result.material,{material_name:$('material_name').value,part_type:getSingleChoice('part_type'),disk_id:getSingleChoice('disk_id')});
  Object.assign(result.calibration,{vib_levels:levels,vib_time_candidates:times,steps_per_level:getStepValue('steps_per_level'),stability_steps:getStepValue('stability_steps'),noise_threshold_g:getStepValue('noise_threshold')});
  Object.assign(result.tapped_density,{repeats:getStepValue('tapped_repeats'),vib_level:getStepValue('tapped_level'),vib_sec:getStepValue('tapped_sec')});
  Object.assign(result.manual,{manual_vibration_level:getStepValue('manual_level'),manual_vibration_sec:getStepValue('manual_sec'),manual_use_aug:getToggle('manual_aug'),manual_dose_count:getStepValue('manual_count'),manual_camera_focus_mode:getSingleChoice('focus_mode'),manual_camera_lens_position:getStepValue('lens_position')});
  return result;
}

async function saveSettings() { settings=collectSettings(); await api('/api/settings',{method:'PUT',body:JSON.stringify(settings)}); toast('Evaluation settings saved.'); }
function setMeasurementMode(mode){document.querySelectorAll('.measurement-mode').forEach(element=>element.classList.toggle('active',element.id===`${mode}-measurement`));}
async function startAutomated() { setMeasurementMode('automated');await api('/api/runs/automated',{method:'POST'});showPage('auto');showAutoView('run');toast('Full evaluation started.'); }

$('save-settings').addEventListener('click',()=>saveSettings().catch(error=>toast(error.message,true)));
$('save-continue').addEventListener('click',async()=>{try{await saveSettings();showAutoView('select');}catch(error){toast(error.message,true);}});
$('back-to-selection').addEventListener('click',()=>showAutoView('select'));
$('abort-run').addEventListener('click',async()=>{if(await confirmAction('Abort Measurement','Abort the measurement currently in progress?','Abort Measurement')) api('/api/runs/abort',{method:'POST'}).then(()=>toast('Measurement abort requested.')).catch(error=>toast(error.message,true));});

const statusLabels={idle:'Idle',running:'Running',completed:'Completed',failed:'Error',aborted:'Aborted',gateway_error:'Connection Error'};
const stageLabels={calibration:'Calibration',bulk_density:'Bulk Density',tapped_density:'Tapped Density',angle_of_repose:'Angle of Repose',manual:'Manual Operation'};
const formatNumber=(value,digits=3)=>value===null||value===undefined||value===''?'—':Number.isFinite(Number(value))?Number(value).toFixed(digits).replace(/\.?0+$/,''):String(value);

function renderManualOperationState(state){
  if(state.operation!=='manual')return;
  const feedback=$('manual-feedback'),running=state.status==='running',result=state.result||{};
  const requested=Number(result.requested_steps||0),succeeded=Number(result.succeeded_steps||0);
  const stopped=result.success===false||requested>succeeded;
  feedback.classList.toggle('running',running);
  feedback.classList.toggle('success',state.status==='completed'&&!stopped);
  feedback.classList.toggle('error',state.status==='failed'||state.status==='aborted'||stopped);
  $('manual-run').disabled=running;
  $('dispense-once').disabled=running;
  $('manual-run-status').textContent=running?'Running':stopped?'Stopped':statusLabels[state.status]||'Ready';
  if(running){
    $('manual-run-summary').textContent='Manual dispensing is in progress.';
  }else if(state.status==='failed'||state.status==='aborted'){
    $('manual-run-summary').textContent=state.error||'The manual dispense did not complete.';
  }else if(stopped){
    const reason=result.failed_step?.stop_reason;
    $('manual-run-summary').textContent=`Stopped after ${succeeded} of ${requested} dispenses.${reason?` Rotation motor: ${reason}.`:' Check the rotation motor and chamber sensor.'}`;
  }else if(state.status==='completed'&&requested>0){
    $('manual-run-summary').textContent=`Completed successfully: ${succeeded} of ${requested} dispenses.`;
  }else if(state.status==='completed'){
    $('manual-run-summary').textContent='Manual vibration completed successfully.';
  }
  $('manual-run-log').textContent=(state.logs||[]).join('\n')||state.error||'Waiting for a manual operation.';
}

function updateState(state) {
  const previousPending=Boolean(latestState?.result_pending); latestState=state;
  $('run-status').textContent=statusLabels[state.status]||state.status||'Unknown'; $('run-stage').textContent=stageLabels[state.stage]||state.stage||'—'; $('run-elapsed').textContent=`${Number(state.elapsed_sec||0).toFixed(1)} s`; $('run-progress').value=state.progress||0;
  $('run-log').textContent=(state.logs||[]).join('\n')||'Waiting for a measurement.';
  if(!pendingManualBulk)$('result-json').textContent=state.result?JSON.stringify(state.result,null,2):state.error||'No measurement result is available.';
  const running=state.status==='running', pending=Boolean(state.result_pending);
  $('back-to-selection').disabled=running; $('abort-run').disabled=!running; $('save-result').disabled=!pending&&!pendingManualBulk; $('discard-result').disabled=!pending&&!pendingManualBulk;
  renderManualOperationState(state);
  if(pendingManualBulk)return;
  renderResultSummary(state); renderArtifacts(state);
  if (running && state.operation!=='manual' && !previousPending) { setMeasurementMode('automated');showPage('auto');showAutoView('run'); }
  if (pending && !previousPending) { showPage('auto'); showAutoView('result'); }
}

function renderResultSummary(state) {
  const root=state.result; const box=$('result-summary');
  if (!root) { box.innerHTML='<div class="empty-state">No measurement result is available.</div>'; return; }
  const data=root.result_data||root; const metadata=data.metadata||root.metadata||{}; const calibration=data.calibration; const hausner=data.hausner; const tapped=data.tapped_density||hausner?.tapped_density; const repose=data.angle_of_repose;
  const cards=[]; const material=metadata.app_settings?.material?.material_name||metadata.material_name;
  if(material) cards.push(['Material',material]);
  if(calibration) cards.push(['Selected Vibration Level',formatNumber(calibration.selected_vib_level,0)],['Mean Dispense Mass',`${formatNumber(calibration.step_mass_mean)} g`]);
  if(tapped) cards.push(['Tapped Density',`${formatNumber(tapped.mean,4)} g/mL`],['Tapped Density SD',`${formatNumber(tapped.stdev,4)} g/mL`],['Replicates',formatNumber(tapped.densities?.length,0)]);
  if(hausner?.bulk_density) cards.push(['Bulk Density',`${formatNumber(hausner.bulk_density.mean,4)} g/mL`],['Hausner Ratio',formatNumber(hausner.ratio)],['Flowability',hausner.class||'—']);
  if(repose) cards.push(['Angle of Repose',`${formatNumber(repose.angle_deg,1)}°`],['Repose Classification',repose.class||'—']);
  const stage=metadata.stage; const stageData=stage?data[stage]:null;
  if(stageData&&!calibration&&!tapped&&!repose){if(stageData.mean!==undefined)cards.push(['Mean',formatNumber(stageData.mean)],['Standard Deviation',formatNumber(stageData.stdev)]);if(stageData.angle_deg!==undefined)cards.push(['Angle of Repose',`${formatNumber(stageData.angle_deg,1)}°`],['Classification',stageData.class||'—']);}
  box.innerHTML=(cards.length?cards:[['Status','Review the result.']]).map(([label,value])=>`<div class="result-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
}

function renderArtifacts(state) {
  const box=$('artifacts'), artifacts=state.result?.artifacts||{}, entries=Object.values(artifacts);
  if(!entries.length){box.textContent='No images are available.';return;}
  box.innerHTML=entries.map(item=>{const filename=String(item.filename||'');const url=`/api/runs/${encodeURIComponent(state.run_id)}/artifacts/${encodeURIComponent(filename)}`;return `<figure><img src="${url}" alt="${escapeHtml(filename)}"><figcaption>${escapeHtml(filename)}</figcaption></figure>`;}).join('');
}

async function saveCurrentResult(){
  if(pendingManualBulk){
    await api('/api/results/manual-bulk-density',{method:'POST',body:JSON.stringify({...pendingManualBulk,update_material_database:getToggle('update-db')})});
    pendingManualBulk=null;historyLoaded=false;await loadMaterials();toast('Manual bulk-density result saved.');
  }else{
    await api('/api/results/save',{method:'POST',body:JSON.stringify({update_material_database:getToggle('update-db')})});
    historyLoaded=false;await loadMaterials();toast('Measurement result saved.');
  }
  setToggle('update-db',false);showAutoView('select');
}

$('save-result').addEventListener('click',()=>saveCurrentResult().catch(error=>toast(error.message,true)));
$('discard-result').addEventListener('click',async()=>{
  if(!await confirmAction('Discard Result','This measurement result will not be saved. Discard it?','Discard Result'))return;
  if(pendingManualBulk){pendingManualBulk=null;setToggle('update-db',false);updateState(latestState);showAutoView('select');toast('Manual bulk-density entry discarded.');return;}
  api('/api/results/discard',{method:'POST'}).then(()=>{toast('Measurement result discarded.');showAutoView('select');}).catch(error=>toast(error.message,true));
});

async function saveManualFields(){settings=collectSettings();await api('/api/settings',{method:'PUT',body:JSON.stringify(settings)});}
async function manualRun(count=null){
  await saveManualFields();
  const doseCount=count??getStepValue('manual_count');
  const payload={vibration_level:getStepValue('manual_level'),vibration_seconds:getStepValue('manual_sec'),dose_count:doseCount,use_auger:getToggle('manual_aug')};
  $('manual-feedback').className='manual-feedback running';
  $('manual-run-status').textContent='Starting';
  $('manual-run-summary').textContent=`Starting ${doseCount} manual dispense${doseCount===1?'':'s'}…`;
  $('manual-run-log').textContent='Sending the manual operation to the dispenser…';
  $('manual-run').disabled=true;$('dispense-once').disabled=true;
  try{await api('/api/runs/manual',{method:'POST',body:JSON.stringify(payload)});}
  catch(error){$('manual-feedback').className='manual-feedback error';$('manual-run-status').textContent='Error';$('manual-run-summary').textContent=error.message;$('manual-run-log').textContent=error.message;$('manual-run').disabled=false;$('dispense-once').disabled=false;throw error;}
}
$('manual-run').addEventListener('click',()=>manualRun().catch(error=>toast(error.message,true)));
$('dispense-once').addEventListener('click',()=>manualRun(1).catch(error=>toast(error.message,true)));
$('clear-clog').addEventListener('click',async()=>{if(await confirmAction('Clear Clog','Run the dispenser clog-clearing operation?','Clear Clog')) api('/api/runs/clear-clog',{method:'POST'}).then(()=>toast('Clog-clearing operation completed.')).catch(error=>toast(error.message,true));});

async function preview(url,body){const blob=await api(url,{method:'POST',body:body?JSON.stringify(body):undefined});if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(blob);$('preview-image').src=previewUrl;$('preview-image').style.display='block';}
$('camera-preview').addEventListener('click',async()=>{try{await saveManualFields();await preview('/api/camera/preview',{focus_mode:getSingleChoice('focus_mode'),lens_position:getStepValue('lens_position')});}catch(error){toast(error.message,true);}});
$('repose-preview').addEventListener('click',()=>preview('/api/camera/repose-preview').catch(error=>toast(error.message,true)));

function openBulkDensityEntry(){
  if(!settings){toast('Settings are not available.',true);return;}
  pendingManualBulk=null;
  bulkDensityReplicates=Array.from({length:3},()=>({mass_g:null,volume_ml:null}));
  document.querySelectorAll('.bulk-value-button').forEach(button=>{delete button.dataset.value;button.textContent='Enter';});
  for(let index=0;index<3;index++)$('bulk-density-'+index).textContent='—';
  $('bulk-density-context').textContent=`Material: ${settings.material.material_name}\nDisk ID: ${settings.material.disk_id}`;
  renderBulkDensitySummary();
  setMeasurementMode('bulk-density');showPage('auto');showAutoView('run');
}

function bulkDensityValues(){return bulkDensityReplicates.map(row=>row.mass_g&&row.volume_ml?row.mass_g/row.volume_ml:null);}
function sampleStdev(values){if(values.length<2)return 0;const avg=values.reduce((sum,value)=>sum+value,0)/values.length;return Math.sqrt(values.reduce((sum,value)=>sum+(value-avg)**2,0)/(values.length-1));}
function renderBulkDensitySummary(){
  const values=bulkDensityValues();
  values.forEach((value,index)=>{$('bulk-density-'+index).textContent=value?formatNumber(value,4):'—';});
  const complete=values.filter(value=>value!==null);
  $('review-bulk-density').disabled=complete.length!==3;
  if(complete.length!==3){$('bulk-density-summary').innerHTML='<div class="empty-state">Enter mass and volume for all three replicates.</div>';return;}
  const avg=complete.reduce((sum,value)=>sum+value,0)/complete.length,sd=sampleStdev(complete),cv=avg?sd/avg*100:null;
  $('bulk-density-summary').innerHTML=[['Mean',`${formatNumber(avg,4)} g/mL`],['SD',`${formatNumber(sd,4)} g/mL`],['CV',`${formatNumber(cv,2)} %`]].map(([label,value])=>metric(label,value)).join('');
}

document.querySelectorAll('.bulk-value-button').forEach(button=>button.addEventListener('click',()=>openNumericKeypad(button)));
$('cancel-bulk-density').addEventListener('click',()=>{pendingManualBulk=null;showAutoView('select');});
$('review-bulk-density').addEventListener('click',()=>{
  const values=bulkDensityValues();
  if(values.some(value=>value===null)){toast('Enter mass and volume for all three replicates.',true);return;}
  const mean=values.reduce((sum,value)=>sum+value,0)/values.length,stdev=sampleStdev(values),cv=mean?stdev/mean*100:null;
  pendingManualBulk={material_name:settings.material.material_name,disk_id:settings.material.disk_id,replicates:structuredClone(bulkDensityReplicates)};
  $('result-summary').innerHTML=[['Material',settings.material.material_name],['Disk ID',settings.material.disk_id],['Mean Bulk Density',`${formatNumber(mean,4)} g/mL`],['Bulk Density SD',`${formatNumber(stdev,4)} g/mL`],['CV',`${formatNumber(cv,2)} %`],['Replicates','3']].map(([label,value])=>`<div class="result-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  $('artifacts').textContent='No images are available for manual bulk-density measurements.';
  $('result-json').textContent=JSON.stringify({measurement:'bulk_density',source:'manual',material_name:settings.material.material_name,disk_id:settings.material.disk_id,replicates:bulkDensityReplicates,densities:values,mean,stdev,cv_percent:cv},null,2);
  setToggle('update-db',true);$('save-result').disabled=false;$('discard-result').disabled=false;showAutoView('result');
});

const singleTestConfirmations={
  calibration:{label:'Calibration',question:'Has the material priming been completed?'},
  bulk_density:{label:'Bulk Density',question:'Open the n=3 manual measurement entry for these conditions?'},
  tapped_density:{label:'Tapped Density',question:'Has the material priming been completed?'},
  angle_of_repose:{label:'Angle of Repose'}
};

async function captureReposeConfirmationImage(){
  const status=$('repose-preview-status'),image=$('repose-confirm-image'),retake=$('retake-repose-image'),analyze=$('analyze-repose-image');
  reposeConfirmationId=null;retake.disabled=true;analyze.disabled=true;image.style.display='none';status.style.display='grid';status.textContent='Capturing the current image…';
  const response=await fetch('/api/camera/repose-preview',{method:'POST',headers:{'Content-Type':'application/json'}});
  if(!response.ok){
    let message=response.statusText;
    try{message=(await response.json()).detail||message;}catch(_){}
    throw new Error(message);
  }
  const previewId=response.headers.get('X-Repose-Preview-Id');
  if(!previewId)throw new Error('The camera did not return a confirmation image ID.');
  const blob=await response.blob();
  if(reposeConfirmationUrl)URL.revokeObjectURL(reposeConfirmationUrl);
  reposeConfirmationUrl=URL.createObjectURL(blob);reposeConfirmationId=previewId;
  image.src=reposeConfirmationUrl;image.style.display='block';status.style.display='none';retake.disabled=false;analyze.disabled=false;
}

async function openReposeConfirmation(){
  if(!settings){toast('Settings are not available.',true);return;}
  $('repose-confirm-context').textContent=`Material: ${settings.material.material_name}\nDisk ID: ${settings.material.disk_id}`;
  $('repose-confirm-dialog').showModal();
  try{await captureReposeConfirmationImage();}
  catch(error){$('repose-preview-status').textContent=error.message;$('retake-repose-image').disabled=false;toast(error.message,true);}
}

$('retake-repose-image').addEventListener('click',()=>captureReposeConfirmationImage().catch(error=>{$('repose-preview-status').style.display='grid';$('repose-preview-status').textContent=error.message;$('retake-repose-image').disabled=false;toast(error.message,true);}));
$('analyze-repose-image').addEventListener('click',async()=>{
  if(!reposeConfirmationId)return;
  const previewId=reposeConfirmationId;
  $('analyze-repose-image').disabled=true;
  try{
    await api(`/api/runs/single/angle_of_repose?preview_id=${encodeURIComponent(previewId)}`,{method:'POST'});
    $('repose-confirm-dialog').close('default');setMeasurementMode('automated');showPage('auto');showAutoView('run');
  }catch(error){$('analyze-repose-image').disabled=false;toast(error.message,true);}
});

async function confirmSingleTest(stage){
  const confirmation=singleTestConfirmations[stage];
  if(!confirmation)return;
  if(stage==='angle_of_repose'){await openReposeConfirmation();return;}
  const material=settings?.material?.material_name||'Not selected';
  const disk=settings?.material?.disk_id||'Not selected';
  const approved=await confirmAction(`Confirm — ${confirmation.label}`,`Material: ${material}\nDisk ID: ${disk}\n\n${confirmation.question}`,stage==='bulk_density'?'Continue':'Yes, Start','primary');
  if(!approved)return;
  if(stage==='bulk_density'){openBulkDensityEntry();return;}
  try{
    await api('/api/runs/single/'+stage,{method:'POST'});
    setMeasurementMode('automated');showPage('auto');showAutoView('run');
  }catch(error){toast(error.message,true);}
}

async function confirmFullEvaluation(){
  const material=settings?.material?.material_name||'Not selected',disk=settings?.material?.disk_id||'Not selected';
  const approved=await confirmAction('Confirm — Full Evaluation',`Material: ${material}\nDisk ID: ${disk}\n\nSequence: Calibration → Angle of Repose → Tapped Density\n\nHas the material priming been completed?`,'Yes, Start','primary');
  if(!approved)return;
  try{await startAutomated();}catch(error){toast(error.message,true);}
}

document.querySelectorAll('.evaluation-choice').forEach(button=>button.addEventListener('click',()=>button.dataset.evaluation==='automated'?confirmFullEvaluation():confirmSingleTest(button.dataset.evaluation)));

function populateMaterialFilters(){const names=[...new Set(materialRows.map(row=>row.mat_name).filter(Boolean))].sort((a,b)=>a.localeCompare(b));$('material-filter').replaceChildren(new Option('All Materials',''),...names.map(name=>new Option(name,name)));updateDiskFilter();}
function updateDiskFilter(){const material=$('material-filter').value;const disks=[...new Set(materialRows.filter(row=>!material||row.mat_name===material).map(row=>row.diskID).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));const current=$('disk-filter').value;$('disk-filter').replaceChildren(new Option('All Disk IDs',''),...disks.map(id=>new Option(id,id)));if(disks.includes(current))$('disk-filter').value=current;renderMaterialTable();}
function renderMaterialTable(){
  const material=$('material-filter').value,disk=$('disk-filter').value;
  const rows=materialRows.filter(row=>(!material||row.mat_name===material)&&(!disk||row.diskID===disk)).sort((a,b)=>String(a.mat_name||'').localeCompare(String(b.mat_name||''),'en',{sensitivity:'base',numeric:true})||String(a.diskID||'').localeCompare(String(b.diskID||''),'en',{numeric:true}));
  const fields=[['mat_name','Material'],['diskID','Disk ID'],['volume_ml','Volume (mL)'],['vib_level','Vibration Level'],['vib_time','Vibration Time (s)'],['step_mass_mean','Mean Dispense Mass (g)'],['density_g_per_ml','Estimated Density (g/mL)'],['bulk_density_mean','Bulk Density (g/mL)'],['tapped_density_mean','Tapped Density (g/mL)'],['hausner_ratio','Hausner Ratio'],['hausner_class','Flowability'],['angle_of_repose_deg','Angle of Repose (°)'],['repose_class','Repose Classification']];
  $('material-table-wrap').innerHTML=rows.length?`<table class="material-table"><thead><tr>${fields.map(([,label])=>`<th scope="col">${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${fields.map(([key])=>`<td>${escapeHtml(key==='mat_name'||key==='diskID'?(row[key]??'—'):formatNumber(row[key]))}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<div class="empty-state">No matching Material DB records were found.</div>';
}
async function loadMaterials(){try{const previousMaterial=$('material-filter').value;materialRows=await api('/api/materials');populateMaterialOptions(materialRows,settings?.material?.material_name||'');populateMaterialFilters();if([...$('material-filter').options].some(option=>option.value===previousMaterial))$('material-filter').value=previousMaterial;updateDiskFilter();}catch(error){toast(error.message,true);}}
$('material-filter').addEventListener('change',updateDiskFilter);$('disk-filter').addEventListener('change',renderMaterialTable);$('refresh-materials').addEventListener('click',loadMaterials);

const evaluationLabels={calibration:'Vibration Optimization',tapped_density:'Tapped Density',bulk_density:'Bulk Density',hausner:'Hausner Ratio',angle_of_repose:'Angle of Repose'};
const classLabels={Excellent:'Excellent',Good:'Good',Fair:'Fair',Passable:'Passable',Poor:'Poor','Very poor':'Very Poor','Very, very poor':'Very, Very Poor'};

function formatHistoryTimestamp(value) {
  const match=String(value||'').match(/^(\d{4})(\d{2})(\d{2})[_ T]?(\d{2})?(\d{2})?(\d{2})?/);
  if(!match) return value||'Unknown date';
  return `${match[1]}/${match[2]}/${match[3]}${match[4]?` ${match[4]}:${match[5]||'00'}:${match[6]||'00'}`:''}`;
}

function uniqueValues(rows,key){return [...new Set(rows.map(row=>row[key]).filter(value=>value!==null&&value!==undefined&&value!==''))].sort((a,b)=>String(a).localeCompare(String(b),'en',{numeric:true}));}
function syncSelect(id,values,preferred,labeler=value=>value){
  const select=$(id), current=preferred??select.value;
  select.replaceChildren(...values.map(value=>new Option(labeler(value),value)));
  if(values.map(String).includes(String(current))) select.value=String(current);
  return select.value;
}

async function loadHistory(force=false){
  if(historyLoaded&&!force){rebuildHistoryFilters();return;}
  $('history-overview').innerHTML='<div class="empty-state">Loading measurement history…</div>';
  try{
    historyRecords=await api('/api/results/history');
    historyLoaded=true;
    rebuildHistoryFilters();
  }catch(error){
    $('history-overview').innerHTML=`<div class="empty-state">${escapeHtml(error.message)}</div>`;
    toast(error.message,true);
  }
}

function rebuildHistoryFilters(){
  if(!historyLoaded) return;
  const dispenser=syncSelect('history-dispenser',uniqueValues(historyRecords,'dispenser_id'));
  const dispenserRows=historyRecords.filter(row=>row.dispenser_id===dispenser);
  const material=syncSelect('history-material',uniqueValues(dispenserRows,'material_name'));
  const evaluation=getSingleChoice('history-evaluation')||'calibration';
  const evaluationRows=dispenserRows.filter(row=>row.material_name===material&&row.evaluation===evaluation);
  const disk=syncSelect('history-disk',uniqueValues(evaluationRows,'disk_id'));
  const records=evaluationRows.filter(row=>row.disk_id===disk).sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp)));
  const selected=syncSelect('history-record',records.map(row=>row.id),undefined,id=>{
    const row=records.find(item=>item.id===id);
    return `${formatHistoryTimestamp(row?.timestamp)} · ${row?.source_label||''}`;
  });
  if(selected) loadHistoryDetail(selected);
  else renderHistoryEmpty(`No saved ${evaluationLabels[evaluation]} result is available.`);
}

function renderHistoryEmpty(message){
  historyRequest+=1;
  $('history-overview').innerHTML=`<div class="empty-state">${escapeHtml(message)}</div>`;
  $('history-context').textContent='No result matches the selected conditions.';
  $('history-source').classList.remove('visible');
  $('history-charts').replaceChildren();$('history-artifacts').replaceChildren();$('history-json').textContent='No result is available.';
}

async function loadHistoryDetail(recordId){
  const request=++historyRequest;
  $('history-overview').innerHTML='<div class="empty-state">Loading result…</div>';
  try{
    const record=await api(`/api/results/history/${encodeURIComponent(recordId)}`);
    if(request!==historyRequest) return;
    renderHistoryDetail(record);
  }catch(error){if(request===historyRequest)renderHistoryEmpty(error.message);}
}

function outcomeLabel(value){return value===true?'Successful':value===false?'Review Required':'—';}
function translatedClass(value){return classLabels[value]||value||'—';}
function metric(label,value){return `<div class="result-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;}
function difference(first,second){return first===null||first===undefined||second===null||second===undefined?null:Number(first)-Number(second);}
function meanWithSpread(mean,spread){return mean===null||mean===undefined?'—':`${formatNumber(mean,4)} ± ${formatNumber(spread,4)} g/mL`;}

function renderHistoryDetail(record){
  const overview=record.overview||{};
  let cards=[];
  if(record.evaluation==='calibration') cards=[
    ['Status',outcomeLabel(overview.success)],['Selected Vibration Level',formatNumber(overview.selected_vib_level,0)],['Selected Vibration Time',`${formatNumber(overview.selected_vib_time,2)} s`],
    ['Mean Dispense Mass',`${formatNumber(overview.step_mass_mean,4)} g`],['Dispense Mass SD',`${formatNumber(overview.step_mass_std,4)} g`],['Estimated Density',`${formatNumber(overview.density_g_per_ml,4)} g/mL`]
  ];
  if(record.evaluation==='calibration'&&overview.failure_reason) cards.push(['Failure Reason',overview.failure_reason]);
  if(record.evaluation==='bulk_density'||record.evaluation==='tapped_density') cards=[
    ['Status',outcomeLabel(overview.success)],['Mean Density',`${formatNumber(overview.mean,4)} g/mL`],['Density SD',`${formatNumber(overview.stdev,4)} g/mL`],
    ['Replicates',formatNumber(overview.replicates,0)],['Method',overview.measurement_method==='manual_mass_volume'?'Manual mass / volume':'Device measurement']
  ];
  if(record.evaluation==='hausner') cards=[
    ['Status',outcomeLabel(overview.success)],['Hausner Ratio',formatNumber(overview.hausner_ratio,4)],['Flowability',translatedClass(overview.hausner_class)],
    ['Bulk Density Mean ± SD',meanWithSpread(overview.bulk_density_mean,overview.bulk_density_stdev)],['Tapped Density Mean ± SD',meanWithSpread(overview.tapped_density_mean,overview.tapped_density_stdev)],['Density Difference',`${formatNumber(difference(overview.tapped_density_mean,overview.bulk_density_mean),4)} g/mL`]
  ];
  if(record.evaluation==='angle_of_repose') cards=[['Status',outcomeLabel(overview.success)],['Angle of Repose',`${formatNumber(overview.angle_deg,2)}°`],['Flowability',translatedClass(overview.repose_class)]];
  $('history-overview').innerHTML=cards.map(([label,value])=>metric(label,value)).join('')||'<div class="empty-state">No summary data is available.</div>';
  $('history-context').textContent=`${record.dispenser_id} / ${record.material_name} / ${record.disk_id} · ${formatHistoryTimestamp(record.timestamp)}`;
  $('history-source').textContent=record.source_label;$('history-source').classList.add('visible');
  renderHistoryCharts(record);renderHistoryArtifacts(record);
  $('history-json').textContent=JSON.stringify(record.data||{},null,2);
}

function finiteValues(values){return (values||[]).map(Number).filter(Number.isFinite);}
function average(values){const data=finiteValues(values);return data.length?data.reduce((sum,value)=>sum+value,0)/data.length:null;}
function chartCard(title,series,note=''){
  const usable=series.map(item=>({...item,values:finiteValues(item.values)})).filter(item=>item.values.length);
  if(!usable.length) return '';
  const all=usable.flatMap(item=>item.values), minimum=Math.min(...all), maximum=Math.max(...all), spread=maximum-minimum||Math.max(Math.abs(maximum)*.1,.01);
  const low=minimum-spread*.12, high=maximum+spread*.12, left=52, right=505, top=32, bottom=205;
  const x=(index,length)=>length<=1?(left+right)/2:left+(right-left)*index/(length-1);
  const y=value=>bottom-(value-low)/(high-low)*(bottom-top);
  const colors=['#176b52','#b06b20','#6b55a4'];
  const grid=[0,.25,.5,.75,1].map(f=>{const py=top+(bottom-top)*f;const value=high-(high-low)*f;return `<line class="grid" x1="${left}" y1="${py}" x2="${right}" y2="${py}"/><text x="4" y="${py+4}">${escapeHtml(formatNumber(value,4))}</text>`;}).join('');
  const paths=usable.map((item,index)=>{const points=item.values.map((value,i)=>`${x(i,item.values.length)},${y(value)}`).join(' ');const color=item.color||colors[index%colors.length];const dots=item.values.map((value,i)=>`<circle class="point" style="fill:${color}" cx="${x(i,item.values.length)}" cy="${y(value)}" r="4"/>`).join('');return `<polyline class="line" style="stroke:${color}" points="${points}"/>${dots}`;}).join('');
  const legend=usable.map((item,index)=>`<span><i style="background:${item.color||colors[index%colors.length]}"></i>${escapeHtml(item.name)}</span>`).join('');
  return `<article class="chart-card"><h3>${escapeHtml(title)}</h3><div class="chart-legend">${legend}</div><svg class="history-chart" viewBox="0 0 520 225" role="img" aria-label="${escapeHtml(title)}"><line class="axis" x1="${left}" y1="${top}" x2="${left}" y2="${bottom}"/><line class="axis" x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}"/>${grid}${paths}</svg>${note?`<p>${escapeHtml(note)}</p>`:''}</article>`;
}

function renderHistoryCharts(record){
  const data=record.data||{};let html='';
  if(record.evaluation==='calibration'){
    $('history-charts').replaceChildren();
    return;
  }else if(record.evaluation==='bulk_density'||record.evaluation==='tapped_density'){
    html+=chartCard('Repeated Density Measurements',[{name:evaluationLabels[record.evaluation],values:data.densities}],'Unit: g/mL');
    html+=chartCard('Repeated Sample Mass Measurements',[{name:'Sample mass',values:data.masses}],'Unit: g');
  }else if(record.evaluation==='hausner'){
    const bulk=data.bulk_density||{}, tapped=data.tapped_density||{};
    html+=chartCard('Repeated Density Measurements',[{name:'Bulk density',values:bulk.densities},{name:'Tapped density',values:tapped.densities}],'Unit: g/mL');
    html+=chartCard('Repeated Sample Mass Measurements',[{name:'Bulk density test',values:bulk.masses},{name:'Tapped density test',values:tapped.masses}],'Unit: g');
  }
  $('history-charts').innerHTML=html||'<div class="empty-state">This result has no numerical data available for charts.</div>';
}

function renderHistoryArtifacts(record){
  const artifacts=record.artifacts||[], box=$('history-artifacts');
  if(!artifacts.length){box.innerHTML=record.evaluation==='angle_of_repose'?'<div class="empty-state">No saved images are available.</div>':'';return;}
  box.innerHTML=artifacts.map(item=>{const url=`/api/results/history/artifact/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.run_id)}/${encodeURIComponent(item.filename)}`;return `<figure><img loading="lazy" src="${url}" alt="${escapeHtml(item.label)}"><figcaption>${escapeHtml(item.label)}</figcaption></figure>`;}).join('');
}

$('history-dispenser').addEventListener('change',rebuildHistoryFilters);
$('history-material').addEventListener('change',rebuildHistoryFilters);
$('history-disk').addEventListener('change',rebuildHistoryFilters);
$('history-record').addEventListener('change',event=>event.target.value&&loadHistoryDetail(event.target.value));
$('refresh-history').addEventListener('click',()=>loadHistory(true));

function connectWebSocket(){const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws/run`);ws.onopen=()=>{$('conn-dot').className='dot ok';$('conn-label').textContent='Server Connected';};ws.onmessage=event=>updateState(JSON.parse(event.data));ws.onclose=()=>{$('conn-dot').className='dot bad';$('conn-label').textContent='Reconnecting…';setTimeout(connectWebSocket,1500);};ws.onerror=()=>ws.close();}

buildNumericKeypad();buildTextKeyboard();
Promise.all([api('/api/settings'),api('/api/runs/current'),api('/api/materials')]).then(([settingsValue,state,rows])=>{materialRows=rows;fillSettings(settingsValue);populateMaterialFilters();updateState(state);if(state.status==='running'&&state.operation!=='manual'){showPage('auto');showAutoView('run');}else if(state.operation==='manual'){showPage('manual');}else if(state.result_pending){showPage('auto');showAutoView('result');}connectWebSocket();}).catch(error=>{toast(error.message,true);$('conn-dot').className='dot bad';$('conn-label').textContent='Server Unavailable';setTimeout(()=>location.reload(),3000);});
