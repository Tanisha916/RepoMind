import os
import ast
import json
import ollama
from concurrent.futures import ThreadPoolExecutor, as_completed

def get_language_from_ext(ext):
    ext_map = {
        ".py": "Python", ".js": "JavaScript", ".jsx": "JavaScript (React)",
        ".ts": "TypeScript", ".tsx": "TypeScript (React)", ".html": "HTML",
        ".css": "CSS", ".java": "Java", ".c": "C", ".cpp": "C++",
        ".go": "Go", ".rb": "Ruby", ".php": "PHP", ".rs": "Rust",
        ".cs": "C#", ".md": "Markdown", ".json": "JSON"
    }
    return ext_map.get(ext, "Other")

def detect_language(file_path):
    _, ext = os.path.splitext(file_path)
    return get_language_from_ext(ext.lower())

def count_lines(file_content):
    return len(file_content.splitlines())

def extract_code_structure(file_content, language="Python"):
    structure = {"functions": [], "classes": []}
    if language != "Python":
        return structure
        
    try:
        tree = ast.parse(file_content)
        for node in ast.walk(tree):
            try:
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    structure["functions"].append(node.name)
                elif isinstance(node, ast.ClassDef):
                    structure["classes"].append(node.name)
            except Exception:
                continue
    except Exception:
        # If parsing fails, just return empty lists safely
        pass
        
    return structure

def format_size(size_bytes):
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.1f} MB"

def extract_file_metadata(file_path, base_dir=None):
    if not os.path.exists(file_path):
        return None
        
    name = os.path.basename(file_path)
    if base_dir:
        rel_path = os.path.relpath(file_path, base_dir)
        # normalize slashes for json output
        rel_path = rel_path.replace("\\", "/")
    else:
        rel_path = name
        
    _, ext = os.path.splitext(file_path)
    # Removing dot for type like "py"
    type_ext = ext[1:] if ext.startswith(".") else ext
    if not type_ext:
        type_ext = "unknown"
        
    size_bytes = os.path.getsize(file_path)
    
    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()
        
    lines = count_lines(content)
    
    return {
        "name": name,
        "path": rel_path,
        "type": type_ext,
        "size": format_size(size_bytes),
        "lines": lines,
        "_content": content, # Internal use, removed before final output
        "_abs_path": file_path # Internal use
    }

def generate_file_summary_ai(file_name, file_path, file_content):
    prompt = f"""You are a helpful coding assistant. Please concisely explain what the following file does in 2-3 lines max. Keep it very beginner-friendly and clear. Focus on the core purpose.
    
File Name: {file_name}
File Path: {file_path}
File Content:
```
{file_content[:3000]} # Truncated to avoid huge prompts
```

RULES:
- Always return a meaningful explanation, even if the file content is empty or very limited.
- Do NOT return "not enough content" or similar messages.
- If content is missing or small, infer the file's purpose based on its name and path (e.g., auth.py handles authentication, models.py handles database models, etc.).
"""
    try:
        response = ollama.chat(model='phi3', messages=[
            {'role': 'user', 'content': prompt}
        ])
        return response['message']['content'].strip()
    except Exception as e:
        return "Failed to generate summary (Ollama error)."

def flatten_file_nodes(file_tree):
    """Collect all file nodes from analyzer file_tree (recursive)."""
    out = []

    def walk(node):
        if not isinstance(node, dict):
            return
        if node.get("type") == "file":
            out.append(node)
        elif node.get("type") == "directory":
            for child in node.get("children", []) or []:
                walk(child)

    walk(file_tree)
    return out

def extract_file_nodes_from_tree(file_tree):
    """Flatten file_tree into a list of file nodes (same shape as analyzer output)."""
    all_file_nodes = []

    def extract_nodes(node):
        if not isinstance(node, dict):
            return
        if node.get("type") == "file":
            all_file_nodes.append(node)
        elif node.get("type") == "directory":
            for child in node.get("children", []) or []:
                extract_nodes(child)

    extract_nodes(file_tree or {})
    return all_file_nodes

def find_file_node(tree, file_path):
    """Walk file_tree dict and return the file node matching path, or None."""
    if not isinstance(tree, dict):
        return None
    if tree.get("type") == "file":
        if tree.get("path") == file_path:
            return tree
        return None
    if tree.get("type") == "directory":
        for child in tree.get("children", []) or []:
            found = find_file_node(child, file_path)
            if found is not None:
                return found
    return None

def _build_meta_from_node(node):
    """Single-file metadata + structure from cached analyzer node (no AI)."""
    name = node.get("name", "")
    rel_path = node.get("path", name)
    _, ext = os.path.splitext(name)
    type_ext = ext[1:] if ext.startswith(".") else ext
    if not type_ext:
        type_ext = "unknown"

    content = node.get("content", "") or ""
    lines = node.get("lines", 0)
    size_str = format_size(len(content.encode("utf-8"))) if content else "Unknown"

    meta = {
        "name": name,
        "path": rel_path,
        "type": type_ext,
        "size": size_str,
        "lines": lines,
        "language": node.get("language", "Other"),
        "priority": node.get("priority", "medium"),
    }

    try:
        structure = extract_code_structure(content, meta["language"])
        if meta["language"] == "Python":
            meta["functions"] = structure["functions"]
            meta["classes"] = structure["classes"]
        else:
            meta["functions"] = []
            meta["classes"] = []
    except Exception:
        meta["functions"] = []
        meta["classes"] = []

    meta["summary"] = ""
    meta["summary_pending"] = True
    return meta

