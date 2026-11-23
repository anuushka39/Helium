
const input = document.getElementById("question");
const messages = document.getElementById("messages");

function askQuestion() {
    const question = input.value.trim();
    if (!question) return;

    const message = document.createElement("div");
    message.className = "message";

    const q = document.createElement("div");
    q.className = "question";
    q.textContent = question;

    const a = document.createElement("div");
    a.className = "answer";

    message.append(q, a);
    messages.appendChild(message);

    input.value = "";

    const answer = "This is a sample Edgon response. Your question was received successfully.";

    let i = 0;

    function typeAnswer() {
        if (i < answer.length) {
            a.textContent += answer[i];
            i++;
            messages.scrollTop = messages.scrollHeight;
            setTimeout(typeAnswer, 20);
        }
    }

    typeAnswer();
}

document.getElementById("askBtn").addEventListener("click", askQuestion);

input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        askQuestion();
    }
});
