import redis
from fastapi import HTTPException

def handle_rag_error(error):
    # Redis is not running
    if isinstance(error, redis.ConnectionError):
        raise HTTPException(
            status_code=503,
            detail="Chat storage (Redis) is not running. Please start Redis and try again."
        )

    error_msg = str(error).upper()

    # Invalid API key
    if "API_KEY_INVALID" in error_msg or "API KEY NOT VALID" in error_msg:
        raise HTTPException(
            status_code=401,
            detail="Your Gemini API key is invalid. Please go to the menu and change your API key."
        )
    # Quota or rate limit
    elif "RESOURCE_EXHAUSTED" in error_msg or "QUOTA" in error_msg or "429" in error_msg:
        raise HTTPException(
            status_code=429,
            detail="Gemini usage limit reached. Please try again later or change your API key from the menu."
        )
    # API access or permission issue
    elif "PERMISSION_DENIED" in error_msg or "403" in error_msg:
        raise HTTPException(
            status_code=403,
            detail="Your API key does not have permission to access this Gemini service. Check your API access or change your key."
        )
    # Gemini temporarily unavailable
    elif "UNAVAILABLE" in error_msg or "503" in error_msg or "OVERLOADED" in error_msg:
        raise HTTPException(
            status_code=503,
            detail="Gemini is temporarily overloaded. Please try again in a few minutes."
        )
    # Webpage fetching / SSL issue
    elif "CERTIFICATE_VERIFY_FAILED" in error_msg or "SSLERROR" in error_msg:
        raise HTTPException(
            status_code=502,
            detail="Helium couldn't securely fetch this webpage. Try another publicly accessible webpage."
        )
    # Other errors
    else:
        raise HTTPException(
            status_code=500,
            detail="Something went wrong while processing your question. Please try again."
        )