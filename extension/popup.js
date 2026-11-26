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

        // Check whether API key already exists
        const data = await chrome.storage.local.get("geminiApiKey");

        if (!geminiApiKey) {
            a.textContent = "Please connect your Gemini API key first.";
            return;
        }

        if (data.geminiApiKey) {
            showScreen("chatScreen");
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

    const q = document.createElement("div");
    q.className = "question";
    q.textContent = question;
    messages.appendChild(q);

    input.value = "";

    const a = document.createElement("div");
    a.className = "answer";
    messages.appendChild(a);

    try {
        const response = await fetch("http://127.0.0.1:8000/ask", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
            question: question,
            url: pageUrl,
            api_key: geminiApiKey
        })
        });

        const data = await response.json();

        a.textContent = response.ok
            ? data.answer || "No answer received."
            : `Error ${response.status}: ${data.detail}`;

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
showScreen("onboarding");

const menuBtn = document.getElementById("menuBtn");
const menuDropdown = document.getElementById("menuDropdown");

menuBtn.addEventListener("click", () => {
    menuDropdown.style.display =
        menuDropdown.style.display === "block" ? "none" : "block";
});

document.gdocument.getElementById("newChat").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    pageUrl = tab.url;

    messages.innerHTML = "";
    input.value = "";
    menuDropdown.style.display = "none";
});

document.getElementById("changeKey").addEventListener("click", () => {
    document.getElementById("apiKey").value = "";
    document.getElementById("apiStatus").textContent = "";

    menuDropdown.style.display = "none";
    showScreen("apiSetup");
});
