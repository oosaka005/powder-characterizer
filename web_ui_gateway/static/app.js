'use strict';

let settings = null;
let latestState = null;
let previewUrl = null;
let materialRows = [];
let historyRecords = [];
let historyLoaded = false;
let historyRequest = 0;
let numericTarget = null;
let textShift = false;
let confirmResolver = null;

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
  $('numeric-title').textContent = display.closest('div').previousElementSibling?.textContent || '数値を入力';
  $('numeric-display').textContent = display.textContent;
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
  setStepValue(numericTarget, value);
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
  [['shift','Aa'],['hyphen','－'],['space','スペース'],['back','⌫']].forEach(([key,label]) => { const button=document.createElement('button'); button.type='button'; button.textContent=label; button.addEventListener('click',()=>textKey(key)); actions.appendChild(button); });
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
  if (!name) { toast('材料名を入力してください。', true); return; }
  const select = $('material_name');
  if (![...select.options].some(option => option.value === name)) select.add(new Option(name, name));
  select.value = name;
  $('text-dialog').close('default');
});

function setToggle(id, enabled) { $(id).setAttribute('aria-checked', enabled ? 'true':'false'); }
function getToggle(id) { return $(id).getAttribute('aria-checked') === 'true'; }
['manual_aug','update-db'].forEach(id => $(id).addEventListener('click', () => setToggle(id, !getToggle(id))));

function confirmAction(title, message, confirmLabel='実行する') {
  $('confirm-title').textContent=title; $('confirm-message').textContent=message; $('confirm-ok').textContent=confirmLabel;
  $('confirm-dialog').returnValue='';
  $('confirm-dialog').showModal();
  return new Promise(resolve => { confirmResolver=resolve; });
}
$('confirm-dialog').addEventListener('close', () => { if (confirmResolver) { confirmResolver($('confirm-dialog').returnValue === 'default'); confirmResolver=null; } });

function populateMaterialOptions(rows, currentName='') {
  const names = [...new Set(rows.map(row => row.mat_name).filter(Boolean))];
  if (currentName && !names.includes(currentName)) names.push(currentName);
  names.sort((a,b)=>a.localeCompare(b));
  $('material_name').replaceChildren(...names.map(name => new Option(name, name)));
  if (currentName) $('material_name').value=currentName;
}

function fillSettings(value) {
  settings=value;
  const material=value.material, calibration=value.calibration, bulk=value.bulk_density, tapped=value.tapped_density, manual=value.manual;
  $('disk_id').innerHTML=Object.keys(value.disk_master).map(id=>`<button class="choice-button" data-value="${escapeHtml(id)}">${escapeHtml(id)}</button>`).join('');
  populateMaterialOptions(materialRows, material.material_name);
  setSingleChoice('part_type',material.part_type); setSingleChoice('disk_id',material.disk_id);
  setMultiChoices('vib_levels',calibration.vib_levels); setMultiChoices('vib_times',calibration.vib_time_candidates);
  setStepValue('steps_per_level',calibration.steps_per_level); setStepValue('stability_steps',calibration.stability_steps); setStepValue('noise_threshold',calibration.noise_threshold_g);
  setStepValue('bulk_repeats',bulk.repeats); setStepValue('bulk_weak',bulk.weak_vib_level); setStepValue('bulk_strong',bulk.strong_vib_level); setStepValue('bulk_sec',bulk.vib_sec_default);
  setStepValue('tapped_repeats',tapped.repeats); setStepValue('tapped_level',tapped.vib_level); setStepValue('tapped_sec',tapped.vib_sec);
  setStepValue('manual_level',manual.manual_vibration_level); setStepValue('manual_sec',manual.manual_vibration_sec); setStepValue('manual_count',manual.manual_dose_count); setToggle('manual_aug',manual.manual_use_aug);
  setSingleChoice('focus_mode',manual.manual_camera_focus_mode); setStepValue('lens_position',manual.manual_camera_lens_position);
}

