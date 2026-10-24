"""Kelime planı: listing metnini yazmadan ÖNCE hangi ifadenin nereye gideceğine kod karar verir; model yalnızca plana göre metni yazar.

Editördeki AI önerisi (`listings.service.generate_for_listing`) ve sohbet asistanı (`keyword_pool`, `brief_check`, `create_listing_draft`)
AYNI planı kullanır. Akış: ürün kartı (`facts`) -> adaylar (`sources`: kendi satış, Etsy verisi, rakipler, araştırma havuzu, sorular;
zayıfsa `ideas`: yapay zekâ önerisi, ölçüm kuyruğuna girer) -> uygunluk (`fit`) -> pazar şekli, açılış ifadesi, farklılık ve yerleşim (`plan`)
-> yazılan metnin denetimi (`check`). Kurallar ve gerekçeleri: docs yerine bu paketteki docstring'ler; simülasyonla sınandı (tests/listing_plan)."""
from app.listing_plan.facts import Facts
from app.listing_plan.plan import Plan, build, place_tags

__all__ = ["Facts", "Plan", "build", "place_tags"]
