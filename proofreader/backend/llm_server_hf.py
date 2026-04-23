import os
import torch
from flask import Flask, request, jsonify
from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig, TextStreamer

# CONFIG
MODEL_PATH = r"C:\Users\user\Downloads\novel\Model"
PORT = 8000

app = Flask(__name__)

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

@app.route("/v1/chat/completions", methods=["POST"])
def chat_completions():
    data = request.json
    messages = data.get("messages", [])
    
    # Debug print: Request
    print("\n" + "="*50)
    print("RECEIVED REQUEST")
    for m in messages:
        role = m['role'].upper()
        content = m['content']
        display_content = content[:100] + "..." if len(content) > 100 else content
        print(f"[{role}]: {display_content}")
    print("-" * 50)
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

if __name__ == "__main__":
    print(f"HF Flask Server running on http://127.0.0.1:{PORT}")
    app.run(host="127.0.0.1", port=PORT, threaded=True)