function collectSettings() {
  const result=structuredClone(settings);
  const levels=getMultiChoices('vib_levels'), times=getMultiChoices('vib_times');
  if (!levels.length) throw new Error('振動レベルを1つ以上選択してください。');
  if (!times.length) throw new Error('振動時間を1つ以上選択してください。');
  Object.assign(result.material,{material_name:$('material_name').value,part_type:getSingleChoice('part_type'),disk_id:getSingleChoice('disk_id')});
  Object.assign(result.calibration,{vib_levels:levels,vib_time_candidates:times,steps_per_level:getStepValue('steps_per_level'),stability_steps:getStepValue('stability_steps'),noise_threshold_g:getStepValue('noise_threshold')});
  Object.assign(result.bulk_density,{repeats:getStepValue('bulk_repeats'),weak_vib_level:getStepValue('bulk_weak'),strong_vib_level:getStepValue('bulk_strong'),vib_sec_default:getStepValue('bulk_sec')});
  Object.assign(result.tapped_density,{repeats:getStepValue('tapped_repeats'),vib_level:getStepValue('tapped_level'),vib_sec:getStepValue('tapped_sec')});
  Object.assign(result.manual,{manual_vibration_level:getStepValue('manual_level'),manual_vibration_sec:getStepValue('manual_sec'),manual_use_aug:getToggle('manual_aug'),manual_dose_count:getStepValue('manual_count'),manual_camera_focus_mode:getSingleChoice('focus_mode'),manual_camera_lens_position:getStepValue('lens_position')});
  return result;
}

async function saveSettings() { settings=collectSettings(); await api('/api/settings',{method:'PUT',body:JSON.stringify(settings)}); toast('評価条件を保存しました。'); }
async function startAutomated() { await api('/api/runs/automated',{method:'POST'}); showPage('auto'); showAutoView('run'); toast('自動評価を開始しました。'); }
async function retryAutomated() { await api('/api/results/discard',{method:'POST'}); await startAutomated(); }

$('save-settings').addEventListener('click',()=>saveSettings().catch(error=>toast(error.message,true)));
$('save-start').addEventListener('click',async()=>{try{await saveSettings();await startAutomated();}catch(error){toast(error.message,true);}});
$('start-run').addEventListener('click',()=>startAutomated().catch(error=>toast(error.message,true)));
$('retry-run').addEventListener('click',async()=>{if(await confirmAction('同じ条件で再測定','現在の保存待ち結果を破棄して、同じ条件で測定を開始します。','再測定する')) retryAutomated().catch(error=>toast(error.message,true));});
$('abort-run').addEventListener('click',async()=>{if(await confirmAction('測定を中止','進行中の測定を中止します。よろしいですか？','測定を中止')) api('/api/runs/abort',{method:'POST'}).then(()=>toast('測定中止を要求しました。')).catch(error=>toast(error.message,true));});

const statusLabels={idle:'待機中',running:'測定中',completed:'完了',failed:'エラー',aborted:'中止',gateway_error:'接続エラー'};
const stageLabels={calibration:'校正',bulk_density:'かさ密度',tapped_density:'タップ密度',angle_of_repose:'安息角',manual:'手動操作'};
const formatNumber=(value,digits=3)=>value===null||value===undefined||value===''?'—':Number.isFinite(Number(value))?Number(value).toFixed(digits).replace(/\.?0+$/,''):String(value);

function updateState(state) {
  const previousPending=Boolean(latestState?.result_pending); latestState=state;
  $('run-status').textContent=statusLabels[state.status]||state.status||'不明'; $('run-stage').textContent=stageLabels[state.stage]||state.stage||'—'; $('run-elapsed').textContent=`${Number(state.elapsed_sec||0).toFixed(1)}秒`; $('run-progress').value=state.progress||0;
  $('run-log').textContent=(state.logs||[]).join('\n')||'測定待機中です。'; $('result-json').textContent=state.result?JSON.stringify(state.result,null,2):state.error||'測定結果はありません。';
  const running=state.status==='running', pending=Boolean(state.result_pending);
  $('start-run').disabled=running||pending; $('retry-run').disabled=running||!pending; $('abort-run').disabled=!running; $('save-result').disabled=!pending; $('discard-result').disabled=!pending;
  renderResultSummary(state); renderArtifacts(state);
  if (running && !previousPending) { showPage('auto'); showAutoView('run'); }
  if (pending && !previousPending) { showPage('auto'); showAutoView('result'); }
}

