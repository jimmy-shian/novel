import os
import torch
import json
import requests
from flask import Flask, request, jsonify, Response
from config import USE_LOCAL_VLLM, NVIDIA_API_KEY, GPTOSS_API_KEY, NVIDIA_API_URL, NVIDIA_MODEL_NAME

# CONFIG
MODEL_PATH = r"C:\Users\user\Downloads\novel\Model"
PORT = 8000

app = Flask(__name__)

tokenizer = None
model = None
streamer = None

if USE_LOCAL_VLLM:
    from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig, TextStreamer
    print(f"Loading model from {MODEL_PATH}...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_PATH,
        device_map="auto",
        torch_dtype=torch.bfloat16,
        trust_remote_code=True
    )
    # Initialize streamer for console output
    streamer = TextStreamer(tokenizer, skip_prompt=True)
else:
    print("USE_LOCAL_VLLM is False. Operating in NVIDIA API proxy mode.")

@app.route("/v1/chat/completions", methods=["POST"])
def chat_completions():
    data = request.json
    messages = data.get("messages", [])
    stream = data.get("stream", False)
    
    # Debug print: Request
    print("\n" + "!"*60)
    print(">>> [DEBUG] NEW REQUEST RECEIVED")
    print(f">>> Mode: {'Local HF' if USE_LOCAL_VLLM else 'NVIDIA Proxy'}")
    print(f">>> Stream: {stream}")
    print("!"*60)
    
    print("\n" + "="*50)
    print("RECEIVED MESSAGES:")
    for m in messages:
        role = m['role'].upper()
        content = m['content']
        display_content = content[:100] + "..." if len(content) > 100 else content
        print(f"[{role}]: {display_content}")
    print("-" * 50)

    if USE_LOCAL_VLLM:
        # Use model's native chat template for better results
        try:
            prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        except Exception:
            # Fallback to manual if template fails
            prompt = ""
            for m in messages:
                role = m['role'].upper()
                content = m['content']
                prompt += f"{role}: {content}\n"
            prompt += "ASSISTANT: "
        
        print("-" * 50)

        # Manual Generation for better control
        inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
        
        print("GENERATING (Streaming to console...):")
        with torch.no_grad():
            outputs = model.generate(
                **inputs,
                max_new_tokens=2048,
                # temperature=0.01, # Lower temperature for more stable JSON
                # top_p=0.9,
                do_sample=True,
                pad_token_id=tokenizer.eos_token_id,
                streamer=streamer
            )
        
        # Decode only the NEW tokens
        generated_ids = outputs[0][len(inputs.input_ids[0]):]
        reply = tokenizer.decode(generated_ids, skip_special_tokens=True).strip()
        
        print("\n" + "="*50 + "\n")
            
        return jsonify({
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": reply
                    }
                }
            ]
        })
    else:
        # Proxy to NVIDIA API
        print("PROXYING TO NVIDIA API...")
        
        # Use GPTOSS key if it's the GPT-OSS model, otherwise use the general NVIDIA key
        current_api_key = GPTOSS_API_KEY if "gpt-oss" in NVIDIA_MODEL_NAME and GPTOSS_API_KEY else NVIDIA_API_KEY

        headers = {
            "Authorization": f"Bearer {current_api_key}",
            "Accept": "text/event-stream" if stream else "application/json",
            "Content-Type": "application/json"
        }

        # Parameters for different NVIDIA models
        # Base payload with defaults
        payload = {
            "model": NVIDIA_MODEL_NAME,
            "messages": messages,
            "max_tokens": data.get("max_tokens", 16384),
            "temperature": data.get("temperature", 1.0),
            "top_p": data.get("top_p", 1.0),
            "stream": stream
        }

        # Model-specific overrides
        m_lower = NVIDIA_MODEL_NAME.lower()
        if "nemotron" in m_lower:
            payload.update({
                "temperature": 1.0,
                "top_p": 0.95,
                "chat_template_kwargs": {"enable_thinking": False},
                "reasoning_budget": 16384
            })
        elif "mistral" in m_lower or "nvidia" in m_lower:
            payload.update({
                "temperature": 0.1,
                "reasoning_effort": "high"
            })
        elif "gemma" in m_lower:
            payload.update({
                "top_p": 0.95,
                "chat_template_kwargs": {"enable_thinking": True}
            })
            
        invoke_url = f"{NVIDIA_API_URL}/chat/completions"
        print(f">>> Sending request to: {invoke_url}")
        print(f">>> Model: {NVIDIA_MODEL_NAME}")
        # print(f">>> Payload: {json.dumps(payload, indent=2, ensure_ascii=False)}")

        try:
            # Force stream=True internally to show progress in server console
            payload["stream"] = True
            response = requests.post(invoke_url, headers=headers, json=payload, stream=True, timeout=120)
            print(f"<<< NVIDIA Response Status: {response.status_code}")
            
            if response.status_code != 200:
                error_text = response.text
                print(f"!!! NVIDIA API Error ({response.status_code}): {error_text}")
                return jsonify({
                    "error": f"NVIDIA API 錯誤 ({response.status_code})",
                    "details": error_text[:500]
                }), response.status_code

            collected_content = []
            collected_reasoning = []
            last_chunk = None

            def generate():
                nonlocal last_chunk
                try:
                    for line in response.iter_lines():
                        if line:
                            decoded_line = line.decode("utf-8")
                            if decoded_line.startswith("data: "):
                                if "[DONE]" in decoded_line:
                                    break
                                try:
                                    chunk = json.loads(decoded_line[6:])
                                    if not chunk.get('choices'):
                                        continue
                                    last_chunk = chunk
                                    delta = chunk['choices'][0]['delta']
                                    
                                    # Handle Reasoning
                                    reasoning = delta.get('reasoning_content', '')
                                    if reasoning:
                                        print(reasoning, end="", flush=True)
                                        collected_reasoning.append(reasoning)
                                    
                                    # Handle Content
                                    content = delta.get('content', '')
                                    if content:
                                        print(content, end="", flush=True)
                                        collected_content.append(content)
                                    
                                    if stream: # If client wants stream, yield it
                                        yield line + b"\n\n"
                                except: pass
                    print("\n<<< [DEBUG] COMPLETED\n")
                except Exception as e:
                    print(f"\n!!! Stream Error: {e}")

            if stream:
                return Response(generate(), mimetype='text/event-stream')
            else:
                # For non-streaming clients, consume the generator and then return JSON
                for _ in generate(): pass
                
                if last_chunk:
                    # Construct a full response object
                    full_text = "".join(collected_content)
                    full_reasoning = "".join(collected_reasoning)
                    
                    last_chunk['choices'][0]['message'] = {
                        "role": "assistant",
                        "content": full_text,
                        "reasoning_content": full_reasoning
                    }
                    del last_chunk['choices'][0]['delta']
                    return jsonify(last_chunk)
                else:
                    return jsonify({"error": "No response from API"}), 502
        except requests.exceptions.Timeout:
            print("!!! NVIDIA API Timeout after 60s")
            return jsonify({"error": "NVIDIA API 連線逾時 (60s)", "details": "伺服器回應過慢，請稍後再試。"}), 504
        except Exception as e:
            print(f"!!! Proxy Error: {e}")
            return jsonify({"error": str(e)}), 500

