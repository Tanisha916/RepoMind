const API_URL = "http://localhost:8001/api";
let currentAnalysis = null;
/** Matches server REPO_CACHE key: GitHub URL or `upload_<filename>`. */
let analysisCacheKey = null;
let lastUploadFilename = null;
let token = localStorage.getItem("token");

const BREAKDOWN_LIST_CHUNK = 60;
const BREAKDOWN_MAX_FILES_DISPLAY = 2000;

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

document.addEventListener("DOMContentLoaded", () => {
    if (!token || localStorage.getItem("isLoggedIn") !== "true") {
        window.location.replace("index.html");
        return;
    }

    const savedData = sessionStorage.getItem("repoAnalysisData");
    if (savedData) {
        try {
            const parsed = JSON.parse(savedData);
            currentAnalysis = parsed.currentAnalysis;
            analysisCacheKey = parsed.analysisCacheKey;
            lastUploadFilename = parsed.lastUploadFilename;
            
            // Rebuild tree & stats silently
            displayResults(currentAnalysis);
            // Hide the active analysis results to show the upload form by default
            document.getElementById("analysis-results").classList.add("hidden");
            document.getElementById("input-section").style.display = "grid";
        } catch(e) {}
    }

    // Decode JWT payload for username
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        document.getElementById("user-display").textContent = payload.sub || "User";
    } catch (e) {
        document.getElementById("user-display").textContent = "User";
    }

    // Setup Logout
    document.getElementById("logout-btn").addEventListener("click", () => {
        localStorage.removeItem("token");
        localStorage.removeItem("isLoggedIn");
        sessionStorage.removeItem("repoAnalysisData");
        window.location.replace("index.html");
    });

    // Setup Modules
    fetchModules();

    document.getElementById("btn-analyze-url").addEventListener("click", analyzeUrl);
    document.getElementById("btn-upload").addEventListener("click", analyzeUpload);
    document.getElementById("btn-explain-repo").addEventListener("click", explainRepo);
    document.getElementById("btn-generate-docs").addEventListener("click", downloadDocs);

    const btnRefreshBreakdown = document.getElementById("btn-refresh-breakdown");
    if (btnRefreshBreakdown) {
        btnRefreshBreakdown.addEventListener("click", () => loadBreakdownPreview(true));
    }

    const btnGenerateGraph = document.getElementById("btn-generate-graph");
    if (btnGenerateGraph) {
        btnGenerateGraph.addEventListener("click", generateDependencyGraph);
    }

    document.body.addEventListener("input", (e) => {
        if (e.target && e.target.id === "breakdown-search") {
            breakdownListFilter = e.target.value;
            renderBreakdownFileList(breakdownListFilter);
        }
        if (e.target && e.target.id === "viewcode-search") {
            viewcodeListFilter = e.target.value;
            renderViewCodeList();
        }
    });
});

function showAlert(msg, isError = true) {
    const box = document.getElementById("alert-box");
    box.textContent = msg;
    box.className = "alert " + (isError ? "error" : "success");
    box.style.display = "block";
    setTimeout(() => box.style.display = 'none', 5000);
}

function showLoading(show, message = "Analyzing repository...") {
    document.getElementById("loading-text").textContent = message;
    const overlay = document.getElementById("loading-overlay");
    const results = document.getElementById("analysis-results");
    const inputSection = document.getElementById("input-section");

    if (show) {
        overlay.classList.remove("hidden");
        overlay.setAttribute("aria-busy", "true");
        results.classList.add("hidden");
        inputSection.style.display = "none";
    } else {
        overlay.classList.add("hidden");
        overlay.removeAttribute("aria-busy");
        results.classList.remove("hidden");
        // We keep input hidden after analysis unless they reset
    }
}

