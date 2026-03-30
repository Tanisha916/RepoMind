import sys
import time
import analyzer
import os

repo_path = "C:/Users/admin/Downloads/Repo_Project/Repo_Project"

print(f"Starting analysis of {repo_path}...")
start_time = time.time()
try:
    res = analyzer.analyze_directory(repo_path)
    end_time = time.time()
    print(f"Success! Analysis took {end_time - start_time:.2f} seconds.")
    print(f"Files: {res.get('total_files')} | Lines: {res.get('total_lines')}")
except Exception as e:
    print(f"Failed with error: {e}")
