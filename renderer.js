// ── 상태 ──────────────────────────────────────────────
let inputPath = null;
let currentMode = 'dialogue';
let lastResult = null;      // { targetPath, residualPath, remuxPath, isVideo }
let elapsedTimer = null;

// 모드별 UI 구성
const MODES = {
  dialogue: {
    desc: '영상/오디오에서 <b>사람의 말(대사)</b>만 뽑아냅니다. target=대사, residual=배경음.',
    preset: [
      { label: '말/대사 (speech)', value: 'speech' },
      { label: '남성 목소리 (man speaking)', value: 'man speaking' },
      { label: '여성 목소리 (woman speaking)', value: 'woman speaking' },
      { label: '노래 (singing)', value: 'singing' },
    ],
    prompt: false, advanced: false,
  },
  effects: {
    desc: '원하는 소리를 <b>영어 텍스트 프롬프트</b>로 지정해 뽑아냅니다. 소문자 명사/동사구로 입력하세요.',
    preset: null, prompt: true, advanced: false,
  },
  music: {
    desc: '<b>음악/BGM</b>을 분리합니다. target=음악, residual=대사+효과음.',
    preset: [
      { label: '음악 (music)', value: 'music' },
      { label: '배경음악 (background music)', value: 'background music' },
    ],
    prompt: false, advanced: false,
  },
  advanced: {
    desc: '자유 프롬프트 + 스팬 앵커(시간범위) + 재랭킹 옵션을 직접 제어합니다.',
    preset: null, prompt: true, advanced: true,
  },
};

// ── DOM ───────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const dropzone = $('dropzone');
const dropSub = $('dropSub');
const presetField = $('presetField');
const presetSelect = $('presetSelect');
const promptField = $('promptField');
const promptInput = $('promptInput');
const advancedBox = $('advancedBox');
const anchorInput = $('anchorInput');
const predictSpans = $('predictSpans');
const rerankRange = $('rerankRange');
const rerankVal = $('rerankVal');
const modelSize = $('modelSize');
const speedSel = $('speed');
const remuxCheck = $('remuxCheck');
const remuxLabel = $('remuxLabel');
const runBtn = $('runBtn');
const progress = $('progress');
const progressText = $('progressText');
const progressElapsed = $('progressElapsed');
const results = $('results');
const logEl = $('log');

// ── 탭 ────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentMode = tab.dataset.mode;
    applyMode();
  });
});

function applyMode() {
  const m = MODES[currentMode];
  $('modeDesc').innerHTML = m.desc;
  // 프리셋
  if (m.preset) {
    presetField.style.display = '';
    presetSelect.innerHTML = m.preset.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
  } else {
    presetField.style.display = 'none';
  }
  // 자유 프롬프트
  promptField.style.display = m.prompt ? '' : 'none';
  // 고급
  advancedBox.style.display = m.advanced ? '' : 'none';
  updateRunState();
}

// ── 드롭존 ────────────────────────────────────────────
dropzone.addEventListener('click', async () => {
  const p = await window.api.pickFile();
  if (p) setInput(p);
});
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag');
  const file = e.dataTransfer.files[0];
  if (file) {
    const p = window.api.getPathForFile(file);
    if (p) setInput(p);
  }
});

async function setInput(p) {
  inputPath = p;
  const name = p.split(/[\\/]/).pop();
  dropzone.classList.add('loaded');
  dropSub.textContent = name;
  const info = await window.api.probe(p);
  const isVid = /\.(mp4|mov|mkv|avi|webm|m4v|wmv|flv|mpg|mpeg|ts)$/i.test(p);
  remuxLabel.style.display = isVid ? '' : 'none';
  if (info && info.duration) {
    dropSub.textContent = `${name} · ${info.duration.toFixed(1)}초` + (info.hasAudio ? '' : ' · ⚠️ 오디오 없음');
  }
  if (info && !info.hasAudio) {
    log('⚠️ 이 파일에는 오디오 스트림이 없습니다.');
  }
  updateRunState();
}

// ── 프롬프트 칩 ───────────────────────────────────────
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => { promptInput.value = chip.dataset.p; updateRunState(); });
});
promptInput.addEventListener('input', updateRunState);
rerankRange.addEventListener('input', () => { rerankVal.textContent = rerankRange.value; });

function currentDescription() {
  const m = MODES[currentMode];
  if (m.preset) return presetSelect.value;
  return promptInput.value.trim();
}

