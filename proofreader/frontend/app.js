const API_BASE = 'http://localhost:7788/api';

// ── State ──
const state = {
  novels: [],
  chapters: [],
  currentNovel: null,
  currentChapter: null,
  originalText: '',
  issues: [],
  decisions: {}, // issue.id -> { action: 'accept'|'ignore'|'manual', manualText?: '' }
  aiData: null // { chars, events, summary, timeline }
};

// ── DOM Elements ──
const els = {
  status: document.getElementById('api-status'),
  novelList: document.getElementById('novel-list'),
  novelCount: document.getElementById('novel-count'),
  chapterList: document.getElementById('chapter-list'),
  chapterCount: document.getElementById('chapter-count'),
  currentInfo: document.getElementById('current-info'),
  actions: document.getElementById('actions'),
  tabs: document.getElementById('tabs'),
  workspace: document.getElementById('workspace'),
  emptyState: document.getElementById('empty-state'),
  editor: document.getElementById('editor-content'),
  editorManual: document.getElementById('editor-manual'),
  btnEditMode: document.getElementById('btn-edit-mode'),
  issueList: document.getElementById('issue-list'),
  batchList: document.getElementById('batch-list'),
  
  // Buttons
  btnAnalyze: document.getElementById('btn-analyze'),
  btnApply: document.getElementById('btn-apply'),
  btnExport: document.getElementById('btn-export'),
  btnBatchStart: document.getElementById('btn-batch-start'),
  btnAcceptAll: document.getElementById('btn-accept-all'),
  
  // Modal
  modal: document.getElementById('modal-overlay'),
  modalInput: document.getElementById('modal-input'),
  modalCancel: document.getElementById('modal-cancel'),
  modalConfirm: document.getElementById('modal-confirm'),
  
  // Global Batch
  btnGlobalBatch: document.getElementById('btn-global-batch'),
  globalBatchUI: document.getElementById('global-batch-ui'),
  globalBatchProgress: document.getElementById('global-batch-progress'),
  globalBatchLabel: document.getElementById('global-batch-label'),
  globalBatchETA: document.getElementById('global-batch-eta'),
  globalBatchDetails: document.getElementById('global-batch-details')
};

// ── Initialization ──
async function init() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (res.ok) {
      els.status.textContent = '已連線';
      els.status.className = 'badge ok';
      loadNovels();
    }
  } catch (err) {
    els.status.textContent = '無法連線至後端';
    els.status.className = 'badge error';
  }
}

// ── Filesystem Navigation ──
async function loadNovels() {
  try {
    const res = await fetch(`${API_BASE}/fs/novels`);
    const data = await res.json();
    state.novels = data.novels;
    renderNovels();
  } catch (err) {
    console.error('Failed to load novels:', err);
    els.novelList.innerHTML = '<div class="error-text">無法載入小說清單</div>';
  }
}

function renderNovels() {
  els.novelList.innerHTML = '';
  els.novelCount.textContent = `(${state.novels.length})`;
  
  if (state.novels.length === 0) {
    els.novelList.innerHTML = '<div class="empty-text">找不到小說資料夾</div>';
    return;
  }
  
  state.novels.forEach(novel => {
    const btn = document.createElement('button');
    btn.className = 'list-item';
    btn.textContent = novel.name;
    btn.onclick = () => selectNovel(novel, btn);
    els.novelList.appendChild(btn);
  });
}

async function selectNovel(novel, btnEl) {
  const wasActive = btnEl.classList.contains('active');
  document.querySelectorAll('#novel-list .list-item').forEach(el => el.classList.remove('active'));
  
  if (wasActive) {
    state.currentNovel = null;
    state.currentChapter = null;
    state.chapters = [];
    renderChapters();
    resetWorkspace();
    return;
  }

  btnEl.classList.add('active');
  state.currentNovel = novel;
  state.currentChapter = null;
  state.chapters = [];
  
  els.chapterList.innerHTML = '<div class="loading-text">載入中...</div>';
  els.chapterCount.textContent = '';
  resetWorkspace();
  
  try {
    const res = await fetch(`${API_BASE}/fs/chapters?novel_path=${encodeURIComponent(novel.path)}`);
    const data = await res.json();
    state.chapters = data.chapters;
    renderChapters();
  } catch (err) {
    console.error('Failed to load chapters:', err);
    els.chapterList.innerHTML = '<div class="error-text">無法載入章節清單</div>';
  }
}