@app.route("/")
def home():
    return f"""
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>LLM Proxy 伺服器控制台</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
        <style>
            :root {{
                --bg: #0a0a0c;
                --card-bg: #141417;
                --accent: #c8a96e;
                --text: #e0e0e0;
                --text-dim: #a0a0a0;
                --code-bg: #1d1d21;
            }}
            body {{
                font-family: 'Outfit', sans-serif;
                background-color: var(--bg);
                color: var(--text);
                margin: 0;
                display: flex;
                justify-content: center;
                padding: 40px 20px;
                line-height: 1.6;
            }}
            .container {{
                max-width: 900px;
                width: 100%;
            }}
            header {{
                text-align: center;
                margin-bottom: 60px;
            }}
            h1 {{
                font-size: 3rem;
                font-weight: 700;
                margin-bottom: 10px;
                background: linear-gradient(135deg, #fff 0%, var(--accent) 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }}
            .status-badge {{
                display: inline-block;
                padding: 6px 16px;
                background: rgba(200, 169, 110, 0.1);
                border: 1px solid var(--accent);
                color: var(--accent);
                border-radius: 999px;
                font-size: 0.9rem;
                font-weight: 600;
            }}
            .card {{
                background: var(--card-bg);
                border-radius: 24px;
                padding: 40px;
                margin-bottom: 30px;
                box-shadow: 0 20px 40px rgba(0,0,0,0.3);
                border: 1px solid rgba(255,255,255,0.05);
            }}
            h2 {{
                font-size: 1.5rem;
                color: var(--accent);
                margin-top: 0;
                margin-bottom: 24px;
                display: flex;
                align-items: center;
            }}
            h2::before {{
                content: '';
                display: inline-block;
                width: 4px;
                height: 24px;
                background: var(--accent);
                margin-right: 12px;
                border-radius: 2px;
            }}
            pre {{
                background: var(--code-bg);
                padding: 24px;
                border-radius: 16px;
                overflow-x: auto;
                font-family: 'Fira Code', monospace;
                font-size: 0.95rem;
                border: 1px solid rgba(255,255,255,0.05);
                color: #d1d1d1;
            }}
            .endpoint-tag {{
                background: #2e7d32;
                color: #fff;
                padding: 2px 8px;
                border-radius: 4px;
                font-size: 0.8rem;
                margin-right: 8px;
                font-weight: 700;
            }}
            code {{
                background: rgba(255,255,255,0.1);
                padding: 2px 6px;
                border-radius: 4px;
                color: var(--accent);
            }}
            .grid {{
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 20px;
            }}
            .stat-item {{
                background: rgba(255,255,255,0.03);
                padding: 20px;
                border-radius: 16px;
                text-align: center;
            }}
            .stat-value {{
                font-size: 1.2rem;
                font-weight: 700;
                color: #fff;
            }}
            .stat-label {{
                font-size: 0.85rem;
                color: var(--text-dim);
                margin-top: 4px;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <header>
                <h1>LLM Proxy Console</h1>
                <div class="status-badge">伺服器運行中 (Port: {PORT})</div>
            </header>

            <div class="card">
                <h2>系統資訊</h2>
                <div class="grid">
                    <div class="stat-item">
                        <div class="stat-value">{'LOCAL HF' if USE_LOCAL_VLLM else 'NVIDIA API'}</div>
                        <div class="stat-label">處理模式</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">{NVIDIA_MODEL_NAME}</div>
                        <div class="stat-label">當前模型</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">120.0s</div>
                        <div class="stat-label">連線逾時</div>
                    </div>
                </div>
            </div>

            <div class="card">
                <h2>API 端點</h2>
                <p>本伺服器提供符合 OpenAI 標準的 API 接口：</p>
                <p><code><span class="endpoint-tag">POST</span> http://127.0.0.1:{PORT}/v1/chat/completions</code></p>
                <p>您可以直接在閱讀助手或校對系統中將 API Base URL 設為 <code>http://127.0.0.1:{PORT}/v1</code>。</p>
            </div>

            <div class="card">
                <h2>使用範例 (Python)</h2>
                <pre>import openai

client = openai.OpenAI(
    base_url="http://127.0.0.1:{PORT}/v1",
    api_key="anything"
)

response = client.chat.completions.create(
    model="{NVIDIA_MODEL_NAME}",
    messages=[{{"role": "user", "content": "你好"}}],
    stream=True
)

for chunk in response:
    print(chunk.choices[0].delta.content or "", end="")</pre>
            </div>
            
            <div class="card" style="border: 1px solid rgba(200, 169, 110, 0.2);">
                <h2>開發者備註</h2>
                <p style="color: var(--text-dim); font-size: 0.95rem;">
                    本伺服器作為 NVIDIA API 或本地 HuggingFace 模型的中轉站，主要處理<b>繁簡體轉換校對</b>任務的特殊需求（如：串流輸出、超長內容處理與自動重試邏輯）。
                </p>
            </div>
        </div>
    </body>
    </html>
    """

if __name__ == "__main__":
    print(f"Mode: {'LOCAL HF' if USE_LOCAL_VLLM else 'NVIDIA API'}")
    print(f"Server running on http://127.0.0.1:{PORT}")
    app.run(host="127.0.0.1", port=PORT, threaded=True)
