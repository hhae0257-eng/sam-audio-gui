# 🎧 SAM-Audio GUI — 텍스트 프롬프트 소리 분리 도구

영상·오디오에서 **원하는 소리만 골라 분리**하는 Windows 데스크톱 앱입니다.
Meta의 [SAM-Audio](https://github.com/facebookresearch/sam-audio) 모델을 쉽게 쓸 수 있도록 감싼 Electron GUI예요.

MSST(Bandit) 같은 고정 스템 분리와 달리, **`dog barking`, `footsteps`, `speech` 처럼 영어 텍스트로 원하는 소리를 지정**해서 뽑아낼 수 있습니다.

- **입력**: 영상(mp4/mov/mkv…) 또는 오디오(wav/mp3/flac…)
- **출력**: `target`(뽑아낸 소리) + `residual`(나머지) 두 개의 wav
- **모드**: 대사/음성 · 효과음/특정소리 · 음악/BGM · 고급(스팬·재랭킹)

---

## 📋 요구사항

| 항목 | 사양 |
|---|---|
| OS | Windows 10 / 11 |
| GPU | **NVIDIA, VRAM 12GB 이상 권장** (base 모델이 ~11GB 사용) |
| 그 외 | 인터넷(첫 설치·모델 다운로드), 디스크 여유 ~20GB |

> RTX 30/40/**50(Blackwell)** 시리즈 모두 지원합니다. 50 시리즈는 설치 스크립트가 자동으로 CUDA 12.8 빌드 PyTorch를 깔아줍니다.

---

## 🚀 설치 (처음 한 번)

1. 이 저장소를 다운로드/클론합니다.
   ```
   git clone https://github.com/hhae0257-eng/sam-audio-gui.git
   ```
2. **`install.bat` 더블클릭** — 자동으로:
   - Python 3.12 확인/설치 → 가상환경(venv) 생성
   - PyTorch (CUDA 12.8) 설치
   - `sam-audio` + 서버 의존성 설치
   - Electron + FFmpeg(공유 빌드) 다운로드

   > ⏳ 용량이 크고(수 GB) 네트워크에 따라 오래 걸립니다. 창을 닫지 마세요.

---

## 🔑 모델 받기 (필수 · 중요)

SAM-Audio 모델은 **Hugging Face 게이트(gated)** 모델이라, 저장소에 포함돼 있지 않습니다. **직접 접근 승인 + 로그인**이 필요합니다.

### 1단계 — 접근 승인 요청
아래 페이지에서 접근 요청 버튼을 누릅니다 (보통 즉시/빠르게 승인):
- **base (권장, 7.7GB)**: https://huggingface.co/facebook/sam-audio-base
- (선택) small / large: `.../sam-audio-small`, `.../sam-audio-large`

### 2단계 — 로그인 (토큰 등록)
```
venv\Scripts\hf auth login
```
- 토큰 발급: https://huggingface.co/settings/tokens (**Read** 권한이면 충분)
- 붙여넣기 후 `Add token as git credential?`은 `n`이어도 됩니다.
- ⚠️ 예전 `huggingface-cli login`은 폐기되어 동작하지 않습니다. 반드시 **`hf auth login`** 사용.

### 3단계 — 다운로드 (자동)
로그인만 돼 있으면, **앱에서 첫 분리를 실행할 때 모델이 자동으로 다운로드**됩니다(HF 캐시에 저장). 별도 작업 불필요.

<details>
<summary>📁 (선택) 모델을 수동으로 미리 받아두기</summary>

느린 네트워크에서 매번 캐시가 꼬이는 게 싫다면, 로컬 폴더에 직접 넣어둘 수 있습니다.
`config.json` + `checkpoint.pt` 두 파일을 아래 위치에 두면 앱이 **로컬 폴더를 우선 사용**합니다(재다운로드 안 함):

```
sam-audio-gui\models\sam-audio-base\config.json
sam-audio-gui\models\sam-audio-base\checkpoint.pt
```

파일은 HF 저장소 페이지(`facebook/sam-audio-base` → Files)에서 받거나:
```
venv\Scripts\hf download facebook/sam-audio-base config.json checkpoint.pt --local-dir models\sam-audio-base
```
</details>

---

## ▶️ 실행 & 사용법

**`시작하기.bat` 더블클릭** → 앱 창이 뜹니다.

1. 상단 상태등이 **초록(GPU 준비됨)** 이 될 때까지 잠깐 기다립니다.
2. 영상/오디오 파일을 창에 **끌어다 놓기**(또는 클릭해서 선택).
3. 상단 **탭**에서 모드 선택:
   | 탭 | 설명 | 프롬프트 |
   |---|---|---|
   | 🗣️ 대사/음성 | 사람 말만 분리 | `speech` 등 프리셋 |
   | 🔊 효과음/특정소리 | 원하는 소리 지정 | 영어 직접 입력 (`footsteps`…) |
   | 🎵 음악/BGM | 배경음악 분리 | `music` 프리셋 |
   | ⚙️ 고급 | 스팬(시간구간)·재랭킹 제어 | 자유 + 앵커 |
4. **속도/품질** 드롭다운으로 속도 선택 (아래 성능 참고).
5. **분리 시작** → 하단 **결과** 섹션에 `target`/`residual` 플레이어가 뜨고, **저장** 버튼으로 원하는 위치에 저장.
   - 영상 입력이면 **리먹스** 체크 시, 뽑은 오디오를 원본 영상에 다시 얹어줍니다.

📁 결과 파일은 `results\job_<시간>\target.wav` / `residual.wav` 에도 저장됩니다.

---

## ⚡ 성능 (꼭 읽어보세요)

이 모델은 품질은 좋지만 **연산이 무겁습니다.** 속도/품질 프리셋으로 조절하세요:

| 프리셋 | 내부 스텝 | 상대 속도 | 용도 |
|---|---|---|---|
| **빠름** | 8 | 가장 빠름 (~4배 적은 연산) | 미리듣기·빠른 확인 |
| **균형** (기본) | 16 | 중간 | 일반 사용 |
| **고품질** | 32 | 가장 느림 | 최종 결과 |

**실측 예시(base, RTX 5070 Ti)**: 8초 클립 기준 빠름 ≈ 3분, 고품질 ≈ 7분. 즉 **긴 영상은 매우 오래 걸립니다.** 팁:

- 🔪 **필요한 구간만 잘라서** 넣으세요.
- 🎮 SAM-Audio 돌릴 땐 **다른 GPU 앱(LM Studio·ComfyUI·게임 등)을 닫으세요** — VRAM/GPU를 나눠 쓰면 훨씬 느려집니다.
- 🧊 앱은 모델을 메모리에 상주시키므로 **첫 분리만 느리고 이후는 빨라집니다**.
- 🎚️ 깨끗한 **대사/음악/효과음 3스템**만 필요하면 [MSST(Bandit)](https://github.com/SUC-DriverOld/MSST-WebUI)류가 훨씬 빠릅니다. SAM-Audio는 **"임의 텍스트로 특정 소리 뽑기"** 가 강점입니다.

---

## 🧩 프롬프트 팁
- 영어 **소문자 명사/동사구**가 가장 잘 됩니다. (`thunder` ⭕ / `Thunder can be heard...` ❌)
- 예: `speech`, `music`, `dog barking`, `footsteps`, `car honking`, `applause`, `rain`, `gunshot`

---

## 🛠️ 문제 해결

| 증상 | 원인 / 해결 |
|---|---|
| 상태등이 빨강/노랑에서 안 바뀜 | 설치 미완료 → `install.bat` 다시 실행 |
| "GPU 준비 안 됨(CPU)" 표시 | PyTorch가 CUDA 빌드로 안 깔림. 50 시리즈는 CUDA 12.8 필수 (install.bat이 처리) |
| 분리가 **500 오류** | HF 모델 **접근 승인/로그인 안 됨** → 위 "모델 받기" 참고 |
| 분리가 끝이 안 남 | 고장 아님. 긴 오디오는 오래 걸림 — 진행바/경과시간 확인, 빠름 프리셋 사용 |
| VRAM 부족(OOM) | 다른 GPU 앱 닫기, `small` 모델 사용 |

---

## 📄 라이선스 / 출처

- **이 GUI 래퍼 코드**: [MIT](LICENSE)
- **SAM-Audio 모델 & `sam-audio` 패키지**: Meta의 **SAM License** ([원본 저장소](https://github.com/facebookresearch/sam-audio)). 모델 가중치는 이 저장소에 **포함돼 있지 않으며**, 각자 Hugging Face에서 Meta 라이선스에 동의하고 받아야 합니다.
- FFmpeg는 설치 시 [Gyan.dev](https://www.gyan.dev/ffmpeg/builds/) 빌드를 내려받아 사용합니다.

> 이 프로젝트는 Meta·Hugging Face와 무관한 비공식 커뮤니티 래퍼입니다.
