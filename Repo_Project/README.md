# RepoMind

RepoMind is a professional AI-based web application that analyzes GitHub repositories or local code folders, providing file structure visualizations, language breakdowns, and AI-powered code explanations using completely free local LLMs (Ollama Phi-3).

## Prerequisites
1. Python 3.9+
2. Git
3. [Ollama](https://ollama.com) installed locally.

## Setup Instructions

### 1. Install and Pull Ollama Phi-3 Model
Make sure Ollama is installed on your machine and the `phi3` model is ready.
```bash
# Start Ollama service (usually runs automatically on Mac)
# Pull the phi3 model
ollama pull phi3
```

### 2. Backend Setup
Activate the virtual environment and install dependencies:
```bash
# From the project root where `venv` was created:
source venv/bin/activate

# (Dependencies should already be installed inside the workspace venv)
# Start the FastAPI Server
cd backend
uvicorn main:app --reload
```

### 3. Accessing the Application
Once the backend is running, the frontend is directly mounted.
Open your browser and navigate to:
[http://localhost:8000/index.html](http://localhost:8000/index.html)

### Features Implemented
- **User Authentication:** Secure Signup/Login with SQLite and JWT tokens.
- **Repository Analysis:** Clone public GitHub repos or upload `.zip` folders to generate a file tree, LOC counts, and language breakdowns.
- **Module System:** 5 dynamic UI modules. Module 1 (AI Code Explanation) is fully active while 2-5 are visually locked.
- **AI Code Explanation:** Uses local `phi3` via the `ollama` Python library to generate structured, beginner-friendly explanations of architecture or individual files.
