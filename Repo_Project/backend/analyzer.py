import os
import subprocess
import tempfile
import shutil
import zipfile
import io
import urllib.parse
import urllib.request
import urllib.error
import json
def is_ignored(path):
    ignored = [
        ".git", "node_modules", "__pycache__", ".venv", "venv", ".idea", ".vscode",
        "dist", "build", "vendor", ".gradle", "Pods", "__MACOSX", "coverage", ".next",
        ".nuxt", ".cache", "target",
    ]
    for i in ignored:
        if i in path.split(os.sep): return True
    return False

def get_language_from_ext(ext):
    ext_map = {
        ".py": "Python", ".js": "JavaScript", ".jsx": "JavaScript (React)",
        ".ts": "TypeScript", ".tsx": "TypeScript (React)", ".html": "HTML",
        ".css": "CSS", ".java": "Java", ".c": "C", ".cpp": "C++",
        ".go": "Go", ".rb": "Ruby", ".php": "PHP", ".rs": "Rust",
        ".cs": "C#", ".md": "Markdown", ".json": "JSON"
    }
    return ext_map.get(ext, "Other")

def get_priority(filename, path):
    name = filename.lower()
    path_lower = path.lower()
    low_keywords = ["test", "migration", "config", "settings", ".env", ".json"]
    if any(k in name or k in path_lower for k in low_keywords):
        return "low"
    high_keywords = ["main", "app", "route", "model", "core"]
    if any(k in name for k in high_keywords):
        return "high"
    return "medium"

def analyze_directory(base_path):
    total_files = 0
    total_lines = 0
    languages = {}
    file_tree = {"name": os.path.basename(base_path), "type": "directory", "children": []}
    
    def build_tree(current_path, current_node):
        nonlocal total_files, total_lines
        try:
            items = os.listdir(current_path)
        except Exception:
            return
            
        for item in sorted(items):
            item_path = os.path.join(current_path, item)
            rel_path = os.path.relpath(item_path, base_path)
            
            if is_ignored(rel_path):
                continue
                
            if os.path.isdir(item_path):
                child_node = {"name": item, "type": "directory", "children": []}
                current_node["children"].append(child_node)
                build_tree(item_path, child_node)
            else:
                try:
                    total_files += 1
                    _, ext = os.path.splitext(item)
                    lang = get_language_from_ext(ext.lower())
                    languages[lang] = languages.get(lang, 0) + 1
                    
                    priority = get_priority(item, rel_path)
                    
                    lines = 0
                    content = ""
                    size = os.path.getsize(item_path)
                    
                    # Dynamic sizes based on priority
                    max_size = 50000 if priority != "low" else 10000
                    max_lines = 1000 if priority != "low" else 200
                    valid_exts = [".py", ".js", ".jsx", ".ts", ".tsx", ".html", ".css", ".java", ".c", ".cpp", ".go", ".rb", ".php", ".rs", ".cs", ".md", ".json"]
                    
                    if size < max_size and ext.lower() in valid_exts:
                        with open(item_path, "r", encoding="utf-8") as f:
                            lines_list = f.readlines()
                            lines = len(lines_list)
                            total_lines += lines
                            if lines < max_lines:
                                content = "".join(lines_list)
                    
                    current_node["children"].append({
                        "name": item, 
                        "type": "file", 
                        "path": rel_path,
                        "language": lang,
                        "lines": lines,
                        "content": content,
                        "priority": priority
                    })
                except Exception as e:
                    # Skip problematic files without halting
                    continue
                
    build_tree(base_path, file_tree)
    
    return {
        "total_files": total_files,
        "total_lines": total_lines,
        "languages": languages,
        "file_tree": file_tree
    }

def analyze_github_repo(url: str):
    temp_dir = tempfile.mkdtemp()
    try:
        # Preferred: git clone (fast). In restricted environments, this may fail while
        # creating `.git/hooks/`, so we fall back to downloading the GitHub zipball.
        try:
            subprocess.run(
                ["git", "clone", "--depth", "1", url, temp_dir],
                check=True,
                capture_output=True,
            )
            return analyze_directory(temp_dir)
        except subprocess.CalledProcessError:
            pass

        extracted_to = tempfile.mkdtemp()

        # GitHub-only zip fallback:
        parsed = urllib.parse.urlparse(url)
        if parsed.netloc.lower() not in ("github.com", "www.github.com"):
            raise Exception("Failed to clone repository. Is it public and valid?")

        parts = [p for p in parsed.path.split("/") if p]
        if len(parts) < 2:
            raise Exception("Failed to clone repository. Is it public and valid?")

        owner = parts[0]
        repo = parts[1]
        if repo.endswith(".git"):
            repo = repo[: -len(".git")]

        # If the URL includes `/tree/<branch>`, use that branch; otherwise try main/master.
        branch = None
        if "tree" in parts:
            try:
                i = parts.index("tree")
                if i + 1 < len(parts):
                    branch = parts[i + 1]
            except ValueError:
                branch = None

        candidates = [branch] if branch else ["main", "master"]
        if not branch:
            # Best-effort: use the repo's actual default branch from GitHub API.
            api_url = f"https://api.github.com/repos/{owner}/{repo}"
            try:
                api_req = urllib.request.Request(
                    api_url,
                    headers={"User-Agent": "RepoMind/1.0"},
                )
                with urllib.request.urlopen(api_req, timeout=30) as resp:
                    payload = json.loads(resp.read().decode("utf-8", errors="ignore"))
                default_branch = payload.get("default_branch")
                if isinstance(default_branch, str) and default_branch.strip():
                    candidates = [default_branch] + candidates
            except Exception:
                # Fall back to main/master only.
                pass

        zip_path = os.path.join(temp_dir, "repo.zip")
        last_err = None
        for b in candidates:
            zip_url = f"https://github.com/{owner}/{repo}/archive/refs/heads/{b}.zip"
            try:
                req = urllib.request.Request(
                    zip_url,
                    headers={"User-Agent": "RepoMind/1.0"},
                )
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = resp.read()
                with open(zip_path, "wb") as f:
                    f.write(data)
                # analyze_zip_file deletes extract_to after analysis
                return analyze_zip_file(zip_path, extracted_to)
            except (urllib.error.HTTPError, urllib.error.URLError, OSError) as e:
                last_err = e
                continue

        raise Exception("Failed to clone repository. Is it public and valid?") from last_err
    except subprocess.CalledProcessError as e:
        raise Exception("Failed to clone repository. Is it public and valid?")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

def analyze_zip_file(zip_path: str, extract_to: str):
    try:
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(extract_to)
        
        # Determine the root dir. A zip often has a single root folder.
        items = os.listdir(extract_to)
        items = [i for i in items if i != os.path.basename(zip_path) and not i.startswith("__MACOSX")]
        
        base_path = extract_to
        if len(items) == 1 and os.path.isdir(os.path.join(extract_to, items[0])):
            base_path = os.path.join(extract_to, items[0])
            
        result = analyze_directory(base_path)
        return result
    finally:
        shutil.rmtree(extract_to, ignore_errors=True)
