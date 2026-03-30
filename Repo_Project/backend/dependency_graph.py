import re
import os

def parse_imports(file_node):
    name = file_node.get("name", "")
    content = file_node.get("content", "")
    lang = file_node.get("language", "Other")
    
    deps = []
    if not content:
        return deps
        
    if lang == "Python":
        for line in content.splitlines():
            line = line.strip()
            if line.startswith("import "):
                try:
                    parts = line.split("import ")[1].split(",")
                    for p in parts:
                        deps.append(p.strip().split()[0])
                except Exception:
                    pass
            elif line.startswith("from "):
                try:
                    parts = line.split(" ")
                    if len(parts) >= 3 and parts[2] == "import":
                        deps.append(parts[1])
                except Exception:
                    pass
                    
    elif lang in ["JavaScript", "JavaScript (React)", "TypeScript", "TypeScript (React)"]:
        import_re = re.compile(r"import\s+.*?\s+from\s+['\"](.*?)['\"]")
        require_re = re.compile(r"require\(['\"](.*?)['\"]\)")
        for m in import_re.finditer(content):
            deps.append(m.group(1))
        for m in require_re.finditer(content):
            deps.append(m.group(1))
            
    elif lang == "HTML":
        link_re = re.compile(r"<link\s+.*?href=['\"](.*?)['\"]")
        script_re = re.compile(r"<script\s+.*?src=['\"](.*?)['\"]")
        for m in link_re.finditer(content):
            deps.append(m.group(1))
        for m in script_re.finditer(content):
            deps.append(m.group(1))
            
    return deps

def build_tree_string(tree, prefix="", is_last=True, is_root=True):
    if not isinstance(tree, dict): return ""
    output = ""
    name = tree.get("name", "")
    
    if is_root:
        output += f"{name}/\n"
        children = tree.get("children", [])
        for i, child in enumerate(children):
            output += build_tree_string(child, "", i == len(children) - 1, False)
        return output
        
    connector = "└── " if is_last else "├── "
    output += f"{prefix}{connector}{name}{'/' if tree.get('type') == 'directory' else ''}\n"
    
    if tree.get("type") == "directory":
        children = tree.get("children", [])
        new_prefix = prefix + ("    " if is_last else "│   ")
        for i, child in enumerate(children):
            output += build_tree_string(child, new_prefix, i == len(children) - 1, False)
            
    return output

def build_dependency_graph(file_tree):
    all_files = []
    
    def extract_files(node):
        if not isinstance(node, dict): return
        if node.get("type") == "file":
            all_files.append(node)
        elif node.get("type") == "directory":
            for child in node.get("children", []):
                extract_files(child)
                
    extract_files(file_tree)
    
    out = []
    for f in all_files:
        path = f.get("path", f.get("name", ""))
        deps = parse_imports(f)
        if deps:
            out.append(f"{path}")
            lang = f.get("language", "Other")
            verb = "uses"
            if lang == "HTML": verb = "links"
            
            for i, d in enumerate(deps):
                connector = "└── " if i == len(deps) - 1 else "├── "
                out.append(f"{connector}{verb} → {d}")
            out.append("")
                
    return "\n".join(out)

def generate_graph_data(repo_data):
    tree = repo_data.get("file_tree", {})
    tree_str = build_tree_string(tree)
    deps_str = build_dependency_graph(tree)
    
    markdown_output = f"## 1. TREE STRUCTURE\n```text\n{tree_str}\n```\n\n## 2. DEPENDENCY GRAPH\n```text\n{deps_str}\n```\n"
    return markdown_output
