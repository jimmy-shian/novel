"""
Prompts for the LLM – all tasks in Traditional Chinese.
Every prompt function returns a list[dict] (OpenAI messages format).
"""
from textwrap import dedent


# ── 1. Error marking ────────────────────────────────────────────────────────────

def mark_errors_prompt(text: str, rag_context: str = "") -> list[dict]:
    system = dedent("""
        你是一位專業的中文小說校對與編輯助手。
        你的任務是審閱最新的章節文本，找出影響閱讀體驗的錯誤，主要將簡體字修正為繁體字。
        
        標記類型：
        1. 錯別字（typo）：簡體字、錯別字、錯字、同音異義字錯誤。
        2. 人名不一致（name）：同一角色在同一章或不同章中出現寫法變異（參考提供的角色字典）。
        3. 語義異常（semantic）：邏輯矛盾、語句不通、明顯的用詞或用字錯誤。
        4. 雜訊內容（noise）：廣告連結、章節序號重複、來源網站標記。

        校對準則：
        1. 錯字修復：修正錯別字、同音字誤植、簡體字修正為繁體字、異體字修正為常用字。
        2. 人名一致性：根據提供的「角色字典」確保人名拼寫前後統一。
        3. 語意優化：修正文法錯誤或極度不通順的句子，但保留作者原有的文風。
        4. **忽略 HTML**：文本中包含 HTML 標籤（如 <p>, <div>, &nbsp; 等），這些是排版需要，**絕對不要**將其視為錯誤或進行修改。
        
        輸出規範：
        - **全繁體中文**：所有輸出的內容（包含描述、原因、建議）必須使用**繁體中文**。
        - 輸出格式必須是合法 JSON，結構如下：
        {
          "issues": [
            {
              "id": "唯一ID",
              "type": "錯字 | 人名 | 語意 | 雜訊",
              "original": "原文字串",
              "suggestion": "修正後的內容",
              "context": "包含錯誤文字的完整句子或前後片段（用於精確定位）",
              "reason": "為什麼這裡有問題？（請用繁體中文描述）",
              "confidence": 0.95
            }
          ]
        }

        重要準則：
        - **不需要計算索引**：請勿嘗試計算 start/end，只需提供正確的 `original` 與 `context`。
        - **上下文 (context) 必須唯一**：提供的 context 應足夠長（約 10-20 字），確保在文本中是唯一的。
        - **絕對不可修改原文風格**：保留作者的語氣，只修正明確的「錯誤」。
        - 參考「角色字典」來判斷人名或設定是否一致。
        - 只輸出 JSON 字串，不包含 markdown 程式碼區塊標籤。
    """).strip()

    user_parts = []
    if rag_context:
        user_parts.append(f"【角色字典】：\n{rag_context}\n")
    
    user_parts.append(f"【待校對文本】：\n{text}")

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": "\n".join(user_parts)},
    ]


# ── 2. Character extraction ─────────────────────────────────────────────────────

def extract_characters_prompt(text: str, rag_context: str = "") -> list[dict]:
    system = dedent("""
        你是一位專業的中文小說分析助手。請從以下文本中抽取所有出現的角色資料。

        輸出格式必須是合法 JSON 陣列：
        [
          {
            "角色名稱": "正式名稱（請用繁體中文）",
            "別名": ["其他稱呼列表"],
            "身份": "功能性身份（如：主角、大師姐、反派、路人甲）",
            "性格特徵": ["特徵1", "特徵2"],
            "能力": ["能力或技能"],
            "人際關係": ["角色A(關係說明)", "角色B(關係說明)"],
            "角色描述": "簡短且精確的人物描述（請用繁體中文，即使是初次登場，也請根據上下文總結其特徵）"
          }
        ]

        規則：
        - **全繁體中文**：所有輸出內容必須使用繁體中文。
        - **全面性**：只要文本中出現具體姓名、代號或具有鮮明特徵的角色（即使是過客），都必須抽取。
        - **主角優先**：請務必找出故事的核心人物，並根據當前章節更新其狀態或描述。
        - **背景融合**：結合「已知背景」判斷該角色是否為舊有角色的回歸。
        - 只輸出 JSON 陣列。
    """).strip()

    user = f"請分析以下文本的角色：\n\n{text}"
    if rag_context:
        user += "\n" + rag_context

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