def identify_important_files(file_list):
    entry_points = ["app.py", "main.py", "index.js", "server.js", "app.js"]
    config_files = ["package.json", ".env", "config.js", "config.py", "settings.py", "settings.json"]
    
    for f in file_list:
        f["tags"] = []
        name = f["name"].lower()
        
        # 1. Entry Point
        if name in entry_points:
            f["tags"].append("Entry Point")
            
        # 2. Config File
        if name in config_files or "config" in name or "settings" in name or name.endswith(".env"):
            f["tags"].append("Config File")
            
        # 3. Core File
        # Let's say it's a code file with > 50 lines (for this arbitrary example threshold)
        # or it has 'core', 'utils', 'service' in the name.
        if "core" in name or "utils" in name or "service" in name:
            if "Config File" not in f["tags"]:
                f["tags"].append("Core File")
        elif f["lines"] > 50 and f["type"] in ["py", "js", "ts", "java", "cpp", "go"]:
            if "Entry Point" not in f["tags"] and "Config File" not in f["tags"]:
                f["tags"].append("Core File")

def analyze_files_from_cache(file_nodes):
    """
    Build breakdown from cached analyzer file nodes. No bulk LLM calls —
    summaries are loaded on demand via generate_file_summary_for_path.
    """
    if not file_nodes:
        return {"files": []}

    max_workers = min(8, max(2, (os.cpu_count() or 4)))
    results = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(_build_meta_from_node, node) for node in file_nodes]
        for fut in as_completed(futures):
            try:
                results.append(fut.result())
            except Exception:
                continue

    results.sort(key=lambda m: m.get("path", m.get("name", "")))
    identify_important_files(results)

    for meta in results:
        priority = meta.get("priority", "medium")
        if priority == "low":
            meta["summary"] = "Low priority folder/file — use “AI summary” after selecting if needed."
        else:
            meta["summary"] = "Select this file to load an optional AI summary on demand."

    return {"files": results}

def generate_file_summary_for_path(repo_data: dict, file_path: str) -> str:
    """On-demand AI summary for one file using content already in repo_data tree."""
    tree = repo_data.get("file_tree") or {}
    node = find_file_node(tree, file_path)
    if not node:
        return "File not found in analyzed data."
    content = node.get("content") or ""
    name = node.get("name", "")
    return generate_file_summary_ai(name, file_path, content)

def analyze_files(file_paths, base_dir=None):
    results = []
    
    for path in file_paths:
        try:
            meta = extract_file_metadata(path, base_dir)
            if not meta:
                continue
                
            content = meta.pop("_content")
            abs_path = meta.pop("_abs_path")
            
            meta["language"] = detect_language(abs_path)
            meta["priority"] = "medium" # Default for disk reads without analyzer
            
            structure = extract_code_structure(content, meta["language"])
            if meta["language"] == "Python":
                meta["functions"] = structure["functions"]
                meta["classes"] = structure["classes"]
                
            meta["_content_tmp"] = content
            results.append(meta)
        except Exception:
            # Skip file to prevent crashing
            continue
        
    identify_important_files(results)
    
    summary_count: int = 0
    for meta in results:
        content = meta.pop("_content_tmp")
        if len(meta.get("tags", [])) > 0 and summary_count < 2:
            try:
                meta["summary"] = generate_file_summary_ai(meta["name"], meta.get("path", meta["name"]), content)
            except Exception:
                meta["summary"] = "Failed to generate summary."
            summary_count = summary_count + 1
        else:
            meta["summary"] = "Standard file. Automatic AI summary skipped for performance."
            
    return {"files": results}

if __name__ == "__main__":
    # Create sample files if they don't exist
    sample_py = "app.py"
    with open(sample_py, "w", encoding="utf-8") as f:
        f.write('''from auth import validate_user, register
class User:
    pass
class AuthManager:
    pass
def login():
    validate_user()
def logout():
    pass
''')

    sample_json = "config.json"
    with open(sample_json, "w", encoding="utf-8") as f:
        f.write('{\n  "port": 8000,\n  "db": "sqlite3"\n}')

    # Run analysis
    paths_to_analyze = [sample_py, sample_json]
    
    print("Running sequence... (This may take a few seconds due to Ollama)")
    output_data = analyze_files(paths_to_analyze, base_dir=".")
    
    print("\n--- Example Output JSON ---")
    print(json.dumps(output_data, indent=2))
    
    # Clean up samples
    if os.path.exists(sample_py): os.remove(sample_py)
    if os.path.exists(sample_json): os.remove(sample_json)
