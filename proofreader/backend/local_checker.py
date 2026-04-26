import re
from opencc import OpenCC

# Initialize OpenCC (s2t: Simplified to Traditional)
# You can also use s2twp (Simplified to Traditional Taiwan with Phrases)
s2t = OpenCC('s2t')
s2twp = OpenCC('s2twp')

def run_local_checks(text: str) -> list[dict]:
    """
    Performs local rule-based checks:
    1. Simplified to Traditional Chinese conversion.
    2. Common punctuation normalization.
    """
    issues = []
    
    # 1. Check for Simplified Chinese characters
    # We compare line by line or chunk by chunk to maintain context
    lines = text.splitlines(keepends=True)
    offset = 0
    
    for line in lines:
        # Use s2twp for Taiwan terminology if preferred, or s2t for standard
        converted = s2twp.convert(line)
        
        if converted != line:
            # Find differences and create issues
            # We use a simple diffing approach for single characters/phrases
            # For brevity, we'll mark the whole changed segments
            
            # Simple heuristic: find contiguous segments of change
            i = 0
            while i < len(line):
                if line[i] != converted[i]:
                    start = i
                    # Find end of this change segment
                    while i < len(line) and line[i] != converted[i]:
                        i += 1
                    end = i
                    
                    orig_segment = line[start:end]
                    sugg_segment = converted[start:end]
                    
                    # Provide context (10 chars before/after)
                    ctx_start = max(0, start - 10)
                    ctx_end = min(len(line), end + 10)
                    context = line[ctx_start:ctx_end].replace("\n", " ")
                    
                    issues.append({
                        "id": f"L{len(issues)+1:03d}",
                        "type": "簡繁轉換",
                        "original": orig_segment,
                        "suggestion": sugg_segment,
                        "context": context,
                        "reason": "偵測到簡體字或非標準繁體詞彙，建議轉換。",
                        "confidence": 1.0,
                        "start": offset + start,
                        "end": offset + end
                    })
                else:
                    i += 1
        
        offset += len(line)
        
    return issues