function renderChapters() {
  els.chapterList.innerHTML = '';
  els.chapterCount.textContent = `(${state.chapters.length})`;
  
  if (state.chapters.length === 0) {
    els.chapterList.innerHTML = '<div class="empty-text">此資料夾沒有 .txt 檔案</div>';
    return;
  }
  
  state.chapters.forEach(chap => {
    const btn = document.createElement('button');
    btn.className = 'list-item';
    btn.textContent = chap.name;
    btn.onclick = () => selectChapter(chap, btn);
    els.chapterList.appendChild(btn);
  });
}

async function selectChapter(chap, btnEl) {
  const wasActive = btnEl.classList.contains('active');
  document.querySelectorAll('#chapter-list .list-item').forEach(el => el.classList.remove('active'));
  
  if (wasActive) {
    state.currentChapter = null;
    resetWorkspace();
    return;
  }

  btnEl.classList.add('active');
  state.currentChapter = chap;
  els.currentInfo.textContent = `${state.currentNovel.name} / ${chap.name}`;
  
  // Show workspace
  els.emptyState.style.display = 'none';
  els.actions.style.display = 'flex';
  els.tabs.style.display = 'flex';
  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
  document.getElementById('tab-proofread').style.display = 'block';
  
  els.editor.innerHTML = '載入中...';
  
  try {
    const res = await fetch(`${API_BASE}/fs/read?path=${encodeURIComponent(chap.path)}`);
    const data = await res.json();
    state.originalText = data.content;
    state.issues = [];
    state.decisions = {};
    state.aiData = null;
    renderEditor();
    renderIssues();
    renderAnalysis(); 
    
    // Check if cache exists and load it
    await checkAndLoadCache();
  } catch (err) {
    console.error('Failed to load file content:', err);
    els.editor.innerHTML = '無法載入檔案內容';
  }
}

