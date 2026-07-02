// ── 상태 ──────────────────────────────────────────────
let inputPath = null;
let inputDuration = 0;      // 입력 길이(초) — 예상 소요시간 계산용
let currentMode = 'dialogue';
let lastResult = null;      // { targetPath, residualPath, remuxPath, isVideo }
let elapsedTimer = null;

// 대략적 소요시간 추정 계수 (실시간 배수). 현 GPU/모델 기준 러프값.
const SPEED_FACTOR = { fast: 26, balanced: 40, quality: 56 };
const MODEL_MULT = { small: 0.6, base: 1.0, large: 1.9 };

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
const progressEta = $('progressEta');
const doneBanner = $('doneBanner');
const toastWrap = $('toastWrap');
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
  inputDuration = (info && info.duration) || 0;
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
    const wall = (Date.now() - jobStartTs) / 1000;
    recordThroughput(modelSize.value, speedSel.value, wall);  // 다음 예상시간 보정
    showToast('✅ 분리 완료', `${fmtDur(wall)} 만에 끝났어요`, false);
    window.api.notifyDone({ title: 'SAM-Audio 분리 완료', body: `${fmtDur(wall)} 만에 완료됐습니다.`, ok: true });
  } catch (e) {
    const msg = e.message || String(e);
    log('❌ 오류: ' + msg);
    progressText.textContent = '오류가 발생했습니다. 로그를 확인하세요.';
    showToast('❌ 분리 실패', msg.slice(0, 120), true);
    window.api.notifyDone({ title: 'SAM-Audio 분리 실패', body: msg.slice(0, 120), ok: false });
  } finally {
    stopElapsed();
    progress.style.display = 'none';
    updateRunState();
  }
});

let jobStartTs = 0;

function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return sec + '초';
  const m = Math.floor(sec / 60), s = sec % 60;
  return s ? `${m}분 ${s}초` : `${m}분`;
}

// (모델,프리셋)별 실측 처리속도(오디오 1초당 연산 초)를 기억해 예상에 반영.
function tpKey(model, speed) { return `samgui_tp_${model}_${speed}`; }
function recordThroughput(model, speed, wallSec) {
  if (!inputDuration) return;
  const tp = wallSec / inputDuration;
  if (!isFinite(tp) || tp <= 0) return;
  try {
    // 지수이동평균으로 부드럽게 보정 (기존값 70% + 신규 30%)
    const prev = parseFloat(localStorage.getItem(tpKey(model, speed)) || '');
    const next = isFinite(prev) ? prev * 0.7 + tp * 0.3 : tp;
    localStorage.setItem(tpKey(model, speed), String(next));
  } catch { /* localStorage 불가 무시 */ }
}
function estimateSeconds() {
  if (!inputDuration) return 0;
  let tp = NaN;
  try { tp = parseFloat(localStorage.getItem(tpKey(modelSize.value, speedSel.value)) || ''); } catch {}
  if (!isFinite(tp) || tp <= 0) {
    // 실측 이력 없으면 러프 기본값
    tp = (SPEED_FACTOR[speedSel.value] || 40) * (MODEL_MULT[modelSize.value] || 1);
  }
  return inputDuration * tp;
}

function startElapsed() {
  jobStartTs = Date.now();
  progressElapsed.textContent = '경과 0.0초';
  progressText.textContent = '분리 중…';
  const est = estimateSeconds();
  progressEta.textContent = est ? `· 예상 약 ${fmtDur(est)}` : '';
  elapsedTimer = setInterval(() => {
    progressElapsed.textContent = '경과 ' + ((Date.now() - jobStartTs) / 1000).toFixed(1) + '초';
  }, 100);
}
function stopElapsed() { if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; } }

// 화면 우하단 토스트
function showToast(title, body, isErr) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  const t = document.createElement('div'); t.className = 'toast-title'; t.textContent = title;
  const b = document.createElement('div'); b.className = 'toast-body'; b.textContent = body || '';
  el.appendChild(t); el.appendChild(b);
  toastWrap.appendChild(el);
  setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 400); }, 6000);
}

async function showResults(r) {
  results.style.display = '';
  const wall = (Date.now() - jobStartTs) / 1000;
  doneBanner.textContent = `✅ 분리 완료! (${fmtDur(wall)})`;
  $('resultElapsed').textContent = r.elapsed ? `(모델 ${r.elapsed}초)` : '';
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
