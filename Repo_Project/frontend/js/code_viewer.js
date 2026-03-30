// ============================================
// Module 6: View Code
// ============================================

let viewcodeFilesCache = [];
let viewcodeListFilter = "";

function loadFiles() {
    if (typeof currentAnalysis === 'undefined' || !currentAnalysis || !currentAnalysis.file_tree) {
        const listContainer = document.getElementById("viewcode-file-list");
        if (listContainer) {
            listContainer.innerHTML = `<p style="padding: 1rem; color: var(--text-muted);">Please analyze a repository first.</p>`;
        }
        return;
    }

    const allowedExtensions = [".py", ".js", ".html", ".css", ".json"];
    viewcodeFilesCache = [];

    function traverseTree(node, currentPath = "") {
        if (!node) return;
        
        // Skip ignored directories
        if (node.type === "directory" && ["venv", ".venv", "__pycache__", "node_modules"].includes(node.name)) {
            return;
        }

        if (node.type === "file") {
            const extMatch = node.name.match(/\.[0-9a-z]+$/i);
            const ext = extMatch ? extMatch[0].toLowerCase() : "";
            
            if (allowedExtensions.includes(ext)) {
                viewcodeFilesCache.push({
                    name: node.name,
                    path: currentPath ? `${currentPath}/${node.name}` : node.name,
                    language: node.language || "Unknown",
                    content: node.content
                });
            }
        } else if (node.type === "directory" && Array.isArray(node.children)) {
            const newPath = currentPath ? `${currentPath}/${node.name}` : node.name;
            node.children.forEach(child => traverseTree(child, newPath));
        }
    }

    traverseTree(currentAnalysis.file_tree);
    
    const searchInput = document.getElementById("viewcode-search");
    if (searchInput) searchInput.value = "";
    
    viewcodeListFilter = "";
    renderFileList();
}

function renderFileList() {
    const listContainer = document.getElementById("viewcode-file-list");
    if (!listContainer) return;
    
    listContainer.innerHTML = "";

    if (viewcodeFilesCache.length === 0) {
        listContainer.innerHTML = `<p style="padding: 1rem; color: var(--text-muted); font-size: 0.85rem;">No supported code files found.</p>`;
        return;
    }

    const filtered = viewcodeFilesCache.filter(f => {
        if (!viewcodeListFilter) return true;
        return f.name.toLowerCase().includes(viewcodeListFilter.toLowerCase()) || 
               f.path.toLowerCase().includes(viewcodeListFilter.toLowerCase());
    });

    if (filtered.length === 0) {
        listContainer.innerHTML = `<p style="padding: 1rem; color: var(--text-muted); font-size: 0.85rem;">No files match search.</p>`;
        return;
    }

    filtered.forEach(file => {
        const item = document.createElement("div");
        item.style.padding = "0.75rem 1rem";
        item.style.borderBottom = "1px solid var(--border-color)";
        item.style.cursor = "pointer";
        item.style.display = "flex";
        item.style.flexDirection = "column";
        item.style.gap = "0.25rem";
        item.style.transition = "background 0.2s";

        const safeName = file.name || "Unknown";
        const safeLang = file.language || "Unknown";
        const safePath = file.path || "Unknown path";

        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong style="color: var(--text-color); font-size: 0.9rem;">
                    <i class="fa-regular fa-file" style="color: var(--primary-blue); margin-right: 0.5rem;"></i>
                    <span class="fname"></span>
                </strong>
                <span class="flang" style="font-size: 0.7rem; color: white; background: var(--primary-blue); padding: 0.1rem 0.4rem; border-radius: 4px;"></span>
            </div>
            <div class="fpath" style="font-size: 0.75rem; color: var(--text-muted); word-break: break-all;"></div>
        `;
        item.querySelector('.fname').textContent = safeName;
        item.querySelector('.flang').textContent = safeLang;
        item.querySelector('.fpath').textContent = safePath;

        item.addEventListener("mouseover", () => item.style.background = "#f1f5f9");
        item.addEventListener("mouseout", () => item.style.background = "transparent");

        item.addEventListener("click", () => showFileContent(file));
        listContainer.appendChild(item);
    });
}

function showFileContent(fileNode) {
    const filenameEl = document.getElementById("viewcode-filename");
    const langEl = document.getElementById("viewcode-language");
    const detailContainer = document.getElementById("viewcode-file-detail");
    
    if (filenameEl) {
        filenameEl.innerHTML = `<i class="fa-solid fa-code" style="margin-right: 0.5rem;"></i>`;
        const pathSpan = document.createElement("span");
        pathSpan.textContent = fileNode.path || "Unknown path";
        filenameEl.appendChild(pathSpan);
    }
    
    if (langEl) {
        langEl.textContent = fileNode.language || "Unknown";
    }

    let displayContent = "// No code available or file too large to display directly.";
    if (typeof fileNode.content === "string") {
        displayContent = fileNode.content;
    }

    if (detailContainer) {
        detailContainer.innerHTML = `
            <div style="padding: 1rem; background: #f8fafc; height: 100%; overflow: auto;">
                <div style="padding: 1rem; background: white; border: 1px solid var(--border-color); border-radius: 8px; min-height: 100%; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                    <pre style="margin: 0; font-family: 'Consolas', 'Courier New', monospace; font-size: 13px; color: #334155; tab-size: 4; overflow-x: auto;"><code id="viewcode-code-block"></code></pre>
                </div>
            </div>
        `;
        document.getElementById("viewcode-code-block").textContent = displayContent;
    }
}
