import ollama
import doc_generator

# =========================
# FILE EXPLANATION (WORKS FINE)
# =========================
def explain_file(file_path: str, content: str) -> str:
    prompt = f"""You are an expert AI code explainer.

File Path: {file_path}

Code:
{content[:1500]}

Explain this file clearly.

Rules:
- Do NOT hallucinate
- If content is small → infer from file name
- Keep explanation structured

Output:
1. Purpose
2. Classes
3. Functions
4. Summary
"""
    try:
        response = ollama.chat(
            model='phi3',
            messages=[{'role': 'user', 'content': prompt}]
        )
        return response['message']['content']
    except Exception as e:
        return f"Error: {str(e)}"


# =========================
# REPOSITORY EXPLANATION (FIXED VERSION)
# =========================
def explain_repo(repo_summary: dict) -> str:
    project_name = repo_summary.get("project_name", "Unknown Project")
    file_tree = repo_summary.get("file_tree", {})
    languages = repo_summary.get("languages", {})

    readme_content = doc_generator.get_file_content_from_tree(file_tree, "readme.md") or ""
    files_list = doc_generator.get_file_list(file_tree)

    # ✅ Extract real code from repo (IMPORTANT FIX)
    all_code_snippets = []

    def extract_code(node):
        if node.get("type") == "file":
            name = node.get("name", "")
            content = node.get("content", "")

            if name.endswith((".py", ".js", ".html", ".css")) and content:
                snippet = f"\n--- {name} ---\n{content[:500]}"
                all_code_snippets.append(snippet)

        for child in node.get("children", []):
            extract_code(child)

    extract_code(file_tree)

    # Limit size for performance
    snippets_text = "\n".join(all_code_snippets[:20])

    if not snippets_text and not readme_content:
        return "Not enough information found in repository"

    prompt = f"""
You MUST generate explanation ONLY using the provided repository data.

DO NOT GUESS.
DO NOT ADD EXTERNAL KNOWLEDGE.
If something is missing → say "Not found in repository".

------------------------
PROJECT NAME:
{project_name}

LANGUAGES:
{list(languages.keys())}

FILES:
{", ".join(files_list[:100])}

README:
{readme_content[:1500] if readme_content else "No README available"}

CODE SNIPPETS:
{snippets_text if snippets_text else "No code available"}
------------------------

OUTPUT FORMAT:

## Project Name
- {project_name}

## Project Overview
- Explain what the project does based ONLY on given code

## Features
- Real features from code

## Tech Stack
- Languages and tools actually used

## Language Usage
- Role of each language

## Important Files
- Mention real file names and their purpose

## Structure
- Explain folders/modules

## Use Cases
- Real-world usage based on code

------------------------

STRICT RULES:
- NO hallucination
- NO generic explanation
- MUST mention real file names
- ONLY use given data
"""

    try:
        response = ollama.chat(
            model='phi3',
            messages=[{'role': 'user', 'content': prompt}]
        )
        return response['message']['content']
    except Exception as e:
        return f"Error communicating with Ollama: {str(e)}"


# =========================
# Q&A CHAT
# =========================
def chat_about_repo(question: str, repo_summary: dict) -> str:
    prompt = f"""You are an AI assistant for code.

Repository Info:
Files: {repo_summary.get('total_files')}
Lines: {repo_summary.get('total_lines')}
Languages: {repo_summary.get('languages')}

User Question:
{question}

Answer clearly and based on repository context.
"""

    try:
        response = ollama.chat(
            model='phi3',
            messages=[{'role': 'user', 'content': prompt}]
        )
        return response['message']['content']
    except Exception as e:
        return f"Error: {str(e)}"