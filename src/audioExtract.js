// 벤더 ffmpeg/ffprobe로 오디오 추출 · 리먹스 · 미디어 정보 조회.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { ffmpegPath, ffprobePath } = require('./paths');

const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.wmv', '.flv', '.mpg', '.mpeg', '.ts']);
const AUDIO_EXT = new Set(['.wav', '.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wma', '.aiff', '.aif']);

function isVideo(p) { return VIDEO_EXT.has(path.extname(p).toLowerCase()); }
function isAudio(p) { return AUDIO_EXT.has(path.extname(p).toLowerCase()); }

// 공통 spawn 헬퍼 — 종료코드 0이 아니면 stderr와 함께 reject.
function run(exe, args, { onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true });
    let stderr = '';
    let stdout = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => {
      const s = d.toString();
      stderr += s;
      if (onStderr) onStderr(s);
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(exe)} exit ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

// ffprobe로 컨테이너/스트림 요약. 오디오 유무·길이 반환.
async function probe(inputPath) {
  const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath];
  const { stdout } = await run(ffprobePath(), args);
  let info = {};
  try { info = JSON.parse(stdout); } catch { info = {}; }
  const streams = info.streams || [];
  const hasAudio = streams.some(s => s.codec_type === 'audio');
  const duration = parseFloat((info.format && info.format.duration) || '0') || 0;
  return { hasAudio, duration, raw: info };
}

// 입력(영상/오디오)에서 분리에 넣을 wav를 뽑는다. 원 샘플레이트 보존, 16-bit PCM.
// 리샘플링은 SAM-Audio processor에 맡긴다.
async function extractAudio(inputPath, outWav) {
  fs.mkdirSync(path.dirname(outWav), { recursive: true });
  const args = [
    '-y',
    '-i', inputPath,
    '-vn',
    '-c:a', 'pcm_s16le',
    outWav,
  ];
  await run(ffmpegPath(), args);
  return outWav;
}

// 분리된 target 오디오를 원본 영상에 다시 얹어 새 영상을 만든다(영상 스트림 copy).
async function remux(videoPath, audioWav, outVideo) {
  fs.mkdirSync(path.dirname(outVideo), { recursive: true });
  const args = [
    '-y',
    '-i', videoPath,
    '-i', audioWav,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '320k',
    '-shortest',
    outVideo,
  ];
  await run(ffmpegPath(), args);
  return outVideo;
}

module.exports = { isVideo, isAudio, probe, extractAudio, remux };
