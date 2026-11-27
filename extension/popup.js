// 1. Utilities and browser operations
// getActiveTab(), getPageKey(), extractPageContent(), hasPagePermission()
//chrome tabs, webpage extraction, page permissions.

// 2. Backend communication
// verifyApiKey(), askBackend(), loadConversation(), deleteConversation()
//API requests, chat history, key verification.

// 3. UI and event handling
// showScreen(), askQuestion(), initializePopup(), event listeners
//screen navigation, asking questions, buttons, initialization.

const typingIndicator = document.getElementById("typingIndicator");
const input = document.getElementById("question");
const messages = document.getElementById("messages");
let pageUrl = "";

// ==========================================
// 1. UTILITIES & BROWSER OPERATIONS 
//These functions interact with the Chrome browser. They don't generate AI responses or communicate with FastAPI.
// ==========================================
//getActiveTab() , getPageKey() , extractPageContent() , hasPagePermission() , savePagePermission()

// Get the currently active browser tab
async function getActiveTab() {
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });
    return tab;
}

// Generate a unique key for a webpage
function getPageKey(url) {
    const page = new URL(url);
    return page.origin + page.pathname;
}

// Extract content ( title, headings, image descriptions and body text.) from the active webpage
async function extractPageContent() {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
        throw new Error("No active webpage found.");
    }

    const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
            const title = document.title || "";

            const description =
                document.querySelector('meta[name="description"]')
                ?.content || "";

            const headings = Array.from(
                document.querySelectorAll("h1, h2, h3")
            )
                .map(el => el.innerText.trim())
                .filter(Boolean);

            const imageDescriptions = Array.from(document.images)
                .map(img => img.alt?.trim())
                .filter(Boolean);

            const bodyText = document.body?.innerText || "";

            return `
Page Title: ${title}

Description: ${description}

Headings:
${headings.join("\n")}

Image Descriptions:
${imageDescriptions.join("\n")}

Page Content:
${bodyText}
            `.slice(0, 60000);
        }
    });

    return result.result || "";
}

// Check whether the user has approved a webpage
async function hasPagePermission(url) {
    const saved = await chrome.storage.local.get("approvedPages");
    const approvedPages = saved.approvedPages || [];
    const pageKey = getPageKey(url);
    return approvedPages.includes(pageKey);
}

// Save permission for a webpage
async function savePagePermission(url) {
    const saved = await chrome.storage.local.get("approvedPages");
    const approvedPages = saved.approvedPages || [];
    const pageKey = getPageKey(url);
    if (!approvedPages.includes(pageKey)) {
        approvedPages.push(pageKey);

        await chrome.storage.local.set({
            approvedPages: approvedPages
        });
    }
}


// ==========================================
// 2. BACKEND COMMUNICATION
// These functions are responsible for sending requests to your FastAPI backend and receiving responses.
// ==========================================
//verifyApiKey(), askBackend(), loadConversation(), deleteConversation()

const API_BASE_URL = "http://127.0.0.1:8000";

// Verify the user's Gemini API key-- Calls FastAPI's /verify-key.
async function verifyApiKey(apiKey) {
    const response = await fetch(`${API_BASE_URL}/verify-key`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            api_key: apiKey
        })
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.detail || "Invalid API key.");
    }
    return data;
}

// Send the user's question and webpage content to FastAPI (/ask.)
async function askBackend(question, pageContent, apiKey) {
    const response = await fetch(`${API_BASE_URL}/ask`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            question: question,
            url: pageUrl,
            api_key: apiKey,
            page_content: pageContent
        })
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(
            `Error ${response.status}: ${data.detail || "Request failed."}`
        );
    }
    return data.answer || "No answer received.";
}


// Retrieve previously saved conversation (/history.)
async function loadConversation() {
    messages.innerHTML = "";
    try {
        const response = await fetch(
            `${API_BASE_URL}/history?url=${encodeURIComponent(pageUrl)}`
        );
        if (!response.ok) return;
        const data = await response.json();
        data.messages.forEach(message => {
            const div = document.createElement("div");
            if (message.role === "user") {
                div.className = "question";
                div.textContent = message.content;
            } else {
                div.className = "answer";
                div.innerHTML = marked.parse(message.content);
            }
            messages.appendChild(div);
        });
        messages.scrollTop = messages.scrollHeight;
    } catch (error) {
        console.error("Helium: could not load chat history", error);
    }
}

// Delete the saved conversation for the current webpage through /history.
async function deleteConversation() {
    const response = await fetch(
        `${API_BASE_URL}/history?url=${encodeURIComponent(pageUrl)}`,
        { method: "DELETE" }
    );
    if (!response.ok) {
        throw new Error("Could not delete chat history.");
    }
    // return await response.json();
}

// till here we create functions, now through clicking html element , we invoke/call above created functions...

// ==========================================
// 3. UI & EVENT HANDLING
// This section handles the actual user experience:- Switching between screens, Asking questions, Displaying answers, Saving the API key, Granting webpage access, Managing chat history.
// ==========================================
//showScreen(), askQuestion(), initializePopup(), Event listeners

// 1 Switch between onboarding, API setup and chat screens
//Simple: it hides all screens and displays the requested screen.
function showScreen(screenId) {
    document.querySelectorAll(".screen").forEach(screen => {
        screen.style.display = "none";
    });
    document.getElementById(screenId).style.display = "block";
}

