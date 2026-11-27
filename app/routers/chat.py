import redis
from fastapi import APIRouter, HTTPException
from cryptography.fernet import InvalidToken

from app.models.schemas import QuestionRequest
from app.services.chat_service import (
    chat_key,
    get_chat_history,
    save_chat_history,
    delete_chat_history,
    format_history
)
from app.services.error_handler import handle_rag_error
from rag import answer_from_page

router = APIRouter()

@router.post("/ask")
def ask_question(data: QuestionRequest):
    try:
        messages = get_chat_history(data.url)
        history = format_history(messages)

        answer = answer_from_page(
            url=data.url,
            question=data.question,
            api_key=data.api_key,
            history=history,
            page_content=data.page_content
        )
        # saving & Encrypt messages before saving in Redis
        save_chat_history(
            data.url,
            data.question,
            answer
        )

        return {"answer": answer}

    except HTTPException:
        raise

    except InvalidToken:
        raise HTTPException(
            status_code=500,
            detail="Unable to decrypt chat history. Check your encryption key."
        )

    except Exception as e:
        print("RAG Error:", str(e))
        handle_rag_error(e)


@router.get("/history")
def get_history(url: str):

    try:
        messages = get_chat_history(url)
        return {"messages": messages}

    except redis.ConnectionError:
        raise HTTPException(
            status_code=503,
            detail="Chat storage (Redis) is not running."
        )

    except InvalidToken:
        raise HTTPException(
            status_code=500,
            detail="Unable to decrypt chat history. Check your encryption key."
        )


@router.delete("/history")
def delete_history(url: str):

    try:
        delete_chat_history(url)
        return {"deleted": True}

    except redis.ConnectionError:
        raise HTTPException(
            status_code=503,
            detail="Chat storage (Redis) is not running."
        )