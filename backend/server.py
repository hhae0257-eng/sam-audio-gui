"""SAM-Audio 상주 추론 서버 (FastAPI + uvicorn).

Electron main이 free 포트로 이 스크립트를 spawn한다.
모델은 첫 /separate 요청 때 lazy 로드되어 프로세스가 살아있는 동안 재사용된다.
"""
import argparse
import traceback

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import separate

app = FastAPI(title="SAM-Audio Server")


class SeparateRequest(BaseModel):
    audio_path: str
    out_dir: str
    description: str = ""
    anchors: list | None = None
    model_size: str = "base"
    predict_spans: bool = False
    reranking_candidates: int = 1
    speed: str = "quality"


@app.get("/health")
def health():
    import torch
    return {
        "status": "ok",
        "cuda": torch.cuda.is_available(),
        "device": "cuda" if torch.cuda.is_available() else "cpu",
        "model_loaded": separate.is_loaded(),
        "model_size": separate.loaded_size(),
    }


class LoginRequest(BaseModel):
    token: str


class SizeRequest(BaseModel):
    size: str = "base"


@app.get("/model-status")
def model_status(size: str = "base"):
    try:
        return separate.hf_status(size)
    except Exception as e:  # noqa: BLE001
        return {"logged_in": False, "user": None, "ready": False, "error": str(e)}


@app.post("/hf-login")
def hf_login(req: LoginRequest):
    try:
        user = separate.hf_login(req.token)
        # 접근 권한까지 확인 (게이트 승인 안 됐으면 여기서 에러)
        try:
            separate.check_access("base")
            access = True
            access_error = None
        except Exception as e:  # noqa: BLE001
            access = False
            access_error = str(e)
        return {"ok": True, "user": user, "access": access, "access_error": access_error}
    except Exception as e:  # noqa: BLE001
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})


@app.post("/download-model")
def download_model(req: SizeRequest):
    try:
        return separate.start_download(req.size)
    except Exception as e:  # noqa: BLE001
        return JSONResponse(status_code=400, content={"error": str(e)})


@app.get("/download-status")
def get_download_status():
    return separate.download_status()


@app.post("/separate")
def do_separate(req: SeparateRequest):
    import time
    t0 = time.time()
    try:
        target_path, residual_path, sr = separate.run_separation(
            audio_path=req.audio_path,
            out_dir=req.out_dir,
            description=req.description,
            anchors=req.anchors,
            size=req.model_size,
            predict_spans=req.predict_spans,
            reranking_candidates=req.reranking_candidates,
            speed=req.speed,
        )
        return {
            "target_path": target_path,
            "residual_path": residual_path,
            "sample_rate": sr,
            "elapsed": round(time.time() - t0, 2),
        }
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()

    import uvicorn
    # 준비 신호(디버깅용). Electron은 /health 폴링으로 준비를 판단한다.
    print(f"SAMAUDIO_SERVER_STARTING port={args.port}", flush=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
