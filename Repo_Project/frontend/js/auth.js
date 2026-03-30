const API_URL = "http://localhost:8001/api";

document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById("login-form");
    const signupForm = document.getElementById("signup-form");
    const showSignupBtn = document.getElementById("show-signup");
    const showLoginBtn = document.getElementById("show-login");
    const alertBox = document.getElementById("alert-box");

    // Check if already logged in
    if(localStorage.getItem("isLoggedIn") === "true" || localStorage.getItem("token")) {
        window.location.replace("dashboard.html");
    }

    function showAlert(msg, isError=true) {
        alertBox.textContent = msg;
        alertBox.className = "alert " + (isError ? "error" : "success");
        setTimeout(() => alertBox.style.display = 'none', 5000);
    }

    showSignupBtn.addEventListener("click", (e) => {
        e.preventDefault();
        loginForm.classList.add("hidden");
        signupForm.classList.remove("hidden");
    });

    showLoginBtn.addEventListener("click", (e) => {
        e.preventDefault();
        signupForm.classList.add("hidden");
        loginForm.classList.remove("hidden");
    });

    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = document.getElementById("login-username").value;
        const password = document.getElementById("login-password").value;

        try {
            const formData = new URLSearchParams();
            formData.append('username', username);
            formData.append('password', password);

            const res = await fetch(`${API_URL}/login`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: formData
            });
            const data = await res.json();

            if (!res.ok) throw new Error(data.detail || "Login failed");

            localStorage.setItem("token", data.access_token);
            localStorage.setItem("isLoggedIn", "true");
            window.location.replace("dashboard.html");

        } catch(err) {
            if (err.message === "Failed to fetch") {
                showAlert("Cannot connect to server. Is the backend running on localhost:8000?", true);
            } else {
                showAlert(err.message, true);
            }
        }
    });

    signupForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = document.getElementById("signup-username").value;
        const password = document.getElementById("signup-password").value;

        try {
            const res = await fetch(`${API_URL}/signup`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({username, password})
            });
            const data = await res.json();

            if (!res.ok) throw new Error(data.detail || "Signup failed");

            showAlert("Account created successfully. Please login.", false);
            signupForm.classList.add("hidden");
            loginForm.classList.remove("hidden");

        } catch(err) {
            showAlert(err.message, true);
        }
    });
});
