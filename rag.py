import os
import time
os.environ.setdefault("USER_AGENT", "Helium/1.0")  # must be set before WebBaseLoader is used
from dotenv import load_dotenv
from langchain_chroma import Chroma
from langchain_community.document_loaders import WebBaseLoader
from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
load_dotenv()

# 1 load ---------------------------------------------------------------- 
def keep_article_only(text):
    lines = text.split("\n")
    starts = [i for i, line in enumerate(lines) if line.startswith("Last Updated")]
    ends = [i for i, line in enumerate(lines) if line.strip() == "Comment"]
    if not starts or not ends or ends[-1] <= starts[0]:
        print("  Warning: could not find the article boundaries, keeping the full page.")
        return text
    start = max(starts[0] - 1, 0)  # the line above 'Last Updated' is the page title
    return "\n".join(lines[start:ends[-1]])

def load_pages(urls):
    # separator="\n" keeps line breaks, so the splitter can cut at line boundaries
    # instead of in the middle of sentences.
    loader = WebBaseLoader(urls, bs_get_text_kwargs={"separator": "\n", "strip": True})
    docs = loader.load()
    for doc in docs:
        doc.page_content = keep_article_only(doc.page_content)
        print(f"Loaded {doc.metadata.get('source')} -> {len(doc.page_content)} characters")
    return docs

# 2) SPLIT---------------------------------------------------------
def split_pages(docs):
    splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=150)
    chunks = splitter.split_documents(docs)
    if not chunks:
        raise ValueError("No content extracted from the webpages!")
    print("Total chunks:", len(chunks))
    return chunks

# 3) EMBED + 4) STORE---------------------------------------- 
def build_retriever(chunks, api_key=None):
    # No task_type here on purpose: the library then uses RETRIEVAL_DOCUMENT for
    # chunks and RETRIEVAL_QUERY for questions. Setting task_type forces ONE
    # type for both, which hurts matching.
    embeddings = GoogleGenerativeAIEmbeddings(model="gemini-embedding-001", google_api_key=api_key)
    vectorstore = Chroma.from_documents(chunks, embeddings)  # in-memory, fresh each run
    # Plain similarity search: return the 4 chunks closest to the question.
    return vectorstore.as_retriever(search_kwargs={"k": 4})

# 5) AUGMENT + GENERATE -------------------------------------
PROMPT = ChatPromptTemplate.from_template(
    """You are Helium, an AI web assistant.
Answer the question using only the context below.
Give a clear, complete answer in a few short paragraphs or bullet points.
If the context only covers part of the question, answer that part and say what is missing.
Say "I don't know" only if the context has nothing relevant.

Context:
{context}

Conversation so far (only to understand follow-up questions; the facts must come from the context):
{history}

Question:
{question}"""
)

MODEL_NAME = "gemini-3.5-flash-lite"  # if it stays busy, try "gemini-3.6-flash"

def build_llm(api_key=None):
    return ChatGoogleGenerativeAI(
        model=MODEL_NAME,
        google_api_key=api_key,
        max_output_tokens=8192,
        timeout=60,      # give up after 60s instead of hanging forever
        max_retries=1,   # our own retry loop in ask() handles the rest
    )