async function fetchModules() {
    try {
        const res = await fetch(`${API_URL}/modules`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();
        renderModules(data.modules);
    } catch (err) {
        console.error("Failed to load modules");
    }
}

function renderModules(modules) {
    const list = document.getElementById("modules-list");
    list.innerHTML = "";
    modules.forEach(m => {
        const li = document.createElement("li");
        li.className = `module-item ${m.locked ? 'locked' : ''} ${m.id === 1 ? 'active' : ''}`;
        li.dataset.id = m.id;

        const iconMap = {
            1: "fa-wand-magic-sparkles",
            2: "fa-comments",
            3: "fa-chart-pie",
            4: "fa-file-lines",
            5: "fa-diagram-project",
            6: "fa-code"
        };

        li.innerHTML = `
            <span><i class="fa-solid ${iconMap[m.id]}"></i> <span style="margin-left:8px;">${m.name}</span></span>
            ${m.locked ? '<i class="fa-solid fa-lock"></i>' : ''}
        `;

        if (!m.locked) {
            li.addEventListener("click", () => switchModule(m.id, m.name));
        }

        list.appendChild(li);
    });
}

function switchModule(id, name) {
    if (!currentAnalysis && id === 2) {
        showAlert("Please scan a repository first before using the Q&A Chatbox.");
        return;
    }

    document.getElementById("current-module-title").textContent = name;

    // Update active class
    document.querySelectorAll(".module-item").forEach(el => {
        if (parseInt(el.dataset.id) === id) {
            el.classList.add("active");
        } else {
            el.classList.remove("active");
        }
    });

    // Toggle views
    const views = ["module-1-view", "module-2-view", "module-3-view", "module-4-view", "module-5-view", "module-6-view"];
    views.forEach(v => {
        const el = document.getElementById(v);
        if (el) el.classList.add("hidden");
    });

    const activeView = document.getElementById(`module-${id}-view`);
    if (activeView) activeView.classList.remove("hidden");

    if (currentAnalysis) {
        document.getElementById("analysis-results").classList.remove("hidden");
        document.getElementById("input-section").style.display = "none";
    }

    if (id === 3 && currentAnalysis) {
        loadBreakdownPreview(false);
    } else if (id === 6) {
        if (typeof loadFiles === 'function') {
            loadFiles();
        }
    }
}

async function analyzeUrl() {
    const url = document.getElementById("repo-url").value;
    if (!url) return showAlert("Please enter a GitHub URL");

    showLoading(true);
    try {
        const res = await fetch(`${API_URL}/analyze/url`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ url })
        });

        if (!res.ok) {
            const errList = await res.json();
            throw new Error(errList.detail || "Analysis failed");
        }

        const data = await res.json();
        currentAnalysis = data;
        analysisCacheKey = url.trim();
        sessionStorage.setItem("repoAnalysisData", JSON.stringify({ currentAnalysis, analysisCacheKey, lastUploadFilename }));
        resetBreakdownState();
        displayResults(data);
    } catch (err) {
        showLoading(false);
        showAlert(err.message);
        document.getElementById("input-section").style.display = "grid";
    }
}

