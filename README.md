# Bukan Twitter

Ini adalah Bukan Twitter.

Tampilannya mencurigakan seperti Twitter, cara scrollnya mencurigakan seperti Twitter,
dan mungkin bahkan memicu kebiasaan otot yang sama seperti Twitter. Namun secara
hukum, secara spiritual, dan dengan muka lurus, ini adalah Bukan Twitter.

Di balik jubahnya, ini adalah antarmuka Bluesky yang dibangun di atas AT Protocol.
Tujuannya sederhana: mempertahankan pengalaman timeline yang familiar, membuang
semua omong kosong "Aplikasi Segalanya", dan membiarkan postingan datang dari
jaringan yang tidak aktif berusaha mengubah setiap *refresh* menjadi 50 postingan
dari Elon Musk.

## Apa Ini?

Bukan Twitter adalah antarmuka depan (*frontend*) untuk Bluesky.

Tampilannya mempertahankan tata letak lama yang nyaman dan diingat orang:

- Linimasa beranda
- Profil
- Balasan
- Suka
- Repost
- Ikuti
- Eksplorasi pencarian
- Unggah gambar
- Penanda (*bookmark*) lokal dan preferensi tema

Namun datanya berasal dari Bluesky/AT Protocol, bukan dari platform yang saat ini
sibuk dengan misi sampingan sebagai aplikasi keuangan, aplikasi video, aplikasi
rekrutmen, aplikasi perbankan, dan obrolan grup publik untuk orang-orang yang
membalas "mengkhawatirkan" pada setiap postingan.

## Mengapa?

Karena kadang kamu hanya ingin pengalaman aplikasi media sosial yang lama tanpa
bau "Aplikasi Segalanya" yang baru.

Selain itu, karena membuat klien Bluesky yang terlihat seperti Twitter itu secara
objektif lucu.

## Pengembangan

Pasang dependensi:

```bash
npm install
```

Jalankan server pengembangan lokal:

```bash
npm run dev
```

Buka URL lokal yang tercetak dan masuk menggunakan *handle* atau DID Bluesky-mu.

Penerapan PDS yang dihosting sendiri atau alternatif dapat disertakan dalam
resolusi *handle* autentikasi dengan daftar yang dipisahkan koma:

```bash
NEXT_PUBLIC_ATPROTO_PDS_URLS=https://bsky.social,https://pds.example.com npm run dev
```

URL pertama digunakan sebagai PDS sesi kredensial default, dan `bsky.social`
tetap tersedia sebagai cadangan jika tidak terdaftar.

Untuk pengembangan OAuth lokal, gunakan:

```text
http://127.0.0.1:3000
```

alih-alih:

```text
http://localhost:3000
```

Token OAuth *loopback* hanya untuk pengembangan dan berumur pendek, seperti
kebanyakan rebranding.

## Ekspor Statis

Buat situs statis:

```bash
npm run export
```

Alur kerja GitHub Pages yang disertakan membangun direktori `out/` dengan
*base path* repositori yang benar dan secara otomatis menulis file metadata
klien AT Protocol OAuth yang dihosting untuk URL Pages.

Untuk penerapan non-*loopback* di luar alur kerja tersebut, atur
`NEXT_PUBLIC_ATPROTO_CLIENT_ID` ke URL metadata klien AT Protocol yang dihosting,
atau atur `NEXT_PUBLIC_SITE_URL`/`NEXT_PUBLIC_URL` agar *build* dapat
membuatnya sendiri.

## Hal Hukum yang Penting

Bukan Twitter bukan Twitter, bukan X, bukan X Corp, tidak berafiliasi dengan
Elon Musk, dan tidak bertanggung jawab atas dorongan tiba-tiba untuk memposting
"situs yang lama lebih enak."

Kata-kata bergaya Twitter mungkin masih muncul dalam basis kode karena antarmuka
aslinya menggunakannya dan karena mengganti nama setiap referensi internal `tweet`
akan menjadi cara yang sangat konyol untuk menghabiskan satu sore.

## Teknologi yang Digunakan

- Next.js
- React
- Tailwind CSS
- AT Protocol OAuth dengan PKCE/DPoP
- Bluesky API melalui `@atproto/api`
- Aset emoji Twemoji melalui [`jdecked/twemoji`](https://github.com/jdecked/twemoji)

## Cek Vibe

Jika Twitter sekarang adalah X, maka ini adalah Bukan Twitter.

Jika seseorang bertanya apakah ini hanya Twitter dengan Bluesky di dalamnya,
dengan sopan beri tahu mereka: tidak, ini bukan Twitter.
