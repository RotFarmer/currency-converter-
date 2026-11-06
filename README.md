# Currency Converter

A currency converter for your phone. Set a default currency once, and every price you type in or photograph is converted to it.

- **Default currency.** Pick your home currency and it's remembered. The converter, the quick-reference table and scanned prices all convert to it.
- **Scan prices with the camera.** Take a photo of a price tag, menu or receipt. Each price is found and covered with its converted amount, right on the photo. Tap a price to fix a misread number or change its currency.
- **Understands currency signs.** It recognises €, £, ¥, $, ₪, ₹, kr, zł, codes like `USD` or `CHF`, and formats like `1.280,50 €` or `12.-`. Ambiguous signs follow your "Prices in" currency, so `$` means CAD in Canada and `¥` means CNY in China. Numbers with no sign are read in your "Prices in" currency.
- **Works offline.** Install it to your home screen. Exchange rates are saved on the phone, and the text reader is cached after its first download.
- **Private.** Text is read on the phone itself with [Tesseract.js](https://github.com/naptha/tesseract.js). Photos are never uploaded.

It's a web app (PWA), so it runs on iPhone and Android with no app store and no build step.

## Using it on your phone

1. Open the app's web address in Safari (iPhone) or Chrome (Android).
2. Install it:
   - **iPhone:** tap the Share button, then **Add to Home Screen**.
   - **Android:** tap **Add to home screen** in Settings inside the app, or use Chrome's menu.
3. Choose your **default currency** and the currency **prices are in** (the local currency where you are).
4. Type an amount on the **Convert** tab, or open **Scan** and take a photo.

Tips for scanning: get close enough that prices fill a good part of the photo, hold steady and use decent light. The first scan downloads the text reader (about 6 MB). After that it works offline.

## Hosting it

The app is plain static files, so any HTTPS host works. HTTPS is required for the camera and for installing the app.

**GitHub Pages.** Free for public repositories; a private repository needs a paid GitHub plan.
1. Repository **Settings → Pages**.
2. Under *Build and deployment*, choose **Deploy from a branch**, pick the branch with this code and the `/ (root)` folder, then **Save**.
3. After a minute the app is live at `https://<username>.github.io/<repository>/`.

**Netlify or Cloudflare Pages.** Both are free and work with private repositories. Connect the repository, leave the build command empty and set the output directory to `/` (the repository root).

## Development

Requires Node.js 18 or newer. There are no dependencies to install.

```sh
npm start   # serves the app at http://localhost:8080
npm test    # runs the unit tests
```

Project layout:

| Path | What it does |
| --- | --- |
| `index.html`, `css/styles.css` | Page structure and styles (light and dark mode) |
| `js/app.js` | Screens, settings and user interaction |
| `js/price-parser.js` | Finds prices and their currencies in recognised text |
| `js/ocr.js` | Prepares photos and runs Tesseract.js (loaded on demand from jsDelivr) |
| `js/rates.js` | Downloads and caches exchange rates |
| `js/currencies.js` | Currency names, flags and decimals |
| `js/format.js` | Number formatting and parsing |
| `sw.js` | Service worker for offline use |
| `tests/` | Unit tests (`node --test`) |

When you change any app file, bump `VERSION` in `sw.js` so installed copies pick up the update.

## Exchange rates

Rates come from [ExchangeRate-API](https://www.exchangerate-api.com)'s free endpoint, with the open [Currency API](https://github.com/fawazahmed0/exchange-api) as a backup. Neither needs an API key. Rates update once a day and are mid-market rates, so banks and card providers may charge a little more.