function renderResultSummary(state) {
  const root=state.result; const box=$('result-summary');
  if (!root) { box.innerHTML='<div class="empty-state">測定結果はありません。</div>'; return; }
  const data=root.result_data||root; const metadata=data.metadata||root.metadata||{}; const calibration=data.calibration; const hausner=data.hausner; const repose=data.angle_of_repose;
  const cards=[]; const material=metadata.app_settings?.material?.material_name||metadata.material_name;
  if(material) cards.push(['材料',material]);
  if(calibration) cards.push(['選択振動レベル',formatNumber(calibration.selected_vib_level,0)],['吐出質量平均',`${formatNumber(calibration.step_mass_mean)} g`]);
  if(hausner) cards.push(['かさ密度',formatNumber(hausner.bulk_density?.mean)],['タップ密度',formatNumber(hausner.tapped_density?.mean)],['Hausner比',formatNumber(hausner.ratio)],['流動性',hausner.class||'—']);
  if(repose) cards.push(['安息角',`${formatNumber(repose.angle_deg,1)}°`],['安息角評価',repose.class||'—']);
  const stage=metadata.stage; const stageData=stage?data[stage]:null;
  if(stageData&&!calibration&&!hausner&&!repose){if(stageData.mean!==undefined)cards.push(['平均値',formatNumber(stageData.mean)],['標準偏差',formatNumber(stageData.stdev)]);if(stageData.angle_deg!==undefined)cards.push(['安息角',`${formatNumber(stageData.angle_deg,1)}°`],['評価',stageData.class||'—']);}
  box.innerHTML=(cards.length?cards:[['状態','結果を確認してください']]).map(([label,value])=>`<div class="result-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
}

function renderArtifacts(state) {
  const box=$('artifacts'), artifacts=state.result?.artifacts||{}, entries=Object.values(artifacts);
  if(!entries.length){box.textContent='画像はありません。';return;}
  box.innerHTML=entries.map(item=>{const filename=String(item.filename||'');const url=`/api/runs/${encodeURIComponent(state.run_id)}/artifacts/${encodeURIComponent(filename)}`;return `<figure><a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${escapeHtml(filename)}"></a><figcaption>${escapeHtml(filename)}</figcaption></figure>`;}).join('');
}

$('save-result').addEventListener('click',()=>api('/api/results/save',{method:'POST',body:JSON.stringify({update_material_database:getToggle('update-db')})}).then(async()=>{toast('測定結果を保存しました。');setToggle('update-db',false);await loadMaterials();showAutoView('setup');}).catch(error=>toast(error.message,true)));
$('discard-result').addEventListener('click',async()=>{if(await confirmAction('測定結果を破棄','この測定結果は保存されません。破棄してよろしいですか？','結果を破棄')) api('/api/results/discard',{method:'POST'}).then(()=>{toast('測定結果を破棄しました。');showAutoView('setup');}).catch(error=>toast(error.message,true));});

async function saveManualFields(){settings=collectSettings();await api('/api/settings',{method:'PUT',body:JSON.stringify(settings)});}
async function manualRun(count=null){await saveManualFields();const payload={vibration_level:getStepValue('manual_level'),vibration_seconds:getStepValue('manual_sec'),dose_count:count??getStepValue('manual_count'),use_auger:getToggle('manual_aug')};await api('/api/runs/manual',{method:'POST',body:JSON.stringify(payload)});showPage('auto');showAutoView('run');}
$('manual-run').addEventListener('click',()=>manualRun().catch(error=>toast(error.message,true)));
$('dispense-once').addEventListener('click',()=>manualRun(1).catch(error=>toast(error.message,true)));
$('clear-clog').addEventListener('click',async()=>{if(await confirmAction('詰まり除去','ディスペンサーの詰まり除去動作を実行します。','詰まり除去を実行')) api('/api/runs/clear-clog',{method:'POST'}).then(()=>toast('詰まり除去が完了しました。')).catch(error=>toast(error.message,true));});

async function preview(url,body){const blob=await api(url,{method:'POST',body:body?JSON.stringify(body):undefined});if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(blob);$('preview-image').src=previewUrl;$('preview-image').style.display='block';}
$('camera-preview').addEventListener('click',async()=>{try{await saveManualFields();await preview('/api/camera/preview',{focus_mode:getSingleChoice('focus_mode'),lens_position:getStepValue('lens_position')});}catch(error){toast(error.message,true);}});
$('repose-preview').addEventListener('click',()=>preview('/api/camera/repose-preview').catch(error=>toast(error.message,true)));

document.querySelectorAll('.single').forEach(button=>button.addEventListener('click',()=>api('/api/runs/single/'+button.dataset.stage,{method:'POST'}).then(()=>{showPage('auto');showAutoView('run');}).catch(error=>toast(error.message,true))));
$('single-dispense').addEventListener('click',()=>manualRun(1).catch(error=>toast(error.message,true)));
$('single-capture').addEventListener('click',()=>preview('/api/camera/repose-preview').then(()=>showPage('manual')).catch(error=>toast(error.message,true)));

function populateMaterialFilters(){const names=[...new Set(materialRows.map(row=>row.mat_name).filter(Boolean))].sort((a,b)=>a.localeCompare(b));$('material-filter').replaceChildren(new Option('すべての材料',''),...names.map(name=>new Option(name,name)));updateDiskFilter();}
function updateDiskFilter(){const material=$('material-filter').value;const disks=[...new Set(materialRows.filter(row=>!material||row.mat_name===material).map(row=>row.diskID).filter(Boolean))].sort();const current=$('disk-filter').value;$('disk-filter').replaceChildren(new Option('すべて',''),...disks.map(id=>new Option(id,id)));if(disks.includes(current))$('disk-filter').value=current;renderMaterialCards();}
function renderMaterialCards(){const material=$('material-filter').value,disk=$('disk-filter').value;const rows=materialRows.filter(row=>(!material||row.mat_name===material)&&(!disk||row.diskID===disk));const fields=[['volume_ml','容量 (mL)'],['vib_level','振動レベル'],['vib_time','振動時間 (秒)'],['step_mass_mean','吐出質量平均 (g)'],['density_g_per_ml','密度 (g/mL)'],['bulk_density_mean','かさ密度'],['tapped_density_mean','タップ密度'],['hausner_ratio','Hausner比'],['hausner_class','流動性'],['angle_of_repose_deg','安息角 (°)'],['repose_class','安息角評価']];$('material-cards').innerHTML=rows.length?rows.map(row=>`<article class="material-card"><h2><span>${escapeHtml(row.mat_name)}</span><span class="disk-badge">${escapeHtml(row.diskID)}</span></h2><div class="material-values">${fields.map(([key,label])=>`<div class="material-value"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatNumber(row[key]))}</strong></div>`).join('')}</div></article>`).join(''):'<div class="empty-state">該当するMaterial DBレコードはありません。</div>';}
async function loadMaterials(){try{const previousMaterial=$('material-filter').value;materialRows=await api('/api/materials');populateMaterialOptions(materialRows,settings?.material?.material_name||'');populateMaterialFilters();if([...$('material-filter').options].some(option=>option.value===previousMaterial))$('material-filter').value=previousMaterial;updateDiskFilter();}catch(error){toast(error.message,true);}}
$('material-filter').addEventListener('change',updateDiskFilter);$('disk-filter').addEventListener('change',renderMaterialCards);$('refresh-materials').addEventListener('click',loadMaterials);

