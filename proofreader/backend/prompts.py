"""
Prompts for the LLM – all tasks in Traditional Chinese.
Every prompt function returns a list[dict] (OpenAI messages format).
"""
from textwrap import dedent


# ── 1. Error marking ────────────────────────────────────────────────────────────

def mark_errors_prompt(text: str, rag_context: str = "") -> list[dict]:
    system = dedent("""
        你是一位專業的中文小說校對助手。你的工作是「標記問題」，絕對不可直接修改原文。

        你需要找出以下類型的問題：
        1. 錯別字（typo）：明顯的字形錯誤
        2. 人名不一致（name）：同一角色出現多種不同寫法
        3. 語義異常（semantic）：詞序混亂、搭配不當
        4. 雜訊內容（noise）：本章完、廣告、來源標記、作者後記等非小說段落

        輸出格式必須是合法 JSON，結構如下：
        {
          "issues": [
            {
              "id": "唯一識別字串",
              "type": "錯字 | 人名 | 語意 | 雜訊",
              "original": "原文字串",
              "suggestion": "建議修改內容（若無建議則為空字串）",
              "start": 整數,
              "end": 整數,
              "reason": "問題說明",
              "confidence": 0.0到1.0的浮點數
            }
          ]
        }

        重要規則：
        - start 和 end 是在輸入文字中的字元偏移量（0-indexed）
        - 「絕對不可勉強」：如果文字本身是正確的，不需要為了找錯誤而標記。若無問題，請回傳 {"issues": []}
        - 只標記「確定」的錯誤，若只是風格不同則忽略。
        - 只輸出 JSON，不要有任何前言或解釋
    """).strip()

    user_parts = [f"請標記以下文本的問題：\n\n{text}"]
    if rag_context:
        user_parts.append(rag_context)

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
            "角色名稱": "正式名稱",
            "別名": ["其他稱呼列表"],
            "身份": "功能性身份（如：主角、大師姐、反派）",
            "性格特徵": ["特徵1", "特徵2"],
            "能力": ["能力或技能"],
            "人際關係": ["角色A(關係說明)", "角色B(關係說明)"],
            "角色描述": "簡短且精確的人物小傳（用於閱讀助手彈窗顯示）"
          }
        ]

        禁止：
        - 不可虛構文本中未出現的角色
        - 不確定的資訊請省略該欄位
        - 只輸出 JSON，不要有任何前言
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
        你是一位專業的中文小說分析助手。請從以下文本中抽取所有重要劇情事件。

        輸出格式必須是合法 JSON 陣列：
        [
          {
            "事件名稱": "簡短名稱",
            "事件描述": "詳細說明（2-3句話）",
            "涉及角色": ["角色名稱列表"],
            "章節": "章節號或名稱",
            "重要性": "高 | 中 | 低"
          }
        ]

        禁止：
        - 不可虛構事件
        - 只抽取明確在文本中發生的事件
        - 只輸出 JSON，不要有任何前言
    """).strip()

    user = f"章節：{chapter}\n\n請抽取以下文本的劇情事件：\n\n{text}"
    if rag_context:
        user += "\n" + rag_context

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
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
        你是一位專業的小說分析助手。請根據提供的多個文本片段，總結這部小說的「全書大綱」或「目前劇情摘要」。
        請以 300-500 字左右進行敘述。包含主線劇情、世界觀設定與目前的進度。

        輸出格式：純文字描述。
    """).strip()
    user = "以下是小說的各個片段：\n\n" + "\n\n---\n\n".join(text_chunks)
    if rag_context:
        user += "\n" + rag_context
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