async function analyzeUpload() {
    const fileInput = document.getElementById("file-upload");
    if (!fileInput.files.length) return showAlert("Please select a .zip file");

    const formData = new FormData();
    formData.append("file", fileInput.files[0]);

    showLoading(true);
    try {
        const res = await fetch(`${API_URL}/analyze/upload`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`
            },
            body: formData
        });

        if (!res.ok) {
            const errList = await res.json();
            throw new Error(errList.detail || "Upload failed");
        }

        const data = await res.json();
        currentAnalysis = data;
        lastUploadFilename = fileInput.files[0].name;
        analysisCacheKey = `upload_${lastUploadFilename}`;
        sessionStorage.setItem("repoAnalysisData", JSON.stringify({ currentAnalysis, analysisCacheKey, lastUploadFilename }));
        resetBreakdownState();
        displayResults(data);
    } catch (err) {
        showLoading(false);
        showAlert(err.message);
        document.getElementById("input-section").style.display = "grid";
    }
}

function resetBreakdownState() {
    breakdownFilesData = [];
    breakdownListFilter = "";
    const search = document.getElementById("breakdown-search");
    if (search) search.value = "";
}

function displayResults(data) {
    showLoading(false);

    // Reset graph render status
    isGraphRendered = false;

    // Animate stats counting (simple implementation for UI)
    document.getElementById("stat-files").textContent = data.total_files || 0;
    document.getElementById("stat-loc").textContent = data.total_lines || 0;

    let topLang = "-";
    let max = 0;
    for (let [l, count] of Object.entries(data.languages)) {
        if (count > max && l !== "Other") {
            topLang = l;
            max = count;
        }
    }
    document.getElementById("stat-lang").textContent = topLang;

    // Render File Tree
    const treeContainer = document.getElementById("file-tree");
    treeContainer.innerHTML = "";

    function buildTreeHTML(node, container) {
        if (node.type === "file") {
            const item = document.createElement("div");
            item.className = "tree-item";
            item.innerHTML = `<i class="fa-regular fa-file-code"></i> <span>${node.name}</span> <span style="margin-left:auto; color:var(--text-muted); font-size:0.75rem;">${node.lines} lines</span>`;
            item.onclick = (e) => {
                e.stopPropagation();
                explainFile(node);
            };
            container.appendChild(item);
        } else if (node.type === "directory") {
            const wrap = document.createElement("div");

            const item = document.createElement("div");
            item.className = "tree-item";
            item.innerHTML = `<i class="fa-regular fa-folder"></i> <span style="font-weight:500;">${node.name}</span>`;
            wrap.appendChild(item);

            const childrenContainer = document.createElement("div");
            childrenContainer.className = "tree-children hidden";
            wrap.appendChild(childrenContainer);

            item.onclick = (e) => {
                e.stopPropagation();
                const icon = item.querySelector("i");
                if (childrenContainer.classList.contains("hidden")) {
                    childrenContainer.classList.remove("hidden");
                    icon.classList.remove("fa-folder");
                    icon.classList.add("fa-folder-open");
                } else {
                    childrenContainer.classList.add("hidden");
                    icon.classList.add("fa-folder");
                    icon.classList.remove("fa-folder-open");
                }
            };

            node.children.forEach(child => buildTreeHTML(child, childrenContainer));
            container.appendChild(wrap);

            // Expand root node by default
            if (node === data.file_tree) {
                childrenContainer.classList.remove("hidden");
                item.querySelector("i").classList.remove("fa-folder");
                item.querySelector("i").classList.add("fa-folder-open");
            }
        }
    }

    buildTreeHTML(data.file_tree, treeContainer);

    const active = document.querySelector(".module-item.active");
    if (active && parseInt(active.dataset.id, 10) === 3) {
        loadBreakdownPreview(false);
    }
}

async function explainFile(fileNode) {
    if (!fileNode.content) {
        showAlert("Cannot analyze this file (content too large or binary)");
        return;
    }

    const panel = document.getElementById("explanation-content");
    panel.innerHTML = `<div style="text-align:center; padding: 2rem;"><div class="spinner"></div><p style="color:var(--text-muted)">Generating explanation using Phi-3...</p></div>`;

    try {
        const res = await fetch(`${API_URL}/explain`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
                file_path: fileNode.path,
                content: fileNode.content
            })
        });

        if (!res.ok) throw new Error("Explanation failed");

        const data = await res.json();
        // Use marked.js to render markdown safely
        panel.innerHTML = marked.parse(data.explanation);

    } catch (err) {
        panel.innerHTML = `<div class="alert error" style="display:block;">${err.message}</div>`;
    }
}

async function explainRepo() {
    if (!currentAnalysis) return;

    const panel = document.getElementById("explanation-content");
    panel.innerHTML = `<div style="text-align:center; padding: 2rem;"><div class="spinner"></div><p style="color:var(--text-muted)">Generating project overview using Phi-3...</p></div>`;

    // Extract project name
    let repoName = "Unknown Project";
    const urlInput = document.getElementById("repo-url") && document.getElementById("repo-url").value.trim();
    if (urlInput) {
        const parts = urlInput.split('/').filter(Boolean);
        repoName = parts[parts.length - 1] || "Unknown Project";
        if (repoName.endsWith(".git")) repoName = repoName.replace(".git", "");
    } else if (typeof lastUploadFilename !== "undefined" && lastUploadFilename) {
        repoName = lastUploadFilename.replace(/\.zip$/i, "");
    }

    try {
        const payload = {
            project_name: repoName,
            total_files: currentAnalysis.total_files,
            total_lines: currentAnalysis.total_lines,
            languages: currentAnalysis.languages,
            file_tree: currentAnalysis.file_tree
        };

        const res = await fetch(`${API_URL}/explain`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ repo_summary: payload })
        });

        if (!res.ok) throw new Error("Explanation failed");

        const data = await res.json();
        panel.innerHTML = marked.parse(data.explanation);

    } catch (err) {
        panel.innerHTML = `<div class="alert error" style="display:block;">${err.message}</div>`;
    }
}

// Module 2: Chat Logic
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("btn-send-chat").addEventListener("click", sendChatMessage);
    document.getElementById("chat-input").addEventListener("keypress", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }
    });
});

async function sendChatMessage() {
    if (!currentAnalysis) {
        showAlert("Please analyze a repository first.");
        return;
    }

    const input = document.getElementById("chat-input");
    const question = input.value.trim();
    if (!question) return;

    input.value = "";

    // Append user message
    const history = document.getElementById("chat-history");
    const userMsg = document.createElement("div");
    userMsg.className = "chat-message user";
    userMsg.innerHTML = `<p>${question}</p>`;
    history.appendChild(userMsg);
    history.scrollTop = history.scrollHeight;

    // Append AI loading bubble
    const aiLoading = document.createElement("div");
    aiLoading.className = "chat-message ai";
    aiLoading.innerHTML = `<div class="spinner" style="width:20px;height:20px;margin:0;border-width:2px;"></div>`;
    history.appendChild(aiLoading);
    history.scrollTop = history.scrollHeight;

    try {
        const payload = {
            total_files: currentAnalysis.total_files,
            total_lines: currentAnalysis.total_lines,
            languages: currentAnalysis.languages
        };

        const res = await fetch(`${API_URL}/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
                question: question,
                context: payload
            })
        });

        if (!res.ok) throw new Error("Chat request failed");

        const data = await res.json();
        aiLoading.innerHTML = `<div class="markdown-body">${marked.parse(data.answer)}</div>`;

    } catch (err) {
        aiLoading.innerHTML = `<p style="color:red"><i class="fa-solid fa-circle-exclamation"></i> ${err.message}</p>`;
    }
    history.scrollTop = history.scrollHeight;
}

