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
        - **重要：內容一致性**：提供的 `original` 必須**完全等於**原文中的字符序列（包含繁簡體、標點）。
        - **上下文 (context) 必須唯一**：提供的 `context` 必須是原文中的連續片段（建議 10-20 字），且不可自行修正或翻譯 context 中的文字。
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
        你是一位專業的小說分析助手。請從以下文本中抽取「重要角色」。

        重要規則：
        1. **絕對禁令：過濾路人**。嚴禁抽取路人、過客、或是沒有正式姓名的小角色。例如「蒙面青年」、「長袍男子」、「路人甲」、「某職員」等背景角色**一律不准記錄**。
        2. **抽取標準**：只記錄有具體姓名、或對當前及未來劇情有重大推動作用的角色。必須是「本章實際登場且有具體作為或對話」的重要人物。不可憑空腦補未在本文中展現的能力或特徵。
        3. **資訊格式**：
            - 「角色名稱」：正式名稱（繁體）。
            - 「別名」：外號、曾用名。
            - 「身份」：頭銜、所屬勢力。
            - 「性格特徵」：關鍵詞列表。
            - 「能力」：技能或天賦（僅限本文有提及）。
            - 「人際關係」：與其他角色的關係，格式為「角色名(關係)」。
            - 「角色描述」：一段約 50-100 字的綜述（繁體）。
            
        4. 輸出格式必須是合法 JSON 陣列：
        [
          {
            "角色名稱": "正式名稱（請用繁體中文）",
            "別名": ["其他稱呼列表"],
            "身份": "功能性身份（如：主角、大師姐、反派）",
            "性格特徵": ["特徵1", "特徵2"],
            "能力": ["能力或技能"],
            "人際關係": ["角色A(關係說明)", "角色B(關係說明)"],
            "角色描述": "人物特徵與傳記（請用繁體中文）。"
          }
        ]
        5. **全繁體中文**。
    """).strip()

    user = f"請分析以下文本的角色：\n\n{text}"
    if rag_context:
        user += "\n" + rag_context

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def merge_characters_prompt(existing_chars_json: str, new_chars_json: str) -> list[dict]:
    system = dedent("""
        你是一位專業的小說資料庫管理員。請將「新抽取的角色資料」整合進「既有的角色總表」中。

        整合與去重規則：
        1. **識別重複與合併**：如果新資料與總表描述的是同一人，必須合併。判斷是否為同一人時，請綜合考量姓名、別名、身份與人際關係。如果兩者有任何關聯暗示為同一人，請進行資料合併。
        2. **豐富描述**：合併時請保留最豐富的描述，將短描述與長描述結合，不要丟失先前的設定細節。
        3. **處理姓名變體/錯別字**：特別注意「音同字不同」的變體或常見錯字（例如「穆白」與「慕白」）。如果背景資料、人際關係或描述內容顯示為同一人，**必須視為同一個角色**，並統一人選中「最正確」的寫法作為主名稱。
        4. **標準化人際關係**：在「人際關係」欄位中，提到的其他角色也必須統一人名（例如將關係中的「慕白」改為標準的「穆白」）。
        5. **清理雜質**：如果新資料中仍混入了「路人」或「背景板角色」（無姓名、無主線價值），請在此步驟將其徹底刪除。
        6. **全繁體中文**：所有輸出內容必須使用繁體中文。
        7. 只輸出 JSON 陣列。
    """).strip()

    user = f"【既有角色總表】：\n{existing_chars_json}\n\n【本章新抽取資料】：\n{new_chars_json}"

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def global_consolidate_characters_prompt(all_chars_json: str) -> list[dict]:
    system = dedent("""
        你是一位卓越的小說編輯與資料專家。請對以下「角色資料列表」進行深度的全局整理與去重。
        
        任務目標：
        1. **徹底去重**：找出列表中所有指向同一個人物的條目。特別注意人名變體（如「葉心夏」與「心夏」）、錯別字（如「穆白」與「慕白」）、以及不同章節中對同一人物的不同描述。嚴格執行去重，絕對不要留下同名或別名的重複項目。
        2. **智慧合併**：將重複角色的「性格特徵」、「能力」、「人際關係」與「角色描述」進行完美整合。描述應涵蓋角色的完整發展，並保持語言流暢、繁體中文。若有多個階段的描述，請綜合整理成一段連貫的人物傳記。
        3. **人際關係標準化**：確保所有「人際關係」中提到的人名，都對應到整理後的標準名稱。
        4. **剔除路人**：再次檢查並移除任何沒有正式姓名或對劇情毫無影響的背景角色（如：抽菸青年、長袍男子等）。
        
        輸出格式：
        - 必須是合法的 JSON 陣列。
        - 每個物件包含：角色名稱、別名(Array)、身份、性格特徵(Array)、能力(Array)、人際關係(Array)、角色描述。
        - 全繁體中文。
    """).strip()
    user = f"【待整理角色列表】：\n{all_chars_json}"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


# ── 3. Plot events extraction ────────────────────────────────────────────────────

def extract_events_prompt(text: str, chapter: str = "") -> list[dict]:
    system = dedent("""
        你是一位小說史官與劇情架構分析師。
        你的任務是從「最新章節」中抽取對「全書主線」具有長期影響的極少數「里程碑事件」。
        
        重要指令：
        - **極高篩選門檻**：只記錄足以列入「全書大綱」的重大轉折。例如：獲得關鍵神裝、晉升新境界、生死大戰、重要盟友/敵人結交、核心真相揭曉。
        - **排除一切過場**：跳過日常對話、一般的劇情推進。如果一章只是在趕路或小打小鬧，請直接輸出 `[]`。
        - **預期數量**：每章通常只有 0 到 2 個事件。嚴禁將章節內容按順序拆解成多個小事件。
        - **精簡描述**：每項描述約 30-60 字，繁體中文。

        輸出格式必須是合法 JSON 陣列：
        [
          {
            "事件名稱": "里程碑動作（繁體，5-10字內）",
            "事件描述": "該事件對全書主線的實質影響（繁體）",
            "涉及角色": ["核心角色A", "核心角色B"],
            "章節": "章節名稱",
            "重要性": "高" 
          }
        ]

        規則：
        - 如果該章節沒有「里程碑級」進展，請輸出 `[]`。
        - 只輸出 JSON。
    """).strip()

    user = f"【最新章節內容（{chapter}）】：\n{text}"

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
        你是一位具備上帝視角的小說主編。請從提供的章節片段中，提煉出足以影響全書走向的「核心劇情點」。

        過濾準則：
        1. 忽略：日常對話、過度細節的戰鬥描述、重複性的修煉過程、對主線無關鍵影響的配角戲份。
        2. 聚焦：世界觀的重大擴張（如新地圖、新設定）、主角的階級跨越或實力提升、核心角色關係的根本轉折、關鍵伏筆的出現。

        輸出規範：
        - 以極簡的文字（約 50-200 字內）回答：「本章發生了什麼對全書重要的事？」
        - 使用繁體中文，純文字輸出，不需前言。
    """).strip()
    user = "以下是小說的各個片段：\n\n" + "\n\n---\n\n".join(text_chunks)
    if rag_context:
        user += "\n" + rag_context
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


