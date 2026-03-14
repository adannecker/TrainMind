from fastapi import FastAPI


app = FastAPI(title="TrainMind Withings Service", version="0.1.0")


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "withings-api", "status": "ok", "note": "placeholder for upcoming Withings integration"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "healthy"}

