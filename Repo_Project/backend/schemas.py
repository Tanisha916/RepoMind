from pydantic import BaseModel

class UserCreate(BaseModel):
    username: str
    password: str

class UserResponse(BaseModel):
    id: int
    username: str
    
    model_config = {"from_attributes": True}

class Token(BaseModel):
    access_token: str
    token_type: str

class AnalyzeUrlRequest(BaseModel):
    url: str

class ChatRequest(BaseModel):
    question: str
    context: dict

class BreakdownUrlRequest(BaseModel):
    url: str

class DocRequest(BaseModel):
    repo_data: dict

class BreakdownPreviewRequest(BaseModel):
    repo_data: dict
    cache_key: str | None = None

class BreakdownSummaryRequest(BaseModel):
    repo_data: dict
    file_path: str

class BreakdownPreviewRequest(BaseModel):
    repo_data: dict
    cache_key: str | None = None

class BreakdownSummaryRequest(BaseModel):
    repo_data: dict
    file_path: str
