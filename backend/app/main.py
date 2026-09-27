import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.config import settings
from app.routes import auth, complaints, public, officials

# Setup root logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s"
)
logger = logging.getLogger("civiclens.main")

from app.services.firestore_service import firestore_service
from app.services.gemini_service import get_gemini_runtime_status, set_gemini_reachability

# State variable for Gemini reachability
gemini_status = {
    "configured": bool(settings.GEMINI_API_KEY),
    "reachable": False,
    "model": settings.GEMINI_MODEL,
    "message": "Initializing..."
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup verification for Gemini AI and cloud dependencies."""
    logger.info("==================================================================")
    logger.info("CivicLens Platform Booting...")
    
    # 1. Fast configuration check for Gemini AI status
    if settings.GEMINI_API_KEY:
        gemini_status["configured"] = True
        gemini_status["reachable"] = True
        gemini_status["message"] = f"Gemini API ({settings.GEMINI_MODEL}) is configured."
        set_gemini_reachability(True)
        logger.info(f"✅ Gemini AI is CONFIGURED (Model: {settings.GEMINI_MODEL})")
    else:
        gemini_status["configured"] = False
        gemini_status["reachable"] = False
        gemini_status["message"] = "No GEMINI_API_KEY provided in environment. Running offline heuristic fallback."
        set_gemini_reachability(False, "No GEMINI_API_KEY in environment")
        logger.warning("⚠️ No GEMINI_API_KEY detected in environment. Using offline heuristic classifier.")

    # 2. Log database/storage status
    storage_info = firestore_service.get_storage_status()
    if storage_info["storage"] == "firestore":
        logger.info(f"✅ Database: Real Google Cloud Firestore connected (Project: {storage_info['project_id']})")
    else:
        logger.info(f"ℹ️ Database: Local JSON fallback active. Reason: {storage_info['reason']}")

    logger.info("==================================================================")
    yield
    logger.info("CivicLens Platform shutting down.")


app = FastAPI(
    title="CivicLens API",
    description="Civic Infrastructure Complaint & Governance Platform for India, powered by Google Cloud Gemini & Firestore",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# Enable CORS for frontend development and production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure officials portal & auth endpoints are NEVER cached across browser or CDN
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

class NoCacheOfficialsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        path = request.url.path
        if any(prefix in path for prefix in ["/officials", "/auth", "/requests", "/public"]):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0, private"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

app.add_middleware(NoCacheOfficialsMiddleware)

# Include API Routers (both direct and /api prefixed)
app.include_router(auth.router)
app.include_router(complaints.router)
app.include_router(public.router)
app.include_router(officials.router)

app.include_router(auth.router, prefix="/api")
app.include_router(complaints.router, prefix="/api")
app.include_router(public.router, prefix="/api")
app.include_router(officials.router, prefix="/api")


@app.get("/api/health", tags=["Health"])
@app.get("/health", tags=["Health"])
@app.get("/api", tags=["Health"])
async def health_check():
    runtime_gemini = get_gemini_runtime_status()
    merged_gemini = {**gemini_status, **runtime_gemini}
    return {
        "status": "healthy",
        "service": "civiclens-backend",
        "storage": firestore_service.get_storage_type(),
        "storage_details": firestore_service.get_storage_status(),
        "gemini": merged_gemini
    }



# Static Files & SPA fallback for Cloud Run deployment
frontend_dist_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "frontend", "dist")

if os.path.exists(frontend_dist_path):
    logger.info(f"Serving built frontend SPA from {frontend_dist_path}")
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist_path, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        file_path = os.path.join(frontend_dist_path, full_path)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(frontend_dist_path, "index.html"))
else:
    @app.get("/", tags=["Health"])
    async def root():
        return {
            "app": "CivicLens API",
            "status": "online",
            "version": "1.0.0",
            "gemini": gemini_status,
            "docs": "/docs"
        }


if __name__ == "__main__":
    import uvicorn
    logger.info(f"Starting CivicLens on {settings.HOST}:{settings.PORT}")
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG)
