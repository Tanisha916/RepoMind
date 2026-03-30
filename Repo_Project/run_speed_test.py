import requests

import time
import json

BASE_URL = "http://localhost:8000"

def test_speed():
    print("Logging in...")
    try:
        # 1. Use JSON request body instead of form data
        # "Ensure compatibility with FastAPI login endpoint"
        payload = {"username": "testuser", "password": "password123"}
        r_login = requests.post(f"{BASE_URL}/api/login", json=payload, timeout=10)
        
        # 5. Clear success/failure and backend errors
        if r_login.status_code != 200:
            print(f"❌ Login failed with status: {r_login.status_code}")
            print(f"Backend output: {r_login.text}")
            return
            
        data = r_login.json()
        print("✅ Login successful.")
        
        # 2. Token handling: access_token OR token
        token = data.get("access_token") or data.get("token")
        
        # 6. Validation before using
        if not token:
            print("❌ Login failed: No valid token extracted from response.")
            print(f"Response: {data}")
            return
            
    # 3. Wrap API calls in try/except (timeouts, unexpected errors)
    except requests.exceptions.Timeout:
        print("❌ Login failed: Request timed out.")
        return
    except requests.exceptions.RequestException as e:
        print(f"❌ Login failed: Network error. {e}")
        return
    except ValueError as e:
        print(f"❌ Login failed: Invalid JSON. {e}")
        return
    except Exception as e:
        print(f"❌ Login failed: Unexpected error. {e}")
        return

    headers = {"Authorization": f"Bearer {token}"}

    test_url = "https://github.com/psf/requests"
    print(f"\nTesting analysis time for {test_url}...")
    
    start_time = time.time()
    try:
        # 4. Add timeout to analyze request
        r_analyze = requests.post(
            f"{BASE_URL}/api/analyze/url", 
            json={"url": test_url},
            headers=headers,
            timeout=120  # Prevent hanging on slow analysis
        )
        end_time = time.time()

        if r_analyze.status_code == 200:
            analysis_data = r_analyze.json()
            print(f"✅ Success! Analysis completed in {end_time - start_time:.2f} seconds.")
            print(f"Total files detected: {analysis_data.get('total_files')}")
            print(f"Total lines of code: {analysis_data.get('total_lines')}")
        else:
            print(f"❌ Analysis failed with status: {r_analyze.status_code}")
            print(f"Backend output: {r_analyze.text}")
            
    except requests.exceptions.Timeout:
        print("❌ Analysis failed: Request timed out.")
    except requests.exceptions.RequestException as e:
        print(f"❌ Analysis failed: Network error. {e}")
    except ValueError as e:
        print(f"❌ Analysis failed: Invalid JSON. {e}")
    except Exception as e:
        print(f"❌ Analysis failed: Unexpected error. {e}")

if __name__ == "__main__":
    test_speed()