# ── 3. Plot events extraction ────────────────────────────────────────────────────

def extract_events_prompt(text: str, chapter: str = "", rag_context: str = "") -> list[dict]:
    system = dedent("""
        你是一位精通小說敘事結構的分析助手。
        你的任務是從「最新章節」中抽取關鍵劇情事件，並確保這些事件能銜接「已知的歷史時間線」。

        抽取準則：
        1. 聚焦於：角色關係的重大轉變（如：結仇、和解、結盟、背叛）、重要對話、境界提升、新地標出現、關鍵物品獲得。
        2. 銜接性：如果新事件是舊事件的後續（例如：A開始閉關 -> B修練，或者A擊敗B -> A擊敗C），請在描述中體現。
        
        輸出格式必須是合法 JSON 陣列：
        [
          {
            "事件名稱": "核心動作（請用繁體中文）",
            "事件描述": "詳細描述該事件的起因、經過與結果（約 50-200 字，請用繁體中文）",
            "涉及角色": ["角色A", "角色B"],
            "章節": "章節名稱",
            "重要性": "高 | 中 | 低"
          }
        ]

        規則：
        - **全繁體中文**：所有輸出內容必須使用繁體中文。
        - **細節捕捉**：捕捉所有具備轉折意義的對話、動作或環境變化。
        - **合併同類項**：如果多個角色共同參與同一個行動（如：多人圍攻、共同對話），請將其合併為一個事件對象。
        - **敘事連續性**：確保事件描述能夠構成一個連貫的敘事流。
        - 只輸出 JSON 陣列。
    """).strip()

    user_parts = []
    if rag_context:
        user_parts.append(f"【已知歷史劇情摘要】：\n{rag_context}\n")
    
    user_parts.append(f"【最新章節內容（{chapter}）】：\n{text}")

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": "\n".join(user_parts)},
    ]


# ── 4. Timeline consolidation ────────────────────────────────────────────────────

def build_timeline_prompt(events_json: str, rag_context: str = "") -> list[dict]:
    system = dedent("""
        你是一位專業的中文小說分析助手。請整理以下劇情事件，建立完整時間線。

        輸出格式必須是合法 JSON 陣列，依劇情順序排列：
        [
          {
            "順序": 1,
            "事件名稱": "事件名稱",
            "關聯角色": ["角色1", "角色2"],
            "前後關係": "與前後事件的因果或時序關係說明"
          }
        ]

        只輸出 JSON，不要有任何前言。
    """).strip()

    user = f"請整理以下所有事件為時間線：\n\n{events_json}"
    if rag_context:
        user += "\n" + rag_context

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


# ── 5. Name normalization prompt ────────────────────────────────────────────────

def normalize_names_prompt(text: str, known_names: dict, rag_context: str = "") -> list[dict]:
    known_str = "\n".join(f"  {k} → {v}" for k, v in known_names.items()) if known_names else "（無）"
    system = dedent(f"""
        你是一位中文小說人名標準化助手。

        已知的人名對照表：
        {known_str}

        你的任務：
        1. 找出文本中所有可能是同一角色但寫法不同的名稱
        2. 輸出建議的標準化對照

        輸出格式（合法 JSON）：
        {{
          "name_map": {{
            "非標準寫法": "建議標準名稱"
          }}
        }}

        只輸出 JSON，不要有任何前言。
    """).strip()

    user = f"請分析以下文本的人名一致性：\n\n{text}"
    if rag_context:
        user += "\n" + rag_context

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


# ── 6. Story Summary ────────────────────────────────────────────────────────────

def story_summary_prompt(text_chunks: list[str], rag_context: str = "") -> list[dict]:
    system = dedent("""
        你是一位專業的小說分析助手。請根據提供的多個文本片段，總結這部小說的「目前劇情摘要」。
        請以 50-3000 字左右進行敘述。包含主線劇情、世界觀設定與目前的進度。
        若不清楚內容的情況下不需要生成與修正。
        輸出格式：純文字描述。
    """).strip()
    user = "以下是小說的各個片段：\n\n" + "\n\n---\n\n".join(text_chunks)
    if rag_context:
        user += "\n" + rag_context
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