// Replaced Dependency Graph Rendering logic

let breakdownFilesData = [];
let breakdownListFilter = "";
let breakdownLoadInProgress = false;

/** File Breakdown: uses already-scanned repo_data via /api/breakdown/preview (no second clone). */
async function loadBreakdownPreview(forceRefresh = false) {
    const fileListContainer = document.getElementById("breakdown-file-list");
    if (!fileListContainer) return;

    if (!currentAnalysis) {
        fileListContainer.innerHTML = `
            <div style="padding: 2rem; text-align: center; color: var(--text-muted);">
                Scan a repository first, then open File Breakdown to load the list.
            </div>`;
        return;
    }

    if (!analysisCacheKey) {
        const urlInput = document.getElementById("repo-url") && document.getElementById("repo-url").value.trim();
        if (urlInput) analysisCacheKey = urlInput;
        else if (lastUploadFilename) analysisCacheKey = `upload_${lastUploadFilename}`;
    }
    if (!analysisCacheKey) {
        showAlert("Could not resolve analysis session. Please scan the repository again.");
        return;
    }

    if (!forceRefresh && breakdownFilesData.length > 0) {
        renderBreakdownFileList(breakdownListFilter);
        return;
    }

    if (breakdownLoadInProgress) return;
    breakdownLoadInProgress = true;

    fileListContainer.innerHTML = `
        <div id="breakdown-loading" style="text-align:center; padding: 2rem;" aria-live="polite">
            <div class="spinner"></div>
            <p style="color:var(--text-muted); margin-top:1rem;">Building file breakdown from cached scan (no re-clone)…</p>
        </div>
    `;

    try {
        const res = await fetch(`${API_URL}/breakdown/preview`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
                repo_data: currentAnalysis,
                cache_key: analysisCacheKey
            })
        });

        if (!res.ok) {
            const errList = await res.json();
            throw new Error(errList.detail || "Breakdown preview failed");
        }

        const data = await res.json();
        breakdownFilesData = data.files || [];
        renderBreakdownFileList(breakdownListFilter);
    } catch (err) {
        showAlert(err.message);
        fileListContainer.innerHTML = `
            <div style="padding: 2rem; text-align: center; color: red;">Error: ${err.message}</div>
            <div style="padding: 2rem; text-align: center;">
                <button type="button" class="btn btn-primary" id="btn-breakdown-retry">Retry</button>
            </div>
        `;
        const retry = document.getElementById("btn-breakdown-retry");
        if (retry) retry.addEventListener("click", () => loadBreakdownPreview(true));
    } finally {
        breakdownLoadInProgress = false;
    }
}