async function checkAndLoadCache() {
  try {
    const res = await fetch(`${API_BASE}/cache/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novel_id: state.currentNovel.name,
        chapter: state.currentChapter.name,
        text: state.originalText
      })
    });
    
    if (res.ok) {
      const data = await res.json();
      let hasCache = false;
      
      if (data.mark) {
        state.issues = (data.mark.issues || []).map((issue, idx) => ({ ...issue, id: `i_${idx}` }));
        state.decisions = {};
        hasCache = true;
      }
      
      if (data.chars || data.events) {
        state.aiData = {
          characters: data.chars || [],
          timeline: data.events || [], // Note: cache check returns 'events' key
          summary: '', // Summary is not per-chapter cached yet
          novel: state.currentNovel.name
        };
        hasCache = true;
      }
      
      if (hasCache) {
        console.log('載入快取資料完成');
        renderEditor();
        renderIssues();
        renderAnalysis();
        
        // Show a temporary indicator
        const badge = document.createElement('div');
        badge.className = 'cache-indicator';
        badge.textContent = '已載入現有分析紀錄';
        document.body.appendChild(badge);
        setTimeout(() => badge.remove(), 3000);
      }
    }
  } catch (err) {
    console.error('Cache check failed:', err);
  }
}

function resetWorkspace() {
  els.currentInfo.textContent = '請選擇章節';
  els.actions.style.display = 'none';
  els.tabs.style.display = 'none';
  els.emptyState.style.display = 'flex';
  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
}

// ── AI Processing ──
els.btnAnalyze.addEventListener('click', async () => {
  if (!state.currentChapter) return;
  
  const runMark = document.getElementById('chk-mark').checked;
  const runAnalyze = document.getElementById('chk-analyze').checked;
  
  if (!runMark && !runAnalyze) {
    alert('請勾選至少一項分析任務');
    return;
  }
  
  if (runMark && state.issues.length > 0) {
    if (!confirm('本章已存在校對紀錄，確定要清除並重新啟動 AI 分析嗎？')) return;
  }
  if (runAnalyze && state.aiData) {
     if (!confirm('本章已存在分析紀錄，確定要重新啟動 AI 分析嗎？')) return;
  }
  
  els.btnAnalyze.disabled = true;
  els.btnAnalyze.textContent = 'AI 分析中...';
  
  const tasks = [];
  if (runMark) tasks.push('mark');
  if (runAnalyze) tasks.push('chars', 'events', 'summary');
  
  try {
    const res = await fetch(`${API_BASE}/analyze/full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novel_id: state.currentNovel.name,
        chapter: state.currentChapter.name,
        text: state.originalText,
        tasks: tasks
      })
    });
    
    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: '伺服器錯誤' }));
      throw new Error(errData.details || errData.error || '分析過程中發生錯誤');
    }
    
    const data = await res.json();
    
    // Check for internal task errors
    if (data.mark && data.mark.error) {
       throw new Error(`校對失敗: ${data.mark.error}`);
    }

    if (data.mark) {
      state.issues = (data.mark.issues || []).map((issue, idx) => ({ ...issue, id: `i_${idx}` }));
      state.decisions = {};
      if (state.issues.length === 0 && !data.mark.error) {
          console.log('未發現任何建議修改項');
      }
    }
    
    if (runAnalyze) {
      state.aiData = {
        characters: data.chars || [],
        timeline: data.timeline || [],
        summary: data.summary || '',
        novel: state.currentNovel.name
      };
      console.log('角色與劇情分析完成');
      renderAnalysis();
    }
    
    renderEditor();
    renderIssues();
  } catch (err) {
    console.error('Analysis Error:', err);
    alert('分析失敗：' + err.message);
  } finally {
    els.btnAnalyze.disabled = false;
    els.btnAnalyze.textContent = '啟動 AI 分析';
  }
});

// ── Manual Edit Mode Toggle ──
let isManualEdit = false;

els.btnEditMode.addEventListener('click', () => {
  isManualEdit = !isManualEdit;
  
  if (isManualEdit) {
    // Switch to manual
    els.btnEditMode.textContent = '完成手動編輯';
    els.btnEditMode.classList.add('primary');
    els.btnAnalyze.disabled = true;
    
    // Get currently "applied" text (what user sees in the editor)
    // But it's easier to just use state.originalText if they haven't applied anything,
    // or if they have decisions, we should technically apply them first.
    // Let's just use the raw originalText for now, or the text with accepted decisions.
    
    const currentViewText = getProcessedText();
    els.editorManual.value = currentViewText;
    
    els.editor.style.display = 'none';
    els.editorManual.style.display = 'block';
    els.editorManual.focus();
  } else {
    // Switch back to AI mode
    els.btnEditMode.textContent = '進入手動編輯';
    els.btnEditMode.classList.remove('primary');
    els.btnAnalyze.disabled = false;
    
    state.originalText = els.editorManual.value;
    state.issues = [];
    state.decisions = {};
    
    els.editor.style.display = 'block';
    els.editorManual.style.display = 'none';
    renderEditor();
    renderIssues();
  }
});

function getProcessedText() {
  if (state.issues.length === 0) return state.originalText;
  
  const sorted = [...state.issues].sort((a, b) => b.start - a.start);
  let text = state.originalText;
  
  for (const issue of sorted) {
    const dec = state.decisions[issue.id];
    if (dec?.action === 'accept') {
      text = text.slice(0, issue.start) + issue.suggestion + text.slice(issue.end);
    } else if (dec?.action === 'manual') {
      text = text.slice(0, issue.start) + dec.manualText + text.slice(issue.end);
    }
  }
  return text;
}