function currentAnchors() {
  if (!MODES[currentMode].advanced) return null;
  const lines = anchorInput.value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!lines.length) return null;
  const spans = [];
  for (const ln of lines) {
    const parts = ln.split(/[\s,]+/).map(Number);
    if (parts.length >= 2 && parts.every(n => !isNaN(n))) {
      spans.push(['+', parts[0], parts[1]]);
    }
  }
  return spans.length ? [spans] : null; // 배치 1개
}

function updateRunState() {
  const hasDesc = currentDescription().length > 0 || currentAnchors();
  runBtn.disabled = !(inputPath && hasDesc);
}

// ── 실행 ──────────────────────────────────────────────
runBtn.addEventListener('click', async () => {
  if (!inputPath) return;
  results.style.display = 'none';
  progress.style.display = 'flex';
  runBtn.disabled = true;
  startElapsed();

  try {
    const r = await window.api.separate({
      inputPath,
      description: currentDescription(),
      anchors: currentAnchors(),
      modelSize: modelSize.value,
      speed: speedSel.value,
      predictSpans: predictSpans.checked,
      rerank: parseInt(rerankRange.value, 10),
      remux: remuxLabel.style.display !== 'none' && remuxCheck.checked,
    });
    lastResult = r;
    await showResults(r);
  } catch (e) {
    log('❌ 오류: ' + (e.message || e));
    progressText.textContent = '오류가 발생했습니다. 로그를 확인하세요.';
  } finally {
    stopElapsed();
    progress.style.display = 'none';
    updateRunState();
  }
});

function startElapsed() {
  const t0 = Date.now();
  progressElapsed.textContent = '0.0초';
  progressText.textContent = '준비 중…';
  elapsedTimer = setInterval(() => {
    progressElapsed.textContent = ((Date.now() - t0) / 1000).toFixed(1) + '초';
  }, 100);
}
function stopElapsed() { if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; } }

async function showResults(r) {
  results.style.display = '';
  $('resultElapsed').textContent = r.elapsed ? `(${r.elapsed}초)` : '';
  $('targetAudio').src = await window.api.toFileUrl(r.targetPath);
  $('residualAudio').src = await window.api.toFileUrl(r.residualPath);
  $('videoCard').style.display = r.remuxPath ? '' : 'none';
  results.scrollIntoView({ behavior: 'smooth' });
}

// 저장/폴더열기
document.querySelectorAll('[data-save]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const kind = btn.dataset.save;
    const p = pathFor(kind);
    if (!p) return;
    const name = ({ target: 'target.wav', residual: 'residual.wav', video: 'target_video.mp4' })[kind];
    const saved = await window.api.saveAs(p, name);
    if (saved) log('💾 저장됨: ' + saved);
  });
});
document.querySelectorAll('[data-reveal]').forEach(btn => {
  btn.addEventListener('click', () => {
    const p = pathFor(btn.dataset.reveal);
    if (p) window.api.reveal(p);
  });
});
function pathFor(kind) {
  if (!lastResult) return null;
  return { target: lastResult.targetPath, residual: lastResult.residualPath, video: lastResult.remuxPath }[kind];
}

// ── 진행/로그 ─────────────────────────────────────────
window.api.onJobProgress(({ stage, detail }) => {
  progressText.textContent = detail || stage;
  log('· ' + (detail || stage));
});
window.api.onBackendLog(msg => log(msg));

$('logToggle').addEventListener('click', () => {
  const shown = logEl.style.display !== 'none';
  logEl.style.display = shown ? 'none' : 'block';
  $('logToggle').textContent = (shown ? '▶' : '▼') + ' 로그';
});
function log(m) {
  logEl.textContent += m + '\n';
  logEl.scrollTop = logEl.scrollHeight;
}

// ── 백엔드 상태 ───────────────────────────────────────
async function refreshStatus() {
  const dot = $('statusDot');
  const txt = $('statusText');
  try {
    const h = await window.api.backendHealth();
    if (h.status === 'ok') {
      dot.className = 'dot ok';
      txt.textContent = h.cuda ? 'GPU 준비됨 (CUDA)' : '준비됨 (CPU — 느림)';
    } else {
      dot.className = 'dot warn';
      txt.textContent = '백엔드 시작 중…';
    }
  } catch {
    dot.className = 'dot err';
    txt.textContent = '백엔드 미연결';
  }
}

async function boot() {
  applyMode();
  $('statusDot').className = 'dot warn';
  $('statusText').textContent = '백엔드 시작 중… (첫 실행은 오래 걸려요)';
  try {
    await window.api.backendStart();
  } catch (e) {
    log('백엔드 시작 실패: ' + (e.message || e));
  }
  refreshStatus();
  setInterval(refreshStatus, 5000);
}
boot();