function runBreakdown() {
    loadBreakdownPreview(true);
}

function filterFilesForBreakdownList(searchQuery) {
    const query = (searchQuery || "").toLowerCase();
    const nonCodeExts = ["png", "jpg", "jpeg", "gif", "mp4", "mp3", "pdf", "zip", "tar", "gz", "ttf", "woff", "woff2", "eot", "ico"];
    return breakdownFilesData.filter(f => {
        const ext = f.name.split(".").pop().toLowerCase();
        if (nonCodeExts.includes(ext) || f.type === "unknown") return false;
        return f.name.toLowerCase().includes(query) || f.path.toLowerCase().includes(query);
    });
}

function renderBreakdownFileList(searchQuery) {
    const fileListContainer = document.getElementById("breakdown-file-list");
    if (!fileListContainer) return;

    const filteredFiles = filterFilesForBreakdownList(searchQuery);
    const total = filteredFiles.length;
    const displayFiles = filteredFiles.slice(0, BREAKDOWN_MAX_FILES_DISPLAY);

    fileListContainer.innerHTML = "";
    const hint = document.createElement("div");
    hint.id = "breakdown-list-hint";
    hint.style.cssText = "padding:0.35rem 0.5rem;font-size:0.75rem;color:var(--text-muted);border-bottom:1px solid var(--border-color);";
    hint.textContent = total > BREAKDOWN_MAX_FILES_DISPLAY
        ? `Showing first ${BREAKDOWN_MAX_FILES_DISPLAY} of ${total} files (narrow with search).`
        : `${total} file(s)`;
    fileListContainer.appendChild(hint);

    const listHost = document.createElement("div");
    listHost.id = "breakdown-list-host";
    fileListContainer.appendChild(listHost);

    if (total === 0) {
        listHost.innerHTML = `<p style="text-align:center; padding: 1rem; color: #888;">No files found.</p>`;
        return;
    }

    let index = 0;
    function appendChunk() {
        const end = Math.min(index + BREAKDOWN_LIST_CHUNK, displayFiles.length);
        for (; index < end; index++) {
            const file = displayFiles[index];
            const div = document.createElement("div");
            div.className = "module-item breakdown-file-row";
            div.style.marginBottom = "0.25rem";
            div.style.border = "1px solid transparent";
            div.style.cursor = "pointer";

            let icon = "fa-file";
            if (file.type === "py") icon = "fa-brands fa-python";
            else if (file.type === "js") icon = "fa-brands fa-js";
            else if (file.type === "html") icon = "fa-brands fa-html5";
            else if (file.type === "css") icon = "fa-brands fa-css3-alt";
            else if (file.type === "json") icon = "fa-solid fa-code";
            else if (file.type === "md") icon = "fa-solid fa-file-lines";

            div.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.75rem; overflow: hidden; width: 100%;">
                <i class="${icon}" style="color: var(--primary-blue); font-size: 1.1rem; width: 20px; text-align: center;"></i>
                <div style="display: flex; flex-direction: column; overflow: hidden; width: calc(100% - 30px);">
                    <span style="font-weight: 600; font-size: 0.9rem; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; color: var(--text-main);">${escapeHtml(file.name)}</span>
                    <span style="font-size: 0.75rem; color: var(--text-muted);">${file.language} &bull; ${file.size}</span>
                </div>
            </div>
        `;

            div.onclick = () => {
                document.querySelectorAll("#breakdown-file-list .breakdown-file-row").forEach(el => {
                    el.style.backgroundColor = "transparent";
                    el.style.border = "1px solid transparent";
                });
                div.style.backgroundColor = "rgba(37, 99, 235, 0.05)";
                div.style.border = "1px solid rgba(37, 99, 235, 0.2)";
                div.style.borderRadius = "6px";
                renderFileDetail(file);
            };
            listHost.appendChild(div);
        }
        if (index < displayFiles.length) {
            requestAnimationFrame(appendChunk);
        }
    }
    requestAnimationFrame(appendChunk);
}

function getFileComplexity(file) {
    let score = 0;
    if (file.lines > 300) score += 2;
    else if (file.lines > 100) score += 1;

    const funcs = file.functions ? file.functions.length : 0;
    const classes = file.classes ? file.classes.length : 0;
    if (funcs + classes > 10) score += 2;
    else if (funcs + classes > 4) score += 1;

    if (score >= 3) return { level: "High", color: "#EF4444" };
    if (score >= 1) return { level: "Medium", color: "#F59E0B" };
    return { level: "Low", color: "#10B981" };
}

function renderFileDetail(file) {
    const detailContainer = document.getElementById("breakdown-file-detail");

    const tagsHTML = (file.tags || []).map(t =>
        `<span style="background-color: rgba(37, 99, 235, 0.1); color: var(--primary-blue); padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.75rem; font-weight: 600;">${t}</span>`
    ).join(" ");

    const complexity = getFileComplexity(file);
    const pyStruct = (file.language === "Python" && ((file.functions && file.functions.length) || (file.classes && file.classes.length)))
        ? `<p style="font-size:0.85rem;color:var(--text-muted);margin:0 0 1rem 0;"><strong>Python:</strong> ${(file.classes || []).length} class(es), ${(file.functions || []).length} function(s) detected locally.</p>`
        : "";

    detailContainer.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem;">
            <div>
                <h2 style="margin: 0 0 0.25rem 0; color: var(--text-main); font-size: 1.5rem;">${escapeHtml(file.name)}</h2>
                <div style="font-family: monospace; color: var(--text-muted); font-size: 0.85rem;">${escapeHtml(file.path)}</div>
            </div>
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: flex-end; max-width: 50%;">
                ${tagsHTML}
            </div>
        </div>

        ${pyStruct}

        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem;">
            <div style="background: white; border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem; text-align: center;">
                <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0.25rem;">Language</div>
                <div style="font-weight: 600; color: var(--text-main);">${file.language}</div>
            </div>
            <div style="background: white; border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem; text-align: center;">
                <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0.25rem;">Size</div>
                <div style="font-weight: 600; color: var(--text-main);">${file.size}</div>
            </div>
            <div style="background: white; border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem; text-align: center;">
                <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0.25rem;">Lines</div>
                <div style="font-weight: 600; color: var(--text-main);">${file.lines}</div>
            </div>
            <div style="background: white; border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem; text-align: center;">
                <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0.25rem;">Complexity</div>
                <div style="font-weight: 700; color: ${complexity.color};">${complexity.level}</div>
            </div>
        </div>

        <p style="font-size:0.85rem;color:var(--text-muted);margin:0 0 0.75rem 0;">${escapeHtml(file.summary || "")}</p>

        <div style="display:flex; flex-wrap:wrap; gap:0.5rem; margin-bottom:1rem;">
            <button type="button" class="btn btn-primary" id="btn-short-ai-summary" style="padding:0.35rem 0.85rem;font-size:0.8rem;">Short AI summary</button>
            <button type="button" class="btn btn-outline" id="btn-full-ai-explain" style="padding:0.35rem 0.85rem;font-size:0.8rem;">Full AI explanation</button>
        </div>

        <div id="breakdown-short-ai" style="display:none; background: white; border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem; margin-bottom: 1rem; font-size: 0.9rem;"></div>

        <div id="dynamic-ai-explanation" style="background: white; border: 1px solid var(--border-color); border-radius: 8px; padding: 1.25rem; border-left: 4px solid var(--primary-blue); min-height: 3rem;">
            <p style="margin:0;color:var(--text-muted);font-size:0.9rem;">Optional: use the buttons above to run AI on this file only (nothing runs in bulk).</p>
        </div>
    `;

    const shortBtn = document.getElementById("btn-short-ai-summary");
    const fullBtn = document.getElementById("btn-full-ai-explain");
    if (shortBtn) shortBtn.addEventListener("click", () => fetchShortAiSummary(file));
    if (fullBtn) fullBtn.addEventListener("click", () => fetchDynamicFileExplanation(file.path));
}

async function fetchShortAiSummary(file) {
    const box = document.getElementById("breakdown-short-ai");
    if (!box || !currentAnalysis) return;
    box.style.display = "block";
    box.innerHTML = `<div class="spinner" style="width:22px;height:22px;margin:0 auto;"></div><p style="text-align:center;color:var(--text-muted);font-size:0.85rem;">Generating short summary…</p>`;
    try {
        const res = await fetch(`${API_URL}/breakdown/file-summary`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ repo_data: currentAnalysis, file_path: file.path })
        });
        if (!res.ok) {
            const errList = await res.json();
            throw new Error(errList.detail || "Summary failed");
        }
        const data = await res.json();
        box.innerHTML = `<strong style="color:var(--primary-blue);">Short summary</strong><p style="margin:0.5rem 0 0 0;white-space:pre-wrap;">${escapeHtml(data.summary || "")}</p>`;
    } catch (err) {
        box.innerHTML = `<div class="alert error" style="display:block;">${escapeHtml(err.message)}</div>`;
    }
}