// ── Rendering Editor & Issues ──
function renderEditor() {
  if (!state.originalText) {
    els.editor.innerHTML = '<div class="empty-text">請選擇章節</div>';
    return;
  }
  
  // Create a copy and sort by start ascending
  const sortedIssues = [...state.issues].sort((a, b) => a.start - b.start);
  
  let html = '';
  let lastIdx = 0;
  
  for (const issue of sortedIssues) {
    // Avoid overlap
    if (issue.start < lastIdx) continue;
    
    // Text before the mark
    html += escapeHTML(state.originalText.slice(lastIdx, issue.start));
    
    const dec = state.decisions[issue.id];
    let actionClass = dec ? `hl-${dec.action}` : `hl-${issue.type}`;
    
    // What text to show in the mark
    let displayStr = issue.original;
    if (dec?.action === 'accept') displayStr = issue.suggestion;
    else if (dec?.action === 'manual') displayStr = dec.manualText;
    
    html += `<mark class="hl ${actionClass}" data-id="${issue.id}" title="${escapeHTML(issue.reason)}">${escapeHTML(displayStr)}</mark>`;
    lastIdx = issue.end;
  }
  
  // Remaining text
  html += escapeHTML(state.originalText.slice(lastIdx));
  
  els.editor.innerHTML = html;
  
  // Bind events
  els.editor.querySelectorAll('mark.hl').forEach(mark => {
    const id = mark.dataset.id;
    const card = document.getElementById(`card-${id}`);
    
    mark.addEventListener('click', () => {
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.querySelectorAll('.issue-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
      }
    });

    mark.addEventListener('mouseenter', () => {
      if (card) card.classList.add('hover-sync');
    });
    mark.addEventListener('mouseleave', () => {
      if (card) card.classList.remove('hover-sync');
    });
  });
}

function renderIssues(filterType = 'all') {
  els.issueList.innerHTML = '';
  
  let filtered = state.issues;
  if (filterType !== 'all') {
    filtered = state.issues.filter(i => i.type === filterType);
  }
  
  if (filtered.length === 0) {
    els.issueList.innerHTML = '<div class="empty-text">目前沒有待處理的問題</div>';
    return;
  }

  // Grouping logic: group by type + original + suggestion
  const groups = [];
  const groupMap = new Map();

  filtered.forEach(issue => {
    const key = `${issue.type}|${issue.original}|${issue.suggestion}`;
    if (!groupMap.has(key)) {
      const group = {
        key,
        type: issue.type,
        original: issue.original,
        suggestion: issue.suggestion,
        reason: issue.reason,
        items: []
      };
      groupMap.set(key, group);
      groups.push(group);
    }
    groupMap.get(key).items.push(issue);
  });
  
  groups.forEach(group => {
    const firstIssue = group.items[0];
    const dec = state.decisions[firstIssue.id];
    let cardClass = 'issue-card';
    if (dec) cardClass += ` i-${dec.action}`;
    if (group.items.length > 1) cardClass += ' is-group';
    
    const card = document.createElement('div');
    card.className = cardClass;
    card.id = `card-${firstIssue.id}`;
    
    const isGroup = group.items.length > 1;
    const countBadge = isGroup ? `<span class="count-badge">${group.items.length} 處</span>` : '';
    const accLabel = isGroup ? '全部接受' : '接受';
    const ignLabel = isGroup ? '全部忽略' : '忽略';
    
    card.innerHTML = `
      <div class="issue-top">
        <span class="type-badge ${group.type}">${group.type}</span>
        ${countBadge}
        <span class="issue-orig">${escapeHTML(group.original)}</span>
        <span style="color:#aaa">➔</span>
        <span class="issue-suggest">${escapeHTML(group.suggestion)}</span>
      </div>
      <div class="issue-reason">${escapeHTML(group.reason)}</div>
      <div class="issue-actions">
        <button class="btn-acc" data-act="accept">${accLabel}</button>
        <button class="btn-ign" data-act="ignore">${ignLabel}</button>
        <button class="btn-man" data-act="manual">手動</button>
      </div>
    `;

    // Scroll to mark on click
    card.addEventListener('click', () => {
      const firstMark = els.editor.querySelector(`mark[data-id="${firstIssue.id}"]`);
      if (firstMark) {
        firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Add a temporary highlight effect to the mark
        firstMark.classList.add('flash-highlight');
        setTimeout(() => firstMark.classList.remove('flash-highlight'), 1500);
      }
    });

    // Hover sync: highlight all marks in this group
    card.addEventListener('mouseenter', () => {
      group.items.forEach(issue => {
        const marks = els.editor.querySelectorAll(`mark[data-id="${issue.id}"]`);
        marks.forEach(m => m.classList.add('hover-sync'));
      });
    });
    card.addEventListener('mouseleave', () => {
      group.items.forEach(issue => {
        const marks = els.editor.querySelectorAll(`mark[data-id="${issue.id}"]`);
        marks.forEach(m => m.classList.remove('hover-sync'));
      });
    });
    
    card.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.act;
        if (action === 'manual') {
          openModal(group.items); // Special case for group manual edit
        } else {
          group.items.forEach(issue => {
            state.decisions[issue.id] = { action };
          });
          updateAfterDecision();
        }
      });
    });
    
    els.issueList.appendChild(card);
  });
}

