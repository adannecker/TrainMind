from fastapi import FastAPI


app = FastAPI(title="TrainMind Nutrition Service", version="0.1.0")


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "nutrition-api", "status": "ok", "note": "placeholder for upcoming nutrition tracking service"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "healthy"}

