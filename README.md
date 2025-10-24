# Yavuzlar Bilet Alma Uygulaması 

Bu depo iki parçadan oluşur: `php-backend/` (plain PHP API) ve `react-frontend/` (Vite + React frontend).

# Docker Compose ile Çalıştırma

Sadece `sudo docker compose up --build` komutu ile uygulamayı çalıştırabilsin.

Erişim (varsayılan):

- Frontend: http://localhost:5173
- Backend (Swagger docs): http://localhost:8000/docs


Admin hesabı giriş bilgileri

- Email: admin@example.com
- Parola: string

Test veritabanı ve sıfırlama

- Depoda geliştirme/test amaçlı bazı örnek tablolar ve kayıtlar bulunmaktadır.
- Eğer veritabanını sıfırdan başlatmak isterseniz `php-backend/db/` dizinindeki `database.sqlite` dosyasını silip tüm containerları durdurup ilişkilendirilmiş named volume'ları da silmen yeterlidir. Docker Compose ile sıfırlamak için örnek adımlar:

```powershell
# konteynerleri durdur
sudo docker compose down

#İlişkilendirilmiş named volume'ları da sil
docker volume rm bilet-satin-alma_db-data

# host makinedeki sqlite dosyasını sil
sudo rm -f ./php-backend/database.sqlite

# yeniden build & up
sudo docker compose up --build
```
