from pydantic import BaseModel

class QuestionRequest(BaseModel):
    question: str
    url: str
    api_key: str
    page_content: str = ""

class VerifyKeyRequest(BaseModel):
    api_key: str