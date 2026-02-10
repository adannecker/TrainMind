from fastapi import FastAPI

app = FastAPI(title="TrainMind API", version="0.1.0")


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "trainmind-api", "status": "ok"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "healthy"}
