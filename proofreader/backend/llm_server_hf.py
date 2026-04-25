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

        # Parameters for GPT-OSS-120B based on user snippet
        if "gpt-oss" in NVIDIA_MODEL_NAME:
            payload = {
                "model": NVIDIA_MODEL_NAME,
                "messages": messages,
                "max_tokens": data.get("max_tokens", 16384),
                "temperature": data.get("temperature", 0.9),
                "top_p": data.get("top_p", 1.0),
                "stream": stream
            }
        else:
            # Qwen or other model settings
            payload = {
                "model": NVIDIA_MODEL_NAME,
                "messages": messages,
                "max_tokens": data.get("max_tokens", 16384),
                "temperature": data.get("temperature", 0.60),
                "top_p": data.get("top_p", 0.95),
                "top_k": 20,
                "presence_penalty": 0,
                "repetition_penalty": 1,
                "stream": stream,
                "chat_template_kwargs": {"enable_thinking": True},
            }

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

if __name__ == "__main__":
    print(f"Mode: {'LOCAL HF' if USE_LOCAL_VLLM else 'NVIDIA API'}")
    print(f"Server running on http://127.0.0.1:{PORT}")
    app.run(host="127.0.0.1", port=PORT, threaded=True)