async function fetchDynamicFileExplanation(filePath) {
    const container = document.getElementById("dynamic-ai-explanation");
    if (!container) return;

    function findFileContent(node, targetPath) {
        if (node.type === "file" && node.path === targetPath) return node.content;
        if (node.type === "directory" && node.children) {
            for (let child of node.children) {
                const res = findFileContent(child, targetPath);
                if (res) return res;
            }
        }
        return null;
    }

    const content = currentAnalysis ? findFileContent(currentAnalysis.file_tree, filePath) : null;
    if (!content) {
        container.innerHTML = `<div class="alert error" style="display:block;">Cannot find file content in memory to generate AI explanation.</div>`;
        return;
    }

    container.innerHTML = `
        <div style="text-align: center; padding: 1.5rem;">
            <div class="spinner" style="width: 24px; height: 24px; border-width: 2px; margin: 0 auto 0.75rem;"></div>
            <p style="margin: 0; color: var(--text-muted); font-size: 0.95rem;">Generating full explanation…</p>
        </div>
    `;

    try {
        const res = await fetch(`${API_URL}/explain`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ file_path: filePath, content: content })
        });

        if (!res.ok) throw new Error("Failed to generate breakdown");
        const data = await res.json();

        container.innerHTML = `
            <h5 style="margin: 0 0 1rem 0; font-size: 1.1rem; color: var(--primary-blue); display: flex; align-items: center; gap: 0.5rem; text-transform: uppercase; font-weight: 700; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem;">
                <i class="fa-solid fa-robot"></i> Full AI File Breakdown
            </h5>
            <div class="markdown-body" style="font-size: 0.95rem;">
                ${marked.parse(data.explanation)}
            </div>
        `;
    } catch (err) {
        container.innerHTML = `<div class="alert error" style="display:block;">${escapeHtml(err.message)}</div>`;
    }
}

