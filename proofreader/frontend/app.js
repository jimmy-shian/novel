/**
 * Novel AI Proofreader – Frontend Logic v3.0 (Local FS Access)
 */

const API = 'http://localhost:7788/api';

const state = {
  dirHandle: null,
  fileHandles: {},
  currentFileHandle: null,
  novelId: '',
  fileName: '',
  chapter: '',
  rawText: '',
  issues: [],
  characters: [],
  events: [],
  timeline: [],
  summary: '',
  batchFiles: [],
  currentFilter: 'all',
  apiOnline: false
};

document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  checkApiStatus();
  setInterval(checkApiStatus, 10000);
});

async function checkApiStatus() {
  const badge = document.getElementById('api-status');
  try {
    const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(2000) });
    state.apiOnline = r.ok;
    badge.className = `status-badge ${r.ok ? 'status-ok' : 'status-offline'}`;
    badge.textContent = r.ok ? 'LLM 連線成功' : 'LLM 離線';
  } catch (e) {
    state.apiOnline = false;
    badge.className = 'status-badge status-offline';
    badge.textContent = 'LLM 離線';
  }
}

function initEventListeners() {
  document.getElementById('btn-open-folder').onclick = openFolder;
  document.getElementById('btn-full-analyze').onclick = runFullAnalysis;
  document.getElementById('btn-apply').onclick = applyCorrections;
  document.getElementById('btn-export-assistant').onclick = exportToAssistant;
  document.getElementById('btn-accept-all').onclick = acceptAllIssues;
  document.getElementById('btn-batch-clear').onclick = () => { state.batchFiles = []; renderBatchList(); };
  document.getElementById('btn-start-batch').onclick = startBatchMarking;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('filter-active'));
      btn.classList.add('filter-active');
      state.currentFilter = btn.dataset.filter;
      renderIssueList();
    };
  });

  document.getElementById('modal-cancel').onclick = closeModal;
  document.getElementById('modal-confirm').onclick = confirmManualEdit;
}

// ── EXPLORER (Local File System API) ──
async function openFolder() {
  try {
    const dirHandle = await window.showDirectoryPicker({
      mode: 'readwrite'
    });
    state.dirHandle = dirHandle;
    state.novelId = dirHandle.name;
    document.getElementById('current-file').textContent = `PROJECT: ${state.novelId}`;
    
    const container = document.getElementById('chapter-tree');
    document.getElementById('section-chapters').style.display = 'block';
    container.innerHTML = '<div style="padding:10px">讀取章節中...</div>';
    
    state.fileHandles = {};
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.txt')) {
        state.fileHandles[entry.name] = entry;
      }
    }
    
    const files = Object.keys(state.fileHandles).sort((a,b) => a.localeCompare(b, undefined, {numeric: true}));
    
    state.batchFiles = files.map(name => ({ filename: name, status: 'pending' }));
    
    container.innerHTML = files.map(name => 
      `<div class="file-tree-item" id="file-${name.replace(/[^a-zA-Z0-9]/g, '_')}" onclick="selectChapter('${name}')">${name}</div>`
    ).join('');
    
    renderBatchList();
    toast(`已載入 ${files.length} 份章節`, 'info');
  } catch (e) { 
    if (e.name !== 'AbortError') {
      console.error(e);
      toast('無法讀取本地資料夾，請確認權限', 'error');
    }
  }
}

async function selectChapter(filename) {
  try {
    const handle = state.fileHandles[filename];
    state.currentFileHandle = handle;
    const file = await handle.getFile();
    const text = await file.text();
    
    state.rawText = text;
    state.fileName = filename;
    state.chapter = filename.replace('.txt', '');
    
    document.getElementById('current-file').textContent = `${state.novelId} / ${state.chapter}`;
    
    // UI Transitions
    document.getElementById('topbar-actions').style.display = 'flex';
    document.getElementById('tab-nav').style.display = 'flex';
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('tab-proofread').classList.add('tab-active');

    // Clear Previous Analysis Results
    document.getElementById('summary-section').style.display = 'none';
    document.getElementById('chars-grid').innerHTML = '';
    document.getElementById('timeline-container').innerHTML = '';
    state.issues = [];
    
    renderTextDisplay(state.rawText, []);
    renderIssueList();
    switchTab('proofread');
    
    document.querySelectorAll('#chapter-tree .file-tree-item').forEach(el => 
      el.classList.toggle('active', el.textContent === filename)
    );
  } catch (e) { 
    console.error(e);
    toast('讀取內容出錯', 'error'); 
  }
}