const evaluationLabels={calibration:'振動条件最適化',hausner:'ハウスナー比',angle_of_repose:'安息角'};
const classLabels={Excellent:'Excellent（優秀）',Good:'Good（良好）',Fair:'Fair（普通）',Passable:'Passable（可）',Poor:'Poor（不良）','Very poor':'Very poor（非常に不良）','Very, very poor':'Very, very poor（極めて不良）'};

function formatHistoryTimestamp(value) {
  const match=String(value||'').match(/^(\d{4})(\d{2})(\d{2})[_ T]?(\d{2})?(\d{2})?(\d{2})?/);
  if(!match) return value||'日時不明';
  return `${match[1]}/${match[2]}/${match[3]}${match[4]?` ${match[4]}:${match[5]||'00'}:${match[6]||'00'}`:''}`;
}

function uniqueValues(rows,key){return [...new Set(rows.map(row=>row[key]).filter(value=>value!==null&&value!==undefined&&value!==''))].sort((a,b)=>String(a).localeCompare(String(b),'ja',{numeric:true}));}
function syncSelect(id,values,preferred,labeler=value=>value){
  const select=$(id), current=preferred??select.value;
  select.replaceChildren(...values.map(value=>new Option(labeler(value),value)));
  if(values.map(String).includes(String(current))) select.value=String(current);
  return select.value;
}

