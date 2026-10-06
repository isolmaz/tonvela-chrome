<div align="center">

<img src="extension/icons/128.png" width="72" alt="Tonvela simgesi">

# Tonvela

**Her videoda dengeli ses.**
Sekme sesini yükselten, dengeleyen ve netleştiren Chrome eklentisi — tamamen cihazınızda çalışır.

[İndir](https://github.com/isolmaz/tonvela-chrome/releases/latest/download/Tonvela-Chrome.zip) · [Değişiklikler](CHANGELOG.md) · [Gizlilik](PRIVACY.md) · [Lisans](LICENSE)

[English](README.md) · **Türkçe**

[![CI](https://github.com/isolmaz/tonvela-chrome/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/isolmaz/tonvela-chrome/actions/workflows/ci.yml) ![Manifest V3](https://img.shields.io/badge/Manifest-V3-087f78) ![Chrome 116+](https://img.shields.io/badge/Chrome-116%2B-087f78) ![Yerel](https://img.shields.io/badge/ses-cihazda%20kal%C4%B1r-087f78)

</div>

## Nasıl çalışır

<table>
<tr>
<td width="33%" align="center"><img src="docs/media/turn-on.gif" alt="Tonvela'yı açma: anahtar ses kontrollerini ve canlı ölçeri gösterir"></td>
<td width="33%" align="center"><img src="docs/media/level.gif" alt="%400'e yükseltme, Sesi dengede tut ve geri alınabilen Bu ses seviyesini koru"></td>
<td width="33%" align="center"><img src="docs/media/settings.gif" alt="Gelişmiş ayarlar: dinleme modları, açık tema ve Türkçe arayüz"></td>
</tr>
<tr>
<td align="center"><b>1. Aç</b><br>Video sekmesinde anahtarı aç. Ölçer duyduğun sesi gösterir.</td>
<td align="center"><b>2. Yükselt ve dengele</b><br>%400'e kadar. <i>Sesi dengede tut</i> yüksek ve kısık bölümleri eşitler; <i>Bu ses seviyesini koru</i> şu an duyduğunu hedef yapar.</td>
<td align="center"><b>3. İnce ayar</b><br>Altı dinleme modu, hedef seviye, site hafızası, tema ve dil.</td>
</tr>
</table>

## Özellikler

- **%400'e kadar ses**, ileriye bakan tepe sınırlayıcıyla.
- **Sesi dengede tut:** kısık bölümler yükselir, yüksek bölümler azalır.
- **Bu ses seviyesini koru:** duyduğun seviye hedef olur; geri alınabilir.
- **Altı mod:** Normal, Sabit ses, Konuşma, Gece, Müzik ve deneysel **Sadece konuşma** (cihazda çalışan [GTCRN](https://github.com/Xiaobin-Rong/gtcrn) modeli, mono, ~50 ms gecikme).
- **Kısayollar:** <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> Tonvela'yı açar, <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> sesi değiştirir.
- **İngilizce veya Türkçe** arayüz (Gelişmiş ayarlar → Dil), koyu / açık / sistem teması.

## Kurulum

1. [`Tonvela-Chrome.zip`](https://github.com/isolmaz/tonvela-chrome/releases/latest/download/Tonvela-Chrome.zip) dosyasını indirip bir klasöre çıkar.
2. `chrome://extensions` sayfasını aç ve **Geliştirici modu**nu aç.
3. **Paketlenmemiş öğe yükle**'ye tıkla ve çıkardığın klasörü seç.
4. Bir video sekmesinde Tonvela'yı aç ve anahtarı çevir.

## Gizlilik

Ses tarayıcında işlenir ve dışarı çıkmaz. Sunucu, hesap, analiz, kayıt veya mikrofon yok. Tercihler `chrome.storage.local` içinde kalır. Ayrıntılar: [PRIVACY.md](PRIVACY.md).

## Geliştirme

Node.js 22+ ve Python 3 gerekir; eklentinin derleme adımı yoktur (`extension/` klasörünü **Paketlenmemiş öğe yükle** ile açın). CI (`.github/workflows/ci.yml`) her PR ve `main`'e her push'ta `npm run check` (lint + birim testleri) çalıştırır; aynı kontrolleri yerelde `npm run check` ile yapabilirsiniz. Tarayıcı ve ses modeli testleri CI'da çalışmaz (`npm run verify`). Komutlar ve testler için [İngilizce README](README.md#development) dosyasına bakın.

**Katkı:** `main`'e PR açın ve kullanıcıya dönük değişiklikleri [CHANGELOG.md](CHANGELOG.md) içindeki `## Unreleased` başlığı altına yazın. Sürüm numarasını değiştirmeyin; sürüm yayınlanırken belirlenir.

## Lisans

[MIT](LICENSE). Pakete dahil üçüncü taraf bileşenler (GTCRN, gtcrn-wasm, pffft) kendi lisanslarını korur; bkz. [THIRD_PARTY_NOTICES.txt](extension/THIRD_PARTY_NOTICES.txt).
