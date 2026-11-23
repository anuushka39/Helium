from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Edgon API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class QuestionRequest(BaseModel):
    question: str
    context: str

@app.get("/")
def home():
    return {"message": "Edgon API is running!"}

@app.post("/ask")
def ask_question(data: QuestionRequest):

    return {
        "answer": (
            f"You asked: {data.question}\n\n"
            f"I received {len(data.context)} characters "
            "from the webpage. AI integration is coming next!"
        )
    }