// ── User Actions ──
function handleDecision(issue, action) {
  if (action === 'manual') {
    openModal(issue);
  } else {
    state.decisions[issue.id] = { action };
    updateAfterDecision();
  }
}

els.btnAcceptAll.addEventListener('click', () => {
  state.issues.forEach(issue => {
    if (!state.decisions[issue.id]) {
      state.decisions[issue.id] = { action: 'accept' };
    }
  });
  updateAfterDecision();
});

function updateAfterDecision() {
  renderEditor();
  const filter = document.querySelector('.filter-btn.active').dataset.filter;
  renderIssues(filter);
}

// ── Manual Edit Modal ──
let activeIssuesForModal = [];

function openModal(issues) {
  activeIssuesForModal = Array.isArray(issues) ? issues : [issues];
  els.modalInput.value = activeIssuesForModal[0].original;
  els.modal.style.display = 'flex';
  els.modalInput.focus();
}

els.modalCancel.addEventListener('click', () => {
  els.modal.style.display = 'none';
  activeIssuesForModal = [];
});

els.modalConfirm.addEventListener('click', () => {
  if (activeIssuesForModal.length > 0) {
    const val = els.modalInput.value.trim();
    if (val) {
      activeIssuesForModal.forEach(issue => {
        state.decisions[issue.id] = { action: 'manual', manualText: val };
      });
      updateAfterDecision();
    }
  }
  els.modal.style.display = 'none';
  activeIssuesForModal = [];
});

// ── Apply & Export ──
els.btnApply.addEventListener('click', async () => {
  if (!state.currentChapter) return;
  
  // Format decisions for backend
  const payloadDecisions = [];
  for (const issue of state.issues) {
    const dec = state.decisions[issue.id];
    if (!dec) continue; // Unresolved issues remain unchanged
    payloadDecisions.push({
      ...issue,
      action: dec.action,
      manual_text: dec.manualText || ''
    });
  }
  
  els.btnApply.disabled = true;
  els.btnApply.textContent = '儲存中...';
  
  try {
    const res = await fetch(`${API_BASE}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novel_id: state.currentNovel.name,
        chapter: state.currentChapter.name,
        text: state.originalText,
        decisions: payloadDecisions
      })
    });
    
    const data = await res.json();
    alert(`儲存成功！\n儲存路徑：${data.saved_to}`);
    
    // Reload chapter text
    const readRes = await fetch(`${API_BASE}/fs/read?path=${encodeURIComponent(state.currentChapter.path)}`);
    const readData = await readRes.json();
    state.originalText = readData.content;
    state.issues = [];
    state.decisions = {};
    renderEditor();
    renderIssues();
    
  } catch (err) {
    console.error(err);
    alert('儲存失敗');
  } finally {
    els.btnApply.disabled = false;
    els.btnApply.textContent = '儲存至檔案';
  }
});

els.btnExport.addEventListener('click', async () => {
  if (!state.aiData || !state.currentNovel) {
    alert('請先勾選「角色/劇情分析」並執行 AI 分析後，再進行匯出！');
    return;
  }
  
  try {
    const res = await fetch(`${API_BASE}/export/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novel_id: state.currentNovel.name,
        data: state.aiData
      })
    });
    const result = await res.json();
    if (result.success) {
      alert('已成功匯出至閱讀助手資料夾：\n' + result.path);
    }
  } catch (err) {
    console.error(err);
    alert('匯出失敗');
  }
});