async function askQuestion() {
    // 2 Read the user's question. --> Retrieve the Gemini API key. --> Display the question in the chat. --> Extract webpage content. --> Call askBackend() --> Display the returned answer with the typing animation.
    const question = input.value.trim();

    if (!question) return;
    const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
    if (!geminiApiKey) {
        alert("Please connect your Gemini API key first.");
        return;
    }

    // Display the user's question
    const questionElement = document.createElement("div");
    questionElement.className = "question";
    questionElement.textContent = question;
    messages.appendChild(questionElement);

    input.value = "";

    // Create an empty container for the answer
    const answerElement = document.createElement("div");
    answerElement.className = "answer";
    messages.appendChild(answerElement);
    try {
        typingIndicator.style.display = "flex";

        // 1. Extract content from the current webpage
        const pageContent = await extractPageContent();

        // 2. Send question to FastAPI
        const answer = await askBackend(
            question,
            pageContent,
            geminiApiKey
        );
        // 3. Display answer with typing animation
        let i = 0;
        const typingSpeed = 15;

        await new Promise(resolve => {
            function typeAnswer() {
                if (i < answer.length) {
                    answerElement.innerHTML = marked.parse(
                        answer.substring(0, i + 1)
                    );

                    i++;

                    answerElement.scrollIntoView({
                        behavior: "auto",
                        block: "end"
                    });

                    setTimeout(typeAnswer, typingSpeed);
                } else {
                    resolve();
                }
            }
            typeAnswer();
        });

    } catch (error) {
        answerElement.textContent = error.message;

    } finally {
        typingIndicator.style.display = "none";
    }
}

async function initializePopup() {
    //3 This function decides which screen should appear when the user opens Helium.
    const tab = await getActiveTab();
    if (!tab || !tab.url) {
        showScreen("onboarding");
        return;
    }
    pageUrl = tab.url;
    const approved = await hasPagePermission(pageUrl);
    const { geminiApiKey } =
        await chrome.storage.local.get("geminiApiKey");
    if (!approved) { //No approved page → onboarding.
        showScreen("onboarding");
    } else if (!geminiApiKey) { // Approved page, no API key → API setup.
        showScreen("apiSetup");
    } else { // Approved page and API key → chat screen.
        showScreen("chatScreen");
        loadConversation();
    }
}

//3.4 Event listeners---- Now we connect our HTML elements to the functions we've written.

//A. Grant page access
document.getElementById("grantAccess").addEventListener("click", async () => {
    const status = document.getElementById("status");
    try {
        const tab = await getActiveTab();
        if (!tab || !tab.id || !tab.url) {
            throw new Error("No active webpage found");
        }
        pageUrl = tab.url;
        await savePagePermission(pageUrl);
        const { geminiApiKey } =
            await chrome.storage.local.get("geminiApiKey");
        if (geminiApiKey) {
            showScreen("chatScreen");
            loadConversation();
        } else {
            showScreen("apiSetup");
        }
    } catch (error) {
        status.textContent = error.message;
        console.error("Helium access error:", error);
    }
});
//  B. Save Gemini API key
document.getElementById("saveKey").addEventListener("click", async () => {
    const apiKey = document.getElementById("apiKey").value.trim();
    const status = document.getElementById("apiStatus");
    const button = document.getElementById("saveKey");
    if (!apiKey) {
        status.textContent = "Please enter your Gemini API key.";
        return;
    }
    button.disabled = true;
    status.textContent = "Verifying API key...";
    try {
        await verifyApiKey(apiKey);
        // Save key only after successful verification
        await chrome.storage.local.set({
            geminiApiKey: apiKey
        });
        showScreen("chatScreen");
        await loadConversation();
    } catch (error) {
        status.textContent = error.message;
    } finally {
        button.disabled = false;
    }
});
//C. Send question-- Both the button click and Enter key invoke the same function. No duplicated question-handling logic.
document.getElementById("askBtn")
    .addEventListener("click", askQuestion);
input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        askQuestion();
    }
});
//D. Menu actions
const menuBtn = document.getElementById("menuBtn");
const menuDropdown = document.getElementById("menuDropdown");

menuBtn.addEventListener("click", () => {
    menuDropdown.style.display =
        menuDropdown.style.display === "block" ? "none" : "block";
});

// New Chat
document.getElementById("newChat").addEventListener("click", async () => {
    const tab = await getActiveTab();
    if (tab && tab.url) {
        pageUrl = tab.url;
    }
    try {
        await deleteConversation();
    } catch (error) {
        console.error("Helium: could not clear chat", error);
    }
    messages.innerHTML = "";
    input.value = "";
    menuDropdown.style.display = "none";
});

// Open delete confirmation
const deleteConfirm = document.getElementById("deleteConfirm");
document.getElementById("deleteChat").addEventListener("click", () => {
    deleteConfirm.style.display = "flex";
    menuDropdown.style.display = "none";
});

// Cancel deletion
document.getElementById("cancelDelete").addEventListener("click", () => {
    deleteConfirm.style.display = "none";
});

// Confirm deletion
document.getElementById("confirmDelete").addEventListener("click", async () => {
    const button = document.getElementById("confirmDelete");
    button.disabled = true;
    try {
        await deleteConversation();
        messages.innerHTML = "";
        input.value = "";
        deleteConfirm.style.display = "none";
    } catch (error) {
        console.error("Helium: could not delete chat history", error);
    } finally {
        button.disabled = false;
    }
});

// Change API key
document.getElementById("changeKey").addEventListener("click", () => {
    document.getElementById("apiKey").value = "";
    document.getElementById("apiStatus").textContent = "";

    menuDropdown.style.display = "none";
    showScreen("apiSetup");
});

//E. Start the extension
initializePopup();
