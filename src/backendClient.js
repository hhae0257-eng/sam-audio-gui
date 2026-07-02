// Python FastAPI 백엔드(server.py)의 생명주기 관리 + HTTP 호출.
// - 앱 시작 시 free 포트에 서버를 spawn하고 /health 폴링으로 준비 확인.
// - 모델은 첫 /separate 요청 때 lazy 로드되므로, /health는 서버 import 완료만 뜻한다.
const { spawn } = require('child_process');
const net = require('net');
const { venvPython, backendScript, ROOT } = require('./paths');

let proc = null;
let port = null;
let starting = null;
let logSink = () => {}; // 렌더러로 로그 흘려보낼 콜백(선택)

function onLog(fn) { logSink = typeof fn === 'function' ? fn : (() => {}); }

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

function base() { return `http://127.0.0.1:${port}`; }

async function health() {
  const res = await fetch(base() + '/health', { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error('health ' + res.status);
  return res.json();
}

async function waitForHealth(timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const h = await health();
      if (h && h.status === 'ok') return h;
    } catch { /* 아직 준비 안 됨 */ }
    await new Promise(r => setTimeout(r, 600));
  }
  throw new Error('백엔드 서버가 제한 시간 안에 준비되지 않았습니다.');
}

async function start() {
  if (proc && port) return { port };
  if (starting) return starting;
  starting = (async () => {
    const python = venvPython();
    port = await getFreePort();
    logSink(`[backend] 서버 시작 중… python=${python} port=${port}`);
    proc = spawn(python, [backendScript(), '--port', String(port)], {
      cwd: ROOT,
      windowsHide: true,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
    proc.stdout.on('data', d => logSink('[py] ' + d.toString().trimEnd()));
    proc.stderr.on('data', d => logSink('[py] ' + d.toString().trimEnd()));
    proc.on('exit', (code, sig) => {
      logSink(`[backend] 서버 종료 (code=${code} sig=${sig})`);
      proc = null; port = null;
    });
    await waitForHealth();
    logSink('[backend] 준비 완료');
    return { port };
  })();
  try { return await starting; }
  finally { starting = null; }
}

// 분리 요청. payload는 server.py /separate 스키마를 따른다.
async function separate(payload) {
  if (!proc || !port) await start();
  let res;
  try {
    res = await fetch(base() + '/separate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // 대형 파일/large 모델은 오래 걸릴 수 있음 — 넉넉히.
      signal: AbortSignal.timeout(60 * 60 * 1000),
    });
  } catch (e) {
    // fetch 자체 실패 = 연결이 끊김. 서버가 처리 중 종료됐거나(대개 VRAM 부족/OOM) 시간 초과.
    // 죽었을 수 있는 서버를 정리해 다음 시도에 재시작되게 한다.
    stop();
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (timedOut) {
      throw new Error('분리가 제한 시간(1시간)을 넘었습니다. 더 짧은 클립·빠름 프리셋·더 작은 모델(base/small)을 쓰세요.');
    }
    throw new Error(
      '백엔드가 응답 중 종료되었습니다. VRAM 부족(OOM)일 가능성이 큽니다 — '
      + 'large는 16GB GPU에 안 들어갑니다. base 또는 small 모델, 짧은 클립, 빠름 프리셋을 시도하세요.'
    );
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data.error || ('separate ' + res.status));
  return data;
}

function stop() {
  if (proc) {
    try { proc.kill(); } catch {}
    proc = null; port = null;
  }
}

module.exports = { start, stop, separate, health, onLog };