def ask(question, retriever, llm, history="(none)", search_query=None):
    # Retrieval uses the standalone version of the question (if there is one);
    # the prompt below still gets the original question and the chat history.
    docs = retriever.invoke(search_query or question)
    print("\n--- RETRIEVED CONTEXT ---")
    for i, doc in enumerate(docs, 1):
        preview = doc.page_content[:200].replace("\n", " ")
        print(f"Chunk {i} [{doc.metadata.get('source')}]: {preview}...")
    context = "\n\n---\n\n".join(
        f"[Source: {doc.metadata.get('source')}]\n{doc.page_content}" for doc in docs
    )

    print("\n--- CALLING MODEL ---")
    response = None
    for attempt in range(1, 4):  # Google sometimes returns 503 when busy: wait and retry
        try:
            response = (PROMPT | llm).invoke({"context": context, "question": question, "history": history})
            break
        except Exception as e:
            print(f"Attempt {attempt} failed: {type(e).__name__}: {str(e)[:150]}")
            if attempt < 3:
                time.sleep(5 * attempt)
    if response is None:
        return "Model call failed 3 times. Try again later or switch MODEL_NAME."

    # Debug info: remove once answers look right.
    print("finish_reason:", response.response_metadata.get("finish_reason"))
    print("usage:", response.usage_metadata)

    if response.response_metadata.get("finish_reason") == "MAX_TOKENS":
        print("Warning: the answer was cut off. Raise max_output_tokens.")
    if not response.text.strip():
        print("Empty text. Raw content was:", repr(response.content)[:500])

    print("\n--- ANSWER ---")
    return response.text

def extract_answer(response):
    content = response.content

    if isinstance(content, list):
        return "\n".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict)
        )
    return content

def rewrite_question(question, history, llm):
    """Turn a follow-up like "why?" into a standalone question, so retrieval finds the right chunks."""
    if history == "(none)":  # first question in this chat: nothing to rewrite
        return question
    prompt = f"""Rewrite the user's last question as ONE standalone question that makes sense
without the conversation. Replace words like "it", "that", "the second one" with what they refer to.
If it is already standalone, return it unchanged. Return only the question, nothing else.

Conversation so far:
{history}

Last question: {question}"""
    try:
        rewritten = extract_answer(llm.invoke(prompt)).strip()
    except Exception as e:  # if the rewrite fails, just search with the original question
        print("Rewrite failed, using original question:", e)
        return question
    print("Search query:", rewritten or question)
    return rewritten or question

def final_answer(question, context, rag_answer, llm, history="(none)"):
    evaluation_prompt = f"""
    Evaluate whether the given answer sufficiently answers the user's question.
    Conversation so far:
    {history}
    User Question: {question}
    Retrieved Context: {context}
    RAG Answer: {rag_answer}
    If the answer is relevant, complete, and adequately supported by
    the retrieved context, return exactly: SUFFICIENT
    IMPORTANT:
    If the RAG answer says that the context does not contain enough
    information, says "I don't know", or fails to provide the actual
    information requested, classify it as INSUFFICIENT.

    An answer explaining that information is missing is NOT a
    sufficient answer.

    Evaluate whether the user's actual question has been answered,
    not whether the RAG answer correctly describes the retrieved context.
    """
    response = llm.invoke(evaluation_prompt)
    evaluation = response.content

    if isinstance(evaluation, list):
        evaluation = " ".join(
            item["text"] if isinstance(item, dict) else str(item)
            for item in evaluation
        )

    evaluation = evaluation.strip()
    if evaluation.upper() == "SUFFICIENT":
        return rag_answer
    general_prompt = f"""
    Answer the following question accurately and comprehensively
    using your own knowledge.
    Conversation so far (use it to understand follow-up questions):
    {history}
    User Question: {question}
    The webpage context was insufficient, so you may use your
    general knowledge. Do not invent facts.
    """
    response = llm.invoke(general_prompt)
    return extract_answer(response)

#just rag things
def answer_from_page(url, question, api_key, history="(none)", page_content=""):
    if page_content.strip():
        docs = [
            Document(
                page_content=page_content,
                metadata={"source": url}
            )
        ]
    else:
        docs = load_pages([url])
    chunks = split_pages(docs)
    retriever = build_retriever(chunks, api_key)
    llm = build_llm(api_key)
    search_query = rewrite_question(question, history, llm)
    rag_answer = ask(question, retriever, llm, history, search_query)
    context = "\n\n".join(doc.page_content for doc in chunks)
    return final_answer(question, context, rag_answer, llm, history)