async function loadHistory(force=false){
  if(historyLoaded&&!force){rebuildHistoryFilters();return;}
  $('history-overview').innerHTML='<div class="empty-state">履歴を読み込み中…</div>';
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
    return `${formatHistoryTimestamp(row?.timestamp)} ・ ${row?.source_label||''}`;
  });
  if(selected) loadHistoryDetail(selected);
  else renderHistoryEmpty(`${evaluationLabels[evaluation]}の保存結果がありません。`);
}

function renderHistoryEmpty(message){
  historyRequest+=1;
  $('history-overview').innerHTML=`<div class="empty-state">${escapeHtml(message)}</div>`;
  $('history-context').textContent='選択条件に該当する結果はありません。';
  $('history-source').classList.remove('visible');
  $('history-charts').replaceChildren();$('history-artifacts').replaceChildren();$('history-json').textContent='結果がありません。';
}

async function loadHistoryDetail(recordId){
  const request=++historyRequest;
  $('history-overview').innerHTML='<div class="empty-state">結果を読み込み中…</div>';
  try{
    const record=await api(`/api/results/history/${encodeURIComponent(recordId)}`);
    if(request!==historyRequest) return;
    renderHistoryDetail(record);
  }catch(error){if(request===historyRequest)renderHistoryEmpty(error.message);}
}

