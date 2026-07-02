const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

const backend = require('./src/backendClient');
const { isVideo, probe, extractAudio, remux } = require('./src/audioExtract');
const { resultsDir } = require('./src/paths');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#1e1f22',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');

  // 창을 다시 보면 작업표시줄 깜빡임 해제
  mainWindow.on('focus', () => mainWindow.flashFrame(false));

  // 백엔드 로그를 렌더러 콘솔 패널로 전달
  backend.onLog(msg => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend-log', msg);
    }
  });
}

app.whenReady().then(() => {
  // Windows 토스트 알림이 앱 이름으로 뜨도록 AppUserModelID 설정
  if (process.platform === 'win32') app.setAppUserModelId('SAM-Audio GUI');
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  backend.stop();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => backend.stop());

// ── IPC ──────────────────────────────────────────────────────────────

// 백엔드 서버 시작(모델 로드는 첫 분리 때). 준비 상태 반환.
ipcMain.handle('backend-start', async () => {
  await backend.start();
  return backend.health();
});

ipcMain.handle('backend-health', async () => {
  try { return await backend.health(); }
  catch (e) { return { status: 'down', error: String(e.message || e) }; }
});

// 모델 설정(초보자용): 상태 조회 / 로그인 / 다운로드
ipcMain.handle('model-status', async (_e, size) => {
  try { return await backend.modelStatus(size || 'base'); }
  catch (e) { return { logged_in: false, user: null, ready: false, error: String(e.message || e) }; }
});
ipcMain.handle('hf-login', async (_e, token) => {
  try { return await backend.hfLogin(token); }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('download-model', async (_e, size) => {
  try { return await backend.downloadModel(size || 'base'); }
  catch (e) { return { state: 'error', error: String(e.message || e) }; }
});
ipcMain.handle('download-status', async () => {
  try { return await backend.downloadStatus(); }
  catch (e) { return { state: 'error', error: String(e.message || e) }; }
});
ipcMain.handle('open-external', async (_e, url) => { shell.openExternal(url); return true; });

// 파일 선택창
ipcMain.handle('pick-file', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '영상 또는 오디오 파일 선택',
    properties: ['openFile'],
    filters: [
      { name: '미디어', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wav', 'mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus'] },
      { name: '모든 파일', extensions: ['*'] },
    ],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

// 입력 파일 요약(오디오 유무·길이)
ipcMain.handle('probe', async (_e, inputPath) => {
  try { return await probe(inputPath); }
  catch (e) { return { hasAudio: false, duration: 0, error: String(e.message || e) }; }
});

// 분리 실행 (오케스트레이션)
ipcMain.handle('separate', async (event, opts) => {
  const send = (stage, detail) => event.sender.send('job-progress', { stage, detail });
  const id = 'job_' + Date.now();
  const outDir = path.join(resultsDir(), id);
  fs.mkdirSync(outDir, { recursive: true });

  const input = opts.inputPath;
  const video = isVideo(input);

  // 1) 오디오 소스 확보 — 항상 ASCII 경로의 wav로 정규화한다.
  //    (torchaudio/HF가 한글 경로에 약할 수 있으므로 results 폴더(ASCII)로 추출)
  send('extract', video ? '영상에서 오디오 추출 중…' : '오디오 준비 중…');
  const audioPath = path.join(outDir, 'input.wav');
  await extractAudio(input, audioPath);

  // 2) 백엔드 분리
  send('separate', '모델 분리 중… (첫 실행은 모델 로딩으로 오래 걸릴 수 있어요)');
  const r = await backend.separate({
    audio_path: audioPath,
    out_dir: outDir,
    description: opts.description || '',
    anchors: opts.anchors || null,
    model_size: opts.modelSize || 'base',
    predict_spans: !!opts.predictSpans,
    reranking_candidates: opts.rerank || 1,
    speed: opts.speed || 'quality',
  });

  // 3) (옵션) 원본 영상에 target 오디오 리먹스
  let remuxPath = null;
  if (video && opts.remux) {
    send('remux', '결과 오디오를 영상에 합치는 중…');
    remuxPath = path.join(outDir, 'target_video' + path.extname(input));
    try { await remux(input, r.target_path, remuxPath); }
    catch (e) { send('warn', '리먹스 실패: ' + (e.message || e)); remuxPath = null; }
  }

  return {
    outDir,
    isVideo: video,
    targetPath: r.target_path,
    residualPath: r.residual_path,
    remuxPath,
    elapsed: r.elapsed,
    sampleRate: r.sample_rate,
  };
});

// 결과 파일을 사용자가 고른 위치로 저장(복사)
ipcMain.handle('save-as', async (_e, srcPath, suggestedName) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    title: '다른 이름으로 저장',
    defaultPath: suggestedName || path.basename(srcPath),
  });
  if (r.canceled || !r.filePath) return null;
  fs.copyFileSync(srcPath, r.filePath);
  return r.filePath;
});

ipcMain.handle('reveal', async (_e, p) => {
  shell.showItemInFolder(p);
  return true;
});

// 완료/실패 시 OS 데스크톱 알림 + 창이 뒤에 있으면 작업표시줄 깜빡임
ipcMain.handle('notify-done', async (_e, payload = {}) => {
  const { title = 'SAM-Audio', body = '', ok = true } = payload;
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body, silent: false }).show();
    }
  } catch { /* 알림 미지원 환경 무시 */ }
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
    mainWindow.flashFrame(true);
  }
  return ok;
});

// 렌더러 <audio>가 로컬 파일을 재생할 수 있게 file:// URL 반환
ipcMain.handle('to-file-url', async (_e, p) => {
  return 'file:///' + p.replace(/\\/g, '/');
});