// ── Tab & Filter Logic ──
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).style.display = 'block';
  });
});

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderIssues(btn.dataset.filter);
  });
});

// ── Batch Processing ──
els.btnBatchStart.addEventListener('click', async () => {
  if (!state.currentNovel || state.chapters.length === 0) return;
  if (!confirm(`確定要批次掃描 ${state.currentNovel.name} 的 ${state.chapters.length} 個章節嗎？這可能需要一段時間。`)) return;
  
  els.btnBatchStart.disabled = true;
  els.batchList.innerHTML = '<div class="loading-text">正在讀取所有檔案內容...</div>';
  
  try {
    // Collect all files
    const filesData = [];
    for (const chap of state.chapters) {
      const res = await fetch(`${API_BASE}/fs/read?path=${encodeURIComponent(chap.path)}`);
      const data = await res.json();
      filesData.push({
        filename: chap.name,
        chapter: chap.name,
        content: data.content
      });
    }
    
    await fetch(`${API_BASE}/batch/mark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novel_id: state.currentNovel.name,
        files: filesData
      })
    });
    
    els.batchList.innerHTML = '<div class="loading-text">批次任務已啟動，請稍候...</div>';
    
    // Poll status
    const timer = setInterval(async () => {
      const res = await fetch(`${API_BASE}/batch/status/${encodeURIComponent(state.currentNovel.name)}`);
      const data = await res.json();
      
      if (data.status === 'processing') {
        els.batchList.innerHTML = `<div class="batch-item">
          <span>掃描進度</span>
          <strong>${data.current} / ${data.total}</strong>
        </div>`;
      } else if (data.status === 'done') {
        clearInterval(timer);
        els.batchList.innerHTML = `<div class="batch-item">
          <span style="color:#2e7d32; font-weight:bold;">批次掃描完成！</span>
          <strong>${data.total} / ${data.total}</strong>
        </div>`;
        els.btnBatchStart.disabled = false;
      }
    }, 2000);
    
  } catch (err) {
    console.error(err);
    alert('啟動批次任務失敗');
    els.btnBatchStart.disabled = false;
  }
});

// ── Rendering Analysis ──
function renderAnalysis() {
  const containerSummary = document.getElementById('analysis-summary');
  const containerChars = document.getElementById('analysis-characters');
  const containerTimeline = document.getElementById('analysis-timeline');
  
  if (!state.aiData) {
    containerSummary.textContent = '尚未分析';
    containerChars.innerHTML = '';
    containerTimeline.innerHTML = '';
    return;
  }
  
  // Summary
  containerSummary.textContent = state.aiData.summary || '無大綱資料';
  
  // Characters
  containerChars.innerHTML = '';
  if (state.aiData.characters.length === 0) {
    containerChars.innerHTML = '<div class="empty-text">未偵測到角色</div>';
  } else {
    state.aiData.characters.forEach(char => {
      const card = document.createElement('div');
      card.className = 'char-card';
      
      const name = escapeHTML(char['角色名稱'] || '未知');
      const aliases = char['別名'] && char['別名'].length > 0 
        ? `<span class="char-aliases">(${escapeHTML(char['別名'].join(', '))})</span>` 
        : '';
      const faction = escapeHTML(char['身份'] || '');
      const desc = escapeHTML(char['角色描述'] || '');
      
      card.innerHTML = `
        <div class="char-name">
          ${name} ${aliases}
        </div>
        <div class="char-faction">${faction}</div>
        <div class="char-desc">${desc}</div>
      `;
      containerChars.appendChild(card);
    });
  }
  
  // Timeline
  containerTimeline.innerHTML = '';
  if (state.aiData.timeline.length === 0) {
    containerTimeline.innerHTML = '<div class="empty-state">未偵測到事件</div>';
  } else {
    state.aiData.timeline.forEach(ev => {
      const item = document.createElement('div');
      item.className = 'timeline-item';
      item.innerHTML = `
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <div class="timeline-header">
            <span class="timeline-title">${escapeHTML(ev['事件名稱'] || '未知事件')}</span>
            <span class="timeline-chapter">${escapeHTML(ev['章節'] || '')}</span>
          </div>
          <div class="timeline-desc">${escapeHTML(ev['事件描述'] || '')}</div>
          <div class="timeline-tags">
            ${(ev['涉及角色'] || []).map(c => `<span class="tag">${escapeHTML(c)}</span>`).join('')}
            <span class="tag" style="background:#fffcf0; border-color:#d4c4a8;">重要性: ${escapeHTML(ev['重要性'] || '中')}</span>
          </div>
        </div>
      `;
      containerTimeline.appendChild(item);
    });
  }
}

// ── Utils ──
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// ── Global Batch Processing ──
els.btnGlobalBatch.addEventListener('click', async () => {
  if (state.isGlobalBatching) return;
  state.isGlobalBatching = true;
  els.btnGlobalBatch.disabled = true;
  els.btnGlobalBatch.textContent = '批次處理運行中...';
  els.globalBatchUI.style.display = 'block';

  try {
    const novelRes = await fetch(`${API_BASE}/fs/novels`);
    const novelData = await novelRes.json();
    const novels = novelData.novels;

    let totalChapters = 0;
    let completedChapters = 0;
    const startTime = Date.now();

    // First, count total chapters
    const chaptersByNovel = [];
    for (const novel of novels) {
      const cRes = await fetch(`${API_BASE}/fs/chapters?novel_path=${encodeURIComponent(novel.path)}`);
      const cData = await cRes.json();
      totalChapters += cData.chapters.length;
      chaptersByNovel.push({ novel, chapters: cData.chapters });
    }

    if (totalChapters === 0) {
      els.globalBatchLabel.textContent = '庫中沒有可處理的章節';
      return;
    }

    // Process each novel
    for (const item of chaptersByNovel) {
      els.globalBatchLabel.textContent = `正在處理: ${item.novel.name}`;
      
      // Start batch for this novel
      await fetch(`${API_BASE}/batch/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novel_id: item.novel.name })
      });
      
      // Poll status for this novel
      let isDone = false;
      while (!isDone) {
        const statusRes = await fetch(`${API_BASE}/batch/status/${encodeURIComponent(item.novel.name)}`);
        const statusData = await statusRes.json();
        
        if (statusData.status === 'done' || statusData.status === 'idle') {
          isDone = true;
        } else {
          // Update progress
          const currentProgress = completedChapters + statusData.current;
          const pct = Math.min(100, (currentProgress / totalChapters) * 100);
          els.globalBatchProgress.style.width = `${pct}%`;
          els.globalBatchDetails.textContent = `當前進度: ${currentProgress} / ${totalChapters} (${item.novel.name})`;
          
          // ETA Calculation
          const elapsed = (Date.now() - startTime) / 1000;
          if (currentProgress > 0) {
            const totalSec = (elapsed / currentProgress) * totalChapters;
            const remaining = Math.max(0, totalSec - elapsed);
            const m = Math.floor(remaining / 60);
            const s = Math.floor(remaining % 60);
            els.globalBatchETA.textContent = `預計剩餘時間：${m}分 ${s}秒`;
          }
        }
        await new Promise(r => setTimeout(r, 2000));
      }
      completedChapters += item.chapters.length;
    }

    els.globalBatchLabel.textContent = '全庫自動掃描完成！';
    els.globalBatchProgress.style.width = '100%';
    els.btnGlobalBatch.textContent = '掃描完成';
  } catch (err) {
    console.error(err);
    els.globalBatchLabel.textContent = '批次處理出錯';
  } finally {
    state.isGlobalBatching = false;
    els.btnGlobalBatch.disabled = false;
  }
});

// Start app
init();