# ── 7. Aggregate Novel Summary ──────────────────────────────────────────────────

def aggregate_summary_prompt(text_chunks: list[str], existing_summary: str = "") -> list[dict]:
    """
    Consolidate multiple chapter summaries into a single novel-level summary.
    If an existing aggregate summary is provided, update it rather than starting fresh.
    """
    system = dedent("""
        你是一位極其專業的小說大綱精煉大師。
        任務：將多段「章節進度」或「區段摘要」整合進一份「最終全書總大綱」中。
        
        核心準則：
        1. **智慧化濃縮與重組**：你的目標是將百萬字的故事精煉成數千至一萬字的高質量大綱。不要只是將各章節摘要機械式拼接，必須以「起承轉合」的結構重新編排，融合成一個流暢的完整故事大綱。請大膽刪減非核心的對話、重複性的戰鬥或過場描述。
        2. **保留核心靈魂**：必須保留「核心衝突」、「角色成長/覺醒」、「重大劇情轉折」以及「關鍵伏筆」。著重於主線發展、角色關係變化以及世界觀揭露。
        3. **上下文連貫**：確保大綱讀起來脈絡清晰，人物動機與故事發展邏輯一致。
        4. **接續與覆蓋**：請在既有基礎上，根據新進度進行「增補」與「同步優化」，確保全書結構平衡。
        5. **純文字輸出**：只輸出最終的大綱內容，不要包含 JSON、標題、或是「以下是整合後的大綱」之類的無意義前言。
        
        輸出語言：繁體中文。
    """).strip()

    user = "【待整合與精煉的劇情摘要片段清單】：\n\n" + "\n\n".join(text_chunks)
    
    if existing_summary:
        user = "【參考背景 / 既有大綱基礎】：\n" + existing_summary + "\n\n" + user

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
