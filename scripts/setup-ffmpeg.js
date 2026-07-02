// npm install 후 자동 실행되어 검증된 ffmpeg 빌드(Gyan full build)를 vendor/ffmpeg 에 받아둔다.
// Windows 전용. 실패해도 npm install 자체는 중단하지 않는다(앱이 PATH의 ffmpeg를 대신 쓸 수 있도록).
// exr-to-video 프로젝트의 동일 스크립트를 재사용.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// shared 빌드를 받는다: ffmpeg.exe/ffprobe.exe + avcodec/avformat 등 공유 DLL 포함.
// 이 DLL들은 torchcodec(백엔드)가 오디오/영상 디코딩에 반드시 필요로 한다.
const VERSION = '8.1.1';
const ZIP_URL =
  'https://github.com/GyanD/codexffmpeg/releases/download/' +
  VERSION + '/ffmpeg-' + VERSION + '-full_build-shared.zip';

const vendorDir = path.join(__dirname, '..', 'vendor', 'ffmpeg');
const ffmpegExe = path.join(vendorDir, 'ffmpeg.exe');
const ffprobeExe = path.join(vendorDir, 'ffprobe.exe');

function log(m) { console.log('[setup-ffmpeg] ' + m); }

function main() {
  if (fs.existsSync(ffmpegExe) && fs.existsSync(ffprobeExe)) {
    log('ffmpeg가 이미 준비돼 있습니다 — 건너뜁니다.');
    return;
  }
  if (process.platform !== 'win32') {
    log('Windows 전용 자동 설치입니다. 다른 OS에서는 ffmpeg를 직접 설치한 뒤 PATH에 등록하세요.');
    return;
  }

  const tmp = path.join(os.tmpdir(), 'samaudio_ffmpeg_' + Date.now());
  const zipPath = path.join(tmp, 'ffmpeg.zip');
  try {
    fs.mkdirSync(tmp, { recursive: true });
    fs.mkdirSync(vendorDir, { recursive: true });

    log('ffmpeg ' + VERSION + ' 다운로드 중… (약 240MB)');
    // curl, tar 는 Windows 10/11 에 기본 내장되어 있다.
    execFileSync('curl', ['-L', '-f', '-o', zipPath, ZIP_URL], { stdio: 'inherit' });

    log('압축 해제 중…');
    // Windows에 항상 있는 PowerShell Expand-Archive 를 쓴다.
    const psCmd =
      "Expand-Archive -LiteralPath '" + zipPath.replace(/'/g, "''") +
      "' -DestinationPath '" + tmp.replace(/'/g, "''") + "' -Force";
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd], { stdio: 'inherit' });

    const buildDir = fs.readdirSync(tmp).find(
      d => d.startsWith('ffmpeg-') && fs.statSync(path.join(tmp, d)).isDirectory()
    );
    if (!buildDir) throw new Error('압축 해제된 ffmpeg 폴더를 찾지 못했습니다.');

    const binDir = path.join(tmp, buildDir, 'bin');
    // exe + dll 전부 복사 (shared 빌드: ffmpeg.exe는 옆의 av*.dll을 필요로 함).
    for (const f of fs.readdirSync(binDir)) {
      if (f.endsWith('.exe') || f.endsWith('.dll')) {
        fs.copyFileSync(path.join(binDir, f), path.join(vendorDir, f));
      }
    }
    log('ffmpeg(shared) 준비 완료 → vendor/ffmpeg (exe + av*.dll)');
  } catch (e) {
    log('자동 다운로드 실패: ' + (e.message || e));
    log('앱은 시스템 PATH의 ffmpeg를 대신 사용합니다. 필요하면 직접 설치하세요: winget install Gyan.FFmpeg');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

main();
