"""tools.py dışındaki araç modülleri. Her modül TOOLS, EXECUTORS, LABELS ve LABELS_EN tanımlar; tools.py hepsini kaydeder.
Yeni araç grubu buraya eklenir. Sıra sabit kalmalı: araç listesi istem önbelleğinin (prompt caching) parçasıdır."""
from app.assistant import memory
from app.assistant.toolsets import bulk, costs, digital, market, pricing, rank, reviews, rewrite, social, values

MODULES = (memory, costs, reviews, rank, market, pricing, social, digital, bulk, rewrite, values)
