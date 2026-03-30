import requests

BASE_URL = "http://localhost:8000"

def run_test():
    # 1. Signup
    print("Signing up user testuser...")
    r = requests.post(f"{BASE_URL}/api/signup", json={"username": "testuser", "password": "password123"})
    if r.status_code == 400 and "already registered" in r.text:
        print("User already exists.")
    else:
        r.raise_for_status()
    
    # 2. Login
    print("Logging in...")
    r = requests.post(f"{BASE_URL}/api/login", data={"username": "testuser", "password": "password123"})
    r.raise_for_status()
    token = r.json()["access_token"]
    
    # 3. Test Explain
    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "file_path": "example.py",
        "content": "def hello_world():\n    print('Hello World!')"
    }
    
    print("Sending code to AI explainer (phi3)...")
    r = requests.post(f"{BASE_URL}/api/explain", json=payload, headers=headers)
    r.raise_for_status()
    
    print("\nAI Response:")
    print(r.json().get("explanation", ""))
    print("\nIntegration Works!")

if __name__ == "__main__":
    run_test()
