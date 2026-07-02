// 앱 내부에서 쓰는 실행 파일/스크립트 경로를 한 곳에서 해석한다.
const path = require('path');
const fs = require('fs');

// 프로젝트 루트 (main.js 기준 한 단계 위). 개발/설치 모두 동일 레이아웃.
const ROOT = path.join(__dirname, '..');

function venvPython() {
  // Windows venv 표준 경로
  const p = path.join(ROOT, 'venv', 'Scripts', 'python.exe');
  return p;
}

function ffmpegPath() {
  const vendored = path.join(ROOT, 'vendor', 'ffmpeg', 'ffmpeg.exe');
  return fs.existsSync(vendored) ? vendored : 'ffmpeg'; // 폴백: PATH
}

function ffprobePath() {
  const vendored = path.join(ROOT, 'vendor', 'ffmpeg', 'ffprobe.exe');
  return fs.existsSync(vendored) ? vendored : 'ffprobe';
}

function backendScript() {
  return path.join(ROOT, 'backend', 'server.py');
}

// 결과물 임시/출력 폴더 (앱 루트 아래 results). 없으면 만든다.
function resultsDir() {
  const d = path.join(ROOT, 'results');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// ffmpeg/HF/torchcodec가 한글 경로에 약할 때 쓰는 ASCII 임시 작업 폴더.
function asciiTempDir() {
  const os = require('os');
  const d = path.join(os.tmpdir(), 'samaudio_work');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

module.exports = {
  ROOT,
  venvPython,
  ffmpegPath,
  ffprobePath,
  backendScript,
  resultsDir,
  asciiTempDir,
};
