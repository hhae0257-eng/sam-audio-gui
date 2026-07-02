"""SAM-Audio 추론 래퍼.

모델은 사이즈별로 한 번만 로드해 캐시한다(서버 프로세스가 상주하므로 재사용).
텍스트 프롬프트(description) / 스팬 프롬프트(anchors) 두 방식을 지원한다.
"""
import os


def _register_ffmpeg_dlls():
    """torchcodec는 FFmpeg 공유 DLL(avcodec/avformat/…)을 필요로 한다.
    vendor/ffmpeg (shared 빌드)를 DLL 검색 경로에 등록한다. sam_audio import 전에 호출."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    bindir = os.path.join(root, "vendor", "ffmpeg")
    if os.path.isdir(bindir):
        try:
            os.add_dll_directory(bindir)
        except Exception:
            pass
        os.environ["PATH"] = bindir + os.pathsep + os.environ.get("PATH", "")


_register_ffmpeg_dlls()

import torch
import torchaudio

# HF 게이트 체크포인트 이름
CKPT = {
    "small": "facebook/sam-audio-small",
    "base": "facebook/sam-audio-base",
    "large": "facebook/sam-audio-large",
}

# 프로젝트 루트/models/sam-audio-<size>/ 에 config.json + checkpoint.pt 가 있으면
# HF 다운로드(게이트, 대용량) 대신 그 로컬 폴더를 쓴다.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_MODELS = os.path.join(ROOT, "models")


def resolve_model_id(size: str) -> str:
    """로컬 폴더가 완비돼 있으면 그 경로를, 아니면 HF repo id를 반환."""
    local = os.path.join(LOCAL_MODELS, f"sam-audio-{size}")
    if os.path.isfile(os.path.join(local, "config.json")) and os.path.isfile(
        os.path.join(local, "checkpoint.pt")
    ):
        return local
    return CKPT[size]


def _ensure_model_dir(size: str) -> str:
    """config.json + checkpoint.pt 가 있는 디렉토리를 확보한다.
    로컬 폴더가 완비면 그걸, 아니면 HF에서 snapshot_download 한 캐시 폴더를 쓴다."""
    local = os.path.join(LOCAL_MODELS, f"sam-audio-{size}")
    if os.path.isfile(os.path.join(local, "config.json")) and os.path.isfile(
        os.path.join(local, "checkpoint.pt")
    ):
        return local
    from huggingface_hub import snapshot_download

    return snapshot_download(repo_id=CKPT[size])


_cache = {"size": None, "model": None, "proc": None}

# ODE(flow-matching) 솔버 프리셋 — 스텝 수가 곧 DiT forward 횟수라 속도를 좌우한다.
# 기본(모델 디폴트)은 midpoint step_size=2/32 → 32 NFE.
SPEED_PRESETS = {
    "quality": {"method": "midpoint", "options": {"step_size": 2 / 32}},   # 32 NFE (원 기본)
    "balanced": {"method": "midpoint", "options": {"step_size": 2 / 16}},  # 16 NFE (~2배 빠름)
    "fast": {"method": "midpoint", "options": {"step_size": 2 / 8}},       # 8 NFE (~4배 빠름)
}


def _device():
    return "cuda" if torch.cuda.is_available() else "cpu"


def load_model(size: str):
    """size에 해당하는 모델/프로세서를 로드(캐시). 이미 로드돼 있으면 재사용."""
    if size not in CKPT:
        raise ValueError(f"알 수 없는 모델 사이즈: {size} (small/base/large 중 하나)")
    if _cache["size"] == size and _cache["model"] is not None:
        return _cache["model"], _cache["proc"]

    # 지연 import — 서버 기동을 빠르게, import 오류를 여기서 잡기 위해.
    from sam_audio import SAMAudio, SAMAudioProcessor

    _patch_hub_mixin()  # from_pretrained 버전 호환 패치 (SAMAudio + 내부 랭커/저지 전부)

    model_dir = _ensure_model_dir(size)
    dev = _device()

    # from_pretrained는 내부에서 랭커/저지 모델도 빌드한다(각자 checkpoint.pt 다운로드).
    model = SAMAudio.from_pretrained(model_dir).eval()
    if dev == "cuda":
        model = model.cuda()

    # 프로세서는 자체 from_pretrained(로컬 폴더 OK)라 그대로 사용.
    proc = SAMAudioProcessor.from_pretrained(model_dir)

    _cache.update(size=size, model=model, proc=proc)
    return model, proc


_hub_patched = False


def _patch_hub_mixin():
    """sam-audio는 옛 huggingface_hub API로 작성됨. 최신 hub의 ModelHubMixin는
    _from_pretrained에 proxies/resume_download를 넘기지 않아 TypeError가 난다.
    BaseModel._from_pretrained를 기본값 있는 버전으로 교체해 전 서브클래스를 한 번에 고친다."""
    global _hub_patched
    if _hub_patched:
        return
    import json

    from huggingface_hub import snapshot_download
    from sam_audio.model.base import BaseModel

    @classmethod
    def _from_pretrained(
        cls,
        *,
        model_id,
        cache_dir=None,
        force_download=False,
        proxies=None,
        resume_download=False,
        local_files_only=False,
        token=None,
        map_location="cpu",
        strict=True,
        revision=None,
        **model_kwargs,
    ):
        if os.path.isdir(model_id):
            cached_model_dir = model_id
        else:
            cached_model_dir = snapshot_download(
                repo_id=model_id,
                revision=getattr(cls, "revision", None),
                cache_dir=cache_dir,
                force_download=force_download,
                proxies=proxies,
                token=token,
                local_files_only=local_files_only,
            )
        with open(os.path.join(cached_model_dir, "config.json")) as fin:
            config = json.load(fin)
        for key, value in model_kwargs.items():
            if key in config:
                config[key] = value
        config = cls.config_cls(**config)
        model = cls(config)
        state_dict = torch.load(
            os.path.join(cached_model_dir, "checkpoint.pt"),
            weights_only=True,
            map_location=map_location,
        )
        model.load_state_dict(state_dict, strict=strict)
        return model

    BaseModel._from_pretrained = _from_pretrained
    _hub_patched = True


def is_loaded():
    return _cache["model"] is not None


def loaded_size():
    return _cache["size"]


def run_separation(
    audio_path: str,
    out_dir: str,
    description: str = "",
    anchors=None,
    size: str = "base",
    predict_spans: bool = False,
    reranking_candidates: int = 1,
    speed: str = "quality",
):
    """분리 실행 후 target/residual wav 경로와 샘플레이트를 반환."""
    model, proc = load_model(size)
    dev = _device()

    proc_kwargs = {"audios": [audio_path], "descriptions": [description or ""]}
    if anchors:
        # anchors 예: [[["+", 6.3, 7.0]]]  (배치 1개 → 앵커 리스트)
        proc_kwargs["anchors"] = anchors

    batch = proc(**proc_kwargs)
    if hasattr(batch, "to"):
        batch = batch.to(dev)

    ode_opt = SPEED_PRESETS.get(speed, SPEED_PRESETS["quality"])
    with torch.inference_mode():
        result = model.separate(
            batch,
            ode_opt=ode_opt,
            predict_spans=predict_spans,
            reranking_candidates=reranking_candidates,
        )

    sr = getattr(proc, "audio_sampling_rate", 44100)
    os.makedirs(out_dir, exist_ok=True)
    target_path = os.path.join(out_dir, "target.wav")
    residual_path = os.path.join(out_dir, "residual.wav")

    target = _extract_wave(result.target)
    residual = _extract_wave(result.residual)

    torchaudio.save(target_path, target, sr)
    torchaudio.save(residual_path, residual, sr)
    return target_path, residual_path, sr


def _extract_wave(x) -> torch.Tensor:
    """separate() 결과는 배치라 target/residual이 list로 온다(항목당 텐서).
    첫 항목을 꺼내 [channels, frames] 2D 텐서로 정규화."""
    # 배치/후보 리스트 언랩 (한 개 입력 → [0])
    while isinstance(x, (list, tuple)):
        x = x[0]
    if not torch.is_tensor(x):
        x = torch.as_tensor(x)
    x = x.detach().cpu().float()
    if x.dim() == 3:  # [batch, channels, frames]
        x = x[0]
    elif x.dim() == 1:  # [frames]
        x = x.unsqueeze(0)
    return x.contiguous()
