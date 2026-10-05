"""tools.py dışındaki araç modülleri. Her modül TOOLS, EXECUTORS, LABELS ve LABELS_EN tanımlar; tools.py hepsini kaydeder.
Yeni araç grubu buraya eklenir. Sıra sabit kalmalı: araç listesi istem önbelleğinin (prompt caching) parçasıdır."""
from app.assistant import memory
from app.assistant.toolsets import costs, rank, reviews

MODULES = (memory, costs, reviews, rank)
