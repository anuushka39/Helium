const input = document.getElementById("question");
const messages = document.getElementById("messages");

let pageUrl = "";

// Switch between screens
function showScreen(screenId) {
    document.querySelectorAll(".screen").forEach(screen => {
        screen.style.display = "none";
    });

    document.getElementById(screenId).style.display = "block";
}


async function extractPageContent() {
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

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

async function hasPagePermission(url) {
    const saved = await chrome.storage.local.get("approvedPages");
    const approvedPages = saved.approvedPages || [];

    const page = new URL(url);
    const pageKey = page.origin + page.pathname;

    if (approvedPages.includes(pageKey)) {
        return true;
    }

    return false;
}

// Restore the saved chat for the current page (stored in Redis by the backend)
async function loadConversation() {
    messages.innerHTML = "";
    try {
        const response = await fetch(
            "http://127.0.0.1:8000/history?url=" + encodeURIComponent(pageUrl)
        );
        if (!response.ok) return;
        const data = await response.json();

        data.messages.forEach(m => {
            const div = document.createElement("div");
            if (m.role === "user") {
                div.className = "question";
                div.textContent = m.content;
            } else {
                div.className = "answer";
                div.innerHTML = marked.parse(m.content);
            }
            messages.appendChild(div);
        });
        messages.scrollTop = messages.scrollHeight;
    } catch (error) {
        console.error("Helium: could not load chat history", error);
    }
}


// STEP 1: Check page access
document.getElementById("grantAccess").addEventListener("click", async () => {
    const status = document.getElementById("status");

    try {
        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true
        });

        if (!tab || !tab.id || !tab.url) {
            throw new Error("No active webpage found");
        }

        pageUrl = tab.url;

        const approved = await hasPagePermission(pageUrl);

        if (!approved) {
            const saved = await chrome.storage.local.get("approvedPages");
            const approvedPages = saved.approvedPages || [];

            const page = new URL(pageUrl);
            const pageKey = page.origin + page.pathname;

            approvedPages.push(pageKey);

            await chrome.storage.local.set({ approvedPages });
        }

        const data = await chrome.storage.local.get("geminiApiKey");

        if (data.geminiApiKey) {
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

// STEP 2: Save Gemini API key
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
        const response = await fetch("http://127.0.0.1:8000/verify-key", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ api_key: apiKey })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.detail || "Invalid API key.");
        }

        // Save only after successful verification
        await chrome.storage.local.set({
            geminiApiKey: apiKey
        });

        showScreen("chatScreen");
        loadConversation();

    } catch (error) {
        status.textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

// STEP 3: Ask questions
async function askQuestion() {
    const question = input.value.trim();

    if (!question) return;

    const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
    if (!geminiApiKey) {
        alert("Please connect your Gemini API key first.");
        return;
    }
    const q = document.createElement("div");
    q.className = "question";
    q.textContent = question;
    messages.appendChild(q);

    input.value = "";

    const a = document.createElement("div");
    a.className = "answer";
    messages.appendChild(a);

    try {
        const pageContent = await extractPageContent();
        const response = await fetch("http://127.0.0.1:8000/ask", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
            question: question,
            url: pageUrl,
            api_key: geminiApiKey,
            page_content: pageContent 
        })
        });

        const data = await response.json();
        if (response.ok) {
            a.innerHTML = marked.parse(
                data.answer || "No answer received."
            );
        } else {
            a.textContent = `Error ${response.status}: ${data.detail}`;
        }
    } catch (error) {
        a.textContent = "Connection error: " + error.message;
    }

    messages.scrollTop = messages.scrollHeight;
}


document.getElementById("askBtn").addEventListener("click", askQuestion);

input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        askQuestion();
    }
});


// Initial screen
// Initial screen
async function initializePopup() {
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    if (!tab || !tab.url) {
        showScreen("onboarding");
        return;
    }

    pageUrl = tab.url;

    const approved = await hasPagePermission(pageUrl);
    const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");

    if (!approved) {
        showScreen("onboarding");
    } 
    else if (!geminiApiKey) {
        showScreen("apiSetup");
    } 
    else {
        showScreen("chatScreen");
        loadConversation();
    }
}

initializePopup();

const menuBtn = document.getElementById("menuBtn");
const menuDropdown = document.getElementById("menuDropdown");

menuBtn.addEventListener("click", () => {
    menuDropdown.style.display =
        menuDropdown.style.display === "block" ? "none" : "block";
});

document.getElementById("newChat").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    if (tab && tab.url) {
        pageUrl = tab.url;
    }

    // Forget the saved conversation for this page
    try {
        await fetch(
            "http://127.0.0.1:8000/history?url=" + encodeURIComponent(pageUrl),
            { method: "DELETE" }
        );
    } catch (error) {
        console.error("Helium: could not clear chat", error);
    }

    messages.innerHTML = "";
    input.value = "";
    menuDropdown.style.display = "none";
});

const deleteConfirm = document.getElementById("deleteConfirm");

document.getElementById("deleteChat").addEventListener("click", () => {
    deleteConfirm.style.display = "flex";
    menuDropdown.style.display = "none";
});

document.getElementById("cancelDelete").addEventListener("click", () => {
    deleteConfirm.style.display = "none";
});

document.getElementById("confirmDelete").addEventListener("click", async () => {
    const button = document.getElementById("confirmDelete");
    button.disabled = true;

    try {
        const response = await fetch(
            "http://127.0.0.1:8000/history?url=" + encodeURIComponent(pageUrl),
            { method: "DELETE" }
        );

        if (!response.ok) {
            throw new Error("Could not delete chat history.");
        }

        messages.innerHTML = "";
        input.value = "";
        deleteConfirm.style.display = "none";

    } catch (error) {
        console.error("Helium: could not delete chat history", error);
    } finally {
        button.disabled = false;
    }
});

document.getElementById("changeKey").addEventListener("click", () => {
    document.getElementById("apiKey").value = "";
    document.getElementById("apiStatus").textContent = "";

    menuDropdown.style.display = "none";
    showScreen("apiSetup");
});