# Yavuzlar Bilet Alma Uygulaması 

Bu depo iki parçadan oluşur: `php-backend/` (plain PHP API) ve `react-frontend/` (Vite + React frontend).

# Docker Compose ile Çalıştırma

Sadece `docker compose up --build` komutu ile uygulamayı çalıştırabilsin.

Erişim (varsayılan):

- Frontend: http://localhost:5173
- Backend (Swagger docs): http://localhost:8000/docs


Admin hesabı giriş bilgileri

- Email: admin@example.com
- Parola: string

Test veritabanı ve sıfırlama

- Depoda geliştirme/test amaçlı bazı örnek tablolar ve kayıtlar bulunmaktadır.
- Eğer veritabanını sıfırdan başlatmak isterseniz `php-backend/db/` dizinindeki `database.sqlite` dosyasını silip konteyneri yeniden başlatmanız yeterlidir. Docker Compose ile sıfırlamak için örnek adımlar:

```powershell
# konteynerleri durdur
docker compose down

# host makinedeki sqlite dosyasını sil (php-backend dizininde olabilir)
Remove-Item -Path .\php-backend\database.sqlite -Force

# yeniden build & up
docker compose up --build
```
