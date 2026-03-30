from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from backend import models, schemas, auth, database, analyzer, llm_service,file_breakdown ,doc_generator
from backend.database import engine, get_db
import os
import shutil
import tempfile
import subprocess
import uuid
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))


# Create DB tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="RepoMind API")
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

REPO_CACHE = {}
BREAKDOWN_PREVIEW_CACHE = {}

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/login")

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = auth.decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    username = payload.get("sub")
    user = db.query(models.User).filter(models.User.username == username).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user

@app.post("/api/signup", response_model=schemas.UserResponse)
def signup(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    hashed_password = auth.get_password_hash(user.password)
    new_user = models.User(username=user.username, hashed_password=hashed_password)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.post("/api/login", response_model=schemas.Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == form_data.username).first()
    if not user or not auth.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username or password")
    
    access_token = auth.create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/modules")
def get_modules():
    return {
        "modules": [
            {"id": 1, "name": "Explain Project Overview", "locked": False},
            {"id": 2, "name": "Q&A Chat", "locked": False},
            {"id": 3, "name": "File Breakdown", "locked": False},
            {"id": 4, "name": "Documentation Generator", "locked": False},
            {"id": 5, "name": "Dependency Graph", "locked": False},
            {"id": 6, "name": "View Code", "locked": False},
        ]
    }

@app.post("/api/analyze/url")
def analyze_url(req: schemas.AnalyzeUrlRequest, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        if req.url in REPO_CACHE:
            analysis_result = REPO_CACHE[req.url]
        else:
            analysis_result = analyzer.analyze_github_repo(req.url)
            REPO_CACHE[req.url] = analysis_result
            
        # Store analysis history
        new_analysis = models.Analysis(repo_url=req.url, user_id=user.id)
        db.add(new_analysis)
        db.commit()
        return analysis_result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/analyze/upload")
def analyze_upload(file: UploadFile = File(...), user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only .zip files are supported")
    try:
        cache_key = f"upload_{file.filename}"
        if cache_key in REPO_CACHE:
            return REPO_CACHE[cache_key]
            
        temp_dir = f"./temp_uploads_{file.filename}"
        os.makedirs(temp_dir, exist_ok=True)
        file_path = os.path.join(temp_dir, file.filename)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        analysis_result = analyzer.analyze_zip_file(file_path, temp_dir)
        REPO_CACHE[cache_key] = analysis_result
        return analysis_result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/breakdown/preview")
def breakdown_preview(req: schemas.BreakdownPreviewRequest, user: models.User = Depends(get_current_user)):
    """
    File breakdown from already-analyzed repo_data (no second clone / scan).
    Cached per cache_key when provided.
    """
    try:
        cache_key = req.cache_key
        if cache_key and cache_key in BREAKDOWN_PREVIEW_CACHE:
            return BREAKDOWN_PREVIEW_CACHE[cache_key]

        file_tree = req.repo_data.get("file_tree") or {}
        file_nodes = file_breakdown.extract_file_nodes_from_tree(file_tree)
        result = file_breakdown.analyze_files_from_cache(file_nodes)
        if cache_key:
            BREAKDOWN_PREVIEW_CACHE[cache_key] = result
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/breakdown/file-summary")
def breakdown_file_summary(req: schemas.BreakdownSummaryRequest, user: models.User = Depends(get_current_user)):
    """On-demand short AI summary for one file (uses cached tree content only)."""
    try:
        summary = file_breakdown.generate_file_summary_for_path(req.repo_data, req.file_path)
        return {"summary": summary}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/breakdown/url")
def breakdown_url(req: schemas.BreakdownUrlRequest, user: models.User = Depends(get_current_user)):
    try:
        if req.url in BREAKDOWN_PREVIEW_CACHE:
            return BREAKDOWN_PREVIEW_CACHE[req.url]

        if req.url in REPO_CACHE:
            repo_data = REPO_CACHE[req.url]
            file_nodes = file_breakdown.extract_file_nodes_from_tree(repo_data.get("file_tree", {}))
            result = file_breakdown.analyze_files_from_cache(file_nodes)
            BREAKDOWN_PREVIEW_CACHE[req.url] = result
            return result

        # Reuse the same GitHub analysis logic as /api/analyze/url.
        analysis_result = analyzer.analyze_github_repo(req.url)
        REPO_CACHE[req.url] = analysis_result

        file_nodes = file_breakdown.extract_file_nodes_from_tree(analysis_result.get("file_tree", {}))
        result = file_breakdown.analyze_files_from_cache(file_nodes)
        BREAKDOWN_PREVIEW_CACHE[req.url] = result
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/explain")
def explain_code(data: dict, user: models.User = Depends(get_current_user)):
    # data should contain 'file_path' and 'content' OR 'repo_summary'
    try:
        if "content" in data and "file_path" in data:
            explanation = llm_service.explain_file(data["file_path"], data["content"])
        elif "repo_summary" in data:
            explanation = llm_service.explain_repo(data["repo_summary"])
        else:
            raise HTTPException(status_code=400, detail="Invalid request format")
        return {"explanation": explanation}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM Error: {str(e)}")

@app.post("/api/chat")
def chat_with_repo(req: schemas.ChatRequest, user: models.User = Depends(get_current_user)):
    try:
        answer = llm_service.chat_about_repo(req.question, req.context)
        return {"answer": answer}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM Error: {str(e)}")

@app.post("/api/generate-docs")
def generate_docs(req: schemas.DocRequest, user: models.User = Depends(get_current_user)):
    try:
        filename = f"report_{uuid.uuid4().hex[:8]}.pdf"
        output_path = os.path.join(tempfile.gettempdir(), filename)
        doc_generator.generate_pdf_report(req.repo_data, output_path)
        return FileResponse(output_path, media_type="application/pdf", filename="Repository_Documentation.pdf")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/dependency-graph")
def generate_dependency_graph(req: schemas.DocRequest, user: models.User = Depends(get_current_user)):
    try:
        import dependency_graph
        markdown_res = dependency_graph.generate_graph_data(req.repo_data)
        return {"markdown": markdown_res}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# Mount frontend
app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")
