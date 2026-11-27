from fastapi import APIRouter, HTTPException
from google import genai

from app.models.schemas import VerifyKeyRequest
from app.core.config import GEMINI_MODEL

router = APIRouter()


@router.post("/verify-key")
def verify_key(data: VerifyKeyRequest):

    try:
        test_client = genai.Client(api_key=data.api_key)

        response = test_client.models.generate_content(
            model=GEMINI_MODEL,
            contents="Reply with OK."
        )

        if not response.text:
            raise HTTPException(
                status_code=400,
                detail="API key verification failed."
            )

        return {"valid": True}

    except HTTPException:
        raise

    except Exception:
        raise HTTPException(
            status_code=401,
            detail="Invalid API key or Gemini access unavailable. Check your key and API access."
        )