// Module 5: Documentation Generator
async function downloadDocs() {
    if (!currentAnalysis) {
        showAlert("Please analyze a repository first.");
        return;
    }

    document.getElementById("btn-generate-docs").style.display = "none";
    document.getElementById("docs-loading").classList.remove("hidden");

    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

    try {
        const res = await fetch(`${API_URL}/generate-docs`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ repo_data: currentAnalysis })
        });

        if (!res.ok) {
            const errList = await res.json();
            throw new Error(errList.detail || "Failed to generate documentation");
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = "Repository_Documentation.pdf";
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
    } catch (err) {
        showAlert(err.message);
    } finally {
        document.getElementById("btn-generate-docs").style.display = "inline-block";
        document.getElementById("docs-loading").classList.add("hidden");
    }
}

// Module 5: Dependency Graph
async function generateDependencyGraph() {
    if (!currentAnalysis) {
        showAlert("Please analyze a repository first.");
        return;
    }

    const graphContent = document.getElementById("graph-content");
    graphContent.style.display = "block";
    graphContent.innerHTML = `<div style="text-align:center; padding: 2rem;"><div class="spinner"></div><p style="color:var(--text-muted)">Scanning files and generating graph...</p></div>`;

    try {
        const res = await fetch(`${API_URL}/dependency-graph`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ repo_data: currentAnalysis })
        });

        if (!res.ok) {
            const errList = await res.json();
            throw new Error(errList.detail || "Failed to generate dependency graph");
        }

        const data = await res.json();
        graphContent.innerHTML = marked.parse(data.markdown);
    } catch (err) {
        graphContent.innerHTML = `<div class="alert error" style="display:block;">${escapeHtml(err.message)}</div>`;
    }
}


