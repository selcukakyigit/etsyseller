"""Soru kalıpları: tek tanım. Sağlayıcıya giden süzgeç, sağlayıcıdan dönen kayıtların doğrulanması ve havuzdan okurken savunma aynı listeyi kullanır."""

QUESTION_WORDS = ("how", "what", "why", "when", "where", "which", "who", "can", "does", "do", "is", "are", "should", "will", "was")

# Sağlayıcı süzgeci. ÖNEMLİ: sondaki `.*` gerekli: desen "… " ile bitince sağlayıcı sondaki boşluğu kırpıyor ve "do"/"is" ile başlayan HER kelime
# ("dolphin", "islamic") soru sayılıyordu (gerçek denemede 97 sonucun ~34'ü yanlıştı).
QUESTION_REGEX = "^(" + "|".join(QUESTION_WORDS) + ") .*"


def is_question(term: str) -> bool:
    """İlk kelimesi bir soru sözcüğü olan ve en az iki kelimelik bir arama."""
    parts = term.lower().split()
    return len(parts) >= 2 and parts[0] in QUESTION_WORDS