function outcomeLabel(value){return value===true?'成功':value===false?'要確認':'—';}
function translatedClass(value){return classLabels[value]||value||'—';}
function metric(label,value){return `<div class="result-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;}
function difference(first,second){return first===null||first===undefined||second===null||second===undefined?null:Number(first)-Number(second);}
function meanWithSpread(mean,spread){return mean===null||mean===undefined?'—':`${formatNumber(mean,4)} ± ${formatNumber(spread,4)} g/mL`;}

function renderHistoryDetail(record){
  const overview=record.overview||{};
  let cards=[];
  if(record.evaluation==='calibration') cards=[
    ['判定',outcomeLabel(overview.success)],['選択振動レベル',formatNumber(overview.selected_vib_level,0)],['選択振動時間',`${formatNumber(overview.selected_vib_time,2)} 秒`],
    ['吐出質量平均',`${formatNumber(overview.step_mass_mean,4)} g`],['吐出質量 標準偏差',`${formatNumber(overview.step_mass_std,4)} g`],['推定密度',`${formatNumber(overview.density_g_per_ml,4)} g/mL`]
  ];
  if(record.evaluation==='calibration'&&overview.failure_reason) cards.push(['失敗理由',overview.failure_reason]);
  if(record.evaluation==='hausner') cards=[
    ['判定',outcomeLabel(overview.success)],['ハウスナー比',formatNumber(overview.hausner_ratio,4)],['流動性',translatedClass(overview.hausner_class)],
    ['かさ密度 平均 ± SD',meanWithSpread(overview.bulk_density_mean,overview.bulk_density_stdev)],['タップ密度 平均 ± SD',meanWithSpread(overview.tapped_density_mean,overview.tapped_density_stdev)],['密度差',`${formatNumber(difference(overview.tapped_density_mean,overview.bulk_density_mean),4)} g/mL`]
  ];
  if(record.evaluation==='angle_of_repose') cards=[['判定',outcomeLabel(overview.success)],['安息角',`${formatNumber(overview.angle_deg,2)}°`],['流動性',translatedClass(overview.repose_class)]];
  $('history-overview').innerHTML=cards.map(([label,value])=>metric(label,value)).join('')||'<div class="empty-state">概要データがありません。</div>';
  $('history-context').textContent=`${record.dispenser_id} / ${record.material_name} / ${record.disk_id} ・ ${formatHistoryTimestamp(record.timestamp)}`;
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
    const level=data.level_results||[], time=data.time_results||[], stability=data.stability_results||[];
    html+=chartCard('振動レベル別 平均吐出質量',[{name:'平均吐出質量 (g)',values:level.map(row=>row.mean_step_mass??average(row.per_step))}],level.length?`レベル: ${level.map(row=>row.level??'—').join(' / ')}`:'');
    html+=chartCard('振動時間別 平均吐出質量',[{name:'平均吐出質量 (g)',values:time.map(row=>row.mean_step_mass??average(row.per_step))}],time.length?`時間 (秒): ${time.map(row=>row.vib_time??'—').join(' / ')}`:'');
    stability.forEach((row,index)=>{html+=chartCard(`安定性確認${stability.length>1?` ${index+1}`:''}`,[{name:'1回ごとの吐出質量 (g)',values:row.per_step}],`振動レベル ${row.level??'—'} / ${row.vib_time??'—'} 秒`);});
  }else if(record.evaluation==='hausner'){
    const bulk=data.bulk_density||{}, tapped=data.tapped_density||{};
    html+=chartCard('密度の繰返し測定',[{name:'かさ密度',values:bulk.densities},{name:'タップ密度',values:tapped.densities}],'単位: g/mL');
    html+=chartCard('採取質量の繰返し測定',[{name:'かさ密度試験',values:bulk.masses},{name:'タップ密度試験',values:tapped.masses}],'単位: g');
  }
  $('history-charts').innerHTML=html||'<div class="empty-state">この結果にはグラフ用の数値データがありません。</div>';
}

function renderHistoryArtifacts(record){
  const artifacts=record.artifacts||[], box=$('history-artifacts');
  if(!artifacts.length){box.innerHTML=record.evaluation==='angle_of_repose'?'<div class="empty-state">保存画像がありません。</div>':'';return;}
  box.innerHTML=artifacts.map(item=>{const url=`/api/results/history/artifact/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.run_id)}/${encodeURIComponent(item.filename)}`;return `<figure><a href="${url}" target="_blank" rel="noopener"><img loading="lazy" src="${url}" alt="${escapeHtml(item.label)}"></a><figcaption>${escapeHtml(item.label)}</figcaption></figure>`;}).join('');
}

$('history-dispenser').addEventListener('change',rebuildHistoryFilters);
$('history-material').addEventListener('change',rebuildHistoryFilters);
$('history-disk').addEventListener('change',rebuildHistoryFilters);
$('history-record').addEventListener('change',event=>event.target.value&&loadHistoryDetail(event.target.value));
$('refresh-history').addEventListener('click',()=>loadHistory(true));

function connectWebSocket(){const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws/run`);ws.onopen=()=>{$('conn-dot').className='dot ok';$('conn-label').textContent='サーバー接続済み';};ws.onmessage=event=>updateState(JSON.parse(event.data));ws.onclose=()=>{$('conn-dot').className='dot bad';$('conn-label').textContent='再接続中…';setTimeout(connectWebSocket,1500);};ws.onerror=()=>ws.close();}

buildNumericKeypad();buildTextKeyboard();
Promise.all([api('/api/settings'),api('/api/runs/current'),api('/api/materials')]).then(([settingsValue,state,rows])=>{materialRows=rows;fillSettings(settingsValue);populateMaterialFilters();updateState(state);if(state.status==='running'){showPage('auto');showAutoView('run');}else if(state.result_pending){showPage('auto');showAutoView('result');}connectWebSocket();}).catch(error=>{toast(error.message,true);$('conn-dot').className='dot bad';$('conn-label').textContent='サーバー利用不可';setTimeout(()=>location.reload(),3000);});