// ── ACTIONS ──
async function runFullAnalysis() {
  if (!state.apiOnline) {
    // Mock behavior when backend is offline for UI testing
    toast('LLM 離線，使用測試假資料...', 'info');
    state.issues = [
      { id: 'mock1', start: 10, end: 12, original: '測試', type: '錯字', reason: '可能為錯別字', suggestion: '測試用', action: 'pending' }
    ];
    renderAll();
    return;
  }

  const btn = document.getElementById('btn-full-analyze');
  btn.disabled = true;
  btn.textContent = '分析啟動中...';
  
  const tasks = [];
  if (document.getElementById('check-mark').checked) tasks.push('mark');
  if (document.getElementById('check-chars').checked) tasks.push('chars');
  if (document.getElementById('check-events').checked) tasks.push('events');
  tasks.push('summary');

  try {
    const r = await fetch(`${API}/analyze/full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ novel_id: state.novelId, chapter: state.chapter, text: state.rawText, tasks })
    });
    const data = await r.json();
    
    if (data.mark) {
      state.issues = (data.mark.issues || []).map(iss => ({ ...iss, id: iss.id || Math.random().toString(36).substr(2,9), action: 'pending' }));
    }
    state.characters = data.chars || [];
    state.summary = data.summary || '';
    state.timeline = data.timeline || [];
    
    renderAll();
    toast('分析成功！結果已更新至各面板。', 'success');
  } catch (e) { toast('AI 分析失敗，請檢查 API 狀態', 'error'); }
  finally { btn.disabled = false; btn.textContent = '⚡ FULL ANALYZE'; }
}

async function applyCorrections() {
  // Check if any corrections to apply
  const toApply = state.issues.filter(i => i.action === 'accept' || i.action === 'manual');
  
  // Here we simulate applying the corrections to the text.
  // (In full version, backend does this securely, or we do it here by slicing text backward)
  if (toApply.length > 0) {
    let newText = state.rawText;
    // Sort descending by start index to avoid index shifting
    const sorted = [...toApply].sort((a,b) => b.start - a.start);
    for (const iss of sorted) {
      const replacement = iss.action === 'manual' ? iss.manual_text : iss.suggestion;
      newText = newText.slice(0, iss.start) + replacement + newText.slice(iss.end);
    }
    state.rawText = newText;
    state.issues = state.issues.filter(i => i.action === 'pending' || i.action === 'ignore');
  }

  // Save to local file using File System Access API
  try {
    if (!state.currentFileHandle) return;
    const writable = await state.currentFileHandle.createWritable();
    await writable.write(state.rawText);
    await writable.close();
    
    renderTextDisplay(state.rawText, state.issues);
    renderIssueList();
    toast('✅ 原始檔案已更新並儲存', 'success');
  } catch (e) { 
    console.error(e);
    toast('儲存失敗，請確認資料夾寫入權限', 'error'); 
  }
}

// ── RENDERERS ──
function renderAll() {
  renderTextDisplay(state.rawText, state.issues);
  renderIssueList();
  
  if (state.summary) {
    document.getElementById('summary-section').style.display = 'block';
    document.getElementById('summary-text').textContent = state.summary;
  }
  
  document.getElementById('chars-grid').innerHTML = state.characters.map(c => `
    <div class='issue-card'>
      <div class='issue-top'><span class='issue-type-badge'>CHAR</span><span class='issue-orig'>${esc(c['角色名稱'])}</span></div>
      <div class='issue-reason'>${esc(c['身份'])}</div>
      <div style='font-size:12px; color:var(--text-dim); line-height:1.5'>${esc(c['角色描述'])}</div>
    </div>`).join('');
    
  document.getElementById('timeline-container').innerHTML = state.timeline.map(tl => `
    <div class='tl-compact-item'><strong>${esc(tl['事件名稱'])}</strong><p>${esc(tl['前後關係'])}</p></div>`).join('');
}

function renderTextDisplay(text, issues) {
  const display = document.getElementById('text-display');
  const sorted = [...issues].sort((a,b) => a.start - b.start);
  let html = ''; let cur = 0;
  for (const iss of sorted) {
    html += esc(text.slice(cur, iss.start));
    html += `<mark class='hl hl-${iss.type} ${iss.action !== 'pending' ? 'hl-' + iss.action : ''}' id="hl-${iss.id}" onclick='focusIssue("${iss.id}")'>${esc(text.slice(iss.start, iss.end))}</mark>`;
    cur = iss.end;
  }
  html += esc(text.slice(cur));
  display.innerHTML = html.replace(/\n/g, '<br>');
}

function renderIssueList() {
  const container = document.getElementById('issue-list');
  const filtered = state.currentFilter === 'all' ? state.issues : state.issues.filter(i => i.type === state.currentFilter);
  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state" style="height:100px"><div class="empty-msg" style="font-size:12px">無偵測結果</div></div>';
    return;
  }
  container.innerHTML = filtered.map(iss => `
    <div class='issue-card ${iss.action !== 'pending' ? 'i-' + iss.action : ''}' id='card-${iss.id}' onclick='focusHl("${iss.id}")'>
      <div class='issue-top'><span class='issue-type-badge badge-${iss.type}'>${iss.type}</span><span class='issue-orig'>${esc(iss.original)}</span></div>
      <div class='issue-reason'>${esc(iss.reason)} ${iss.suggestion ? ' → ' + esc(iss.suggestion) : ''}</div>
      <div class='issue-actions'>
        <button class='act-btn' onclick='setAction("${iss.id}", "accept"); event.stopPropagation();'>接受</button>
        <button class='act-btn' onclick='setAction("${iss.id}", "ignore"); event.stopPropagation();'>忽略</button>
        <button class='act-btn' onclick='openManualModal("${iss.id}"); event.stopPropagation();'>手動</button>
      </div>
    </div>`).join('');
}

function renderBatchList() {
  const container = document.getElementById('batch-progress-list');
  container.innerHTML = state.batchFiles.map(f => `
    <div class="file-tree-item" style="display:flex; justify-content:space-between">
      <span>${f.filename}</span>
      <span class="status-badge">${f.status}</span>
    </div>`).join('');
}

// ── UTILS ──
function switchTab(t) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('tab-active', b.dataset.tab === t));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('tab-active', s.id === 'tab-' + t));
}
function toast(m, t='info') {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${t}`;
  el.textContent = m;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
function esc(s) { return String(s||'').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function setAction(id, action) {
  const iss = state.issues.find(i => i.id === id);
  if (iss) { iss.action = action; renderTextDisplay(state.rawText, state.issues); renderIssueList(); }
}
window.setAction = setAction;

function acceptAllIssues() {
  state.issues.forEach(iss => {
    if (iss.action === 'pending') iss.action = 'accept';
  });
  renderTextDisplay(state.rawText, state.issues);
  renderIssueList();
  toast('已接受所有建議內容', 'success');
}

async function startBatchMarking() {
  if (state.batchFiles.length === 0) return toast('佇列中無檔案', 'info');
  
  toast('開始批次掃描...', 'info');
  const btn = document.getElementById('btn-start-batch');
  btn.disabled = true;

  for (let item of state.batchFiles) {
    if (item.status === 'done') continue;
    
    item.status = 'processing';
    renderBatchList();
    
    try {
      const handle = state.fileHandles[item.filename];
      const file = await handle.getFile();
      const text = await file.text();
      
      if (!state.apiOnline) {
        // Mock analysis
        await new Promise(r => setTimeout(r, 500));
        item.status = 'done (mock)';
      } else {
        const r = await fetch(`${API}/analyze/full`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            novel_id: state.novelId, 
            chapter: item.filename.replace('.txt', ''), 
            text: text, 
            tasks: ['mark'] 
          })
        });
        if (r.ok) item.status = 'done';
        else item.status = 'failed';
      }
    } catch (e) {
      item.status = 'error';
    }
    renderBatchList();
  }
  
  btn.disabled = false;
  toast('批次處理完成', 'success');
}

window.focusIssue = (id) => {
  document.querySelectorAll('.issue-card').forEach(c => c.classList.remove('active'));
  const card = document.getElementById(`card-${id}`);
  if (card) { card.classList.add('active'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
};
window.focusHl = (id) => {
  const hl = document.getElementById(`hl-${id}`);
  if (hl) hl.scrollIntoView({ behavior: 'smooth', block: 'center' });
};
async function exportToAssistant() {
  if (!state.apiOnline) return toast('LLM 離線，無法導出', 'error');
  const payload = { novel_id: state.novelId, characters: state.characters, summary: state.summary, timeline: state.timeline, events: state.events };
  try {
    const r = await fetch(`${API}/export/assistant`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ novel_id: state.novelId, data: payload }) });
    if (r.ok) toast('導出成功！', 'success');
  } catch(e) {
    toast('導出失敗', 'error');
  }
}
let _mid = '';
function openManualModal(id) { _mid = id; document.getElementById('edit-modal').style.display='flex'; }
function closeModal() { document.getElementById('edit-modal').style.display='none'; }
function confirmManualEdit() { const t = document.getElementById('modal-input').value; setAction(_mid, 'manual'); const iss = state.issues.find(i => i.id === _mid); if (iss) iss.manual_text = t; closeModal(); }


