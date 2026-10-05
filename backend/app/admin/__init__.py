"""Yönetim paneli (/api/admin). Her alt alan (genel bakış, kullanıcılar, mesajlar, sistem) kendi modülündedir; router yalnızca
uç noktaları bağlar. Tüm uç noktalar router seviyesinde `admin_only` ile korunur, tek tek unutulamaz."""
