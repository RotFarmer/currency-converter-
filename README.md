# Currency Converter

A currency converter for your phone, with a minimal mech-HUD look in dark or light (or matching your phone's setting). Settings → Appearance also lets you pick an accent colour (presets or any colour), switch scanlines, grid and glow on or off, and choose the HUD or a clean font; **Reset to default look** brings back the original green. Set a default currency once, and every price you type in or photograph is converted to it. Foreign text in photos is translated too.

- **Home currency.** You choose it on first launch (with a suggestion from your phone's region) and it's remembered. The converter, the quick-reference table and scanned prices all convert to it.
- **"Price in" follows your location.** It's set to the currency of the country you're in: from GPS if you allow location, otherwise from your phone's time zone, which updates automatically when you travel. Picking "Price in" yourself turns this off; switch it back on in Settings.
- **Quick reference tabs.** Ready-made tables of common amounts, always shown in your home currency: one tab for your "Price in" currency and one for each currency in the ☰ drawer. Swipe left/right or tap a tab to switch; tap a row to put that amount in the converter.
- **Up to 10 other currencies.** Tap ☰ **Other currencies** between the two amounts to open a drawer with your extra currencies. Tap **+** to add one (up to 10) and **×** to remove one.
- **Type in any currency.** Every amount, including those in the ☰ drawer, can be typed into; all the others update. 0 in any of them makes them all 0.
- **Live camera.** Point the in-app camera at price tags or a menu and converted prices appear on screen as you move. Tap the shutter for a full scan with translation.
- **Scan photos.** Take a photo (or pick one) of a price tag, menu or receipt. Each price is found and covered with its converted amount, right on the photo. Tap a price to fix a misread number or change its currency.
- **Translates what it reads.** Menu items and signs are translated into your language. The **Text** view lays the translations over the photo, each price in the list shows its translated item name, and a list of every line is shown below the photo.
- **Works out the currency from the language.** Japanese text means yen, Thai means baht, Hebrew means shekels, and so on. It reads Latin-alphabet languages plus Japanese, Chinese, Korean, Thai, Hebrew, Arabic, Russian/Ukrainian, Greek and Hindi. If it guesses the language wrong, tap **LANG** to pick it.
- **Understands currency signs.** It recognises €, £, ¥, $, ₪, ₹, kr, zł, 円, 원, บาท, ש״ח, руб, codes like `USD` or `CHF`, and formats like `1.280,50 €` or `12.-`. A price without a sign uses the currency most other prices on the same photo show, then the language's currency, then your "Prices in" setting.
- **Install prompt.** On first visit it offers to install itself: a real install button on Android/Chrome, step-by-step Add to Home Screen instructions on iPhone (Apple doesn't let websites install themselves).
- **Works offline.** Install it to your home screen. Exchange rates are saved on the phone, and the text reader is cached after its first download. Translation needs a connection.
- **Private.** Text is read on the phone itself with [Tesseract.js](https://github.com/naptha/tesseract.js). Photos are never uploaded. For translation, only the recognised text is sent to the translator.

It's a web app (PWA), so it runs on iPhone and Android with no app store and no build step.

## Using it on your phone

1. Open **https://rotfarmer.github.io/currency-converter-/** in Safari (iPhone) or Chrome (Android).
2. Install it when the prompt appears, or any time with the **Install** button at the top:
   - **iPhone:** tap Share (on newer iPhones, ••• first), then **Add to Home Screen**.
   - **Android:** tap **Install**.
3. Choose your **home currency** when asked. Allow location if you'd like GPS to set the local currency (without it, the phone's time zone is used).
4. Type an amount on the **Convert** tab, or open **Scan** and use the **Live camera**. Allow camera access when asked.

The live view reads prices with a sign (¥, €, $ …) about once a second. Prices written with a local currency word, such as 1,080円, are picked up by the full scan after you tap the shutter.

Tips for scanning: get close enough that prices fill a good part of the photo, hold steady and use decent light. The first scan downloads the text reader (about 6 MB). A photo in a non-Latin script also downloads that script's model (1–3 MB) the first time.

Settings → Language has switches for translation and for guessing the currency from the language, and lets you pick the language to translate into.

## Translation

Translation runs on the phone where the browser offers a built-in translator (recent desktop Chrome). Otherwise it uses [MyMemory](https://mymemory.translated.net)'s free API, which needs no account. It allows roughly 5,000 characters a day per device, about a dozen menus. Past that, translation pauses until the next day; prices and currency detection keep working.

To get good translations the app:
- re-reads the photo with the text model for the detected language (French, Spanish, German, Japanese, Thai… about 40 languages), so accents and characters come out right;
- drops lines the text reader wasn't sure about, dot leaders and stray marks;
- translates item names printed over two lines as one phrase;
- only accepts MyMemory's stored human translations when they are for exactly that text, and otherwise uses its machine translation (its "fuzzy" matches for similar phrases are a common source of nonsense).

For a second opinion, **Open in Google Translate** sends the photo's text to Google Translate's website or app.

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
| `index.html`, `css/styles.css` | Page structure and the HUD theme (dark and light colour sets; the camera view always stays dark) |
| `js/app.js` | Screens, settings and user interaction |
| `js/camera.js` | The in-app live camera (start/stop, flashlight, grabbing frames) |
| `js/scan.js` | Photo pipeline: prices, language identification, re-reading in the right script |
| `js/ocr.js` | Prepares photos and runs Tesseract.js (loaded on demand from jsDelivr) |
| `js/price-parser.js` | Finds prices and their currencies in recognised text |
| `js/language.js` | Script models, language detection and language → currency |
| `js/layout.js` | Matches each price with its item name on the photo |
| `js/translate.js` | Translation (on-device or MyMemory) |
| `js/rates.js` | Downloads and caches exchange rates |
| `js/theme.js` | Builds the colour set for a custom accent colour (dark and light) |
| `js/currencies.js` | Currency names, symbols, decimals and the currency of each country |
| `js/location.js` | Works out the country: GPS + reverse geocoding, or the time zone |
| `js/timezones.js` | Time zone → country table (generated from the IANA time zone database) |
| `js/format.js` | Number formatting and parsing |
| `sw.js` | Service worker for offline use |
| `fonts/` | Share Tech Mono and Chakra Petch (SIL Open Font License) |
| `tests/` | Unit tests (`node --test`) |

When you change any app file, bump `VERSION` in `sw.js` and `APP_VERSION` in `js/app.js` (shown at the bottom of Settings). The app always loads the newest files when online and uses its saved copy only offline; when a new service worker takes over, open pages reload themselves once.

### How the language is identified

The English text model reads digits and common currency signs in any photo, so prices come from it first. Text in another script comes out of that model as low-confidence nonsense. When that happens, the app tries the script models on a small copy of the photo, starting with the likeliest (from currency signs it saw and your "Prices in" setting), and keeps the one that reads the text best. It then reads the photo again with that model, which also picks up local currency words like 円. Latin-alphabet languages are identified from common words and accented letters.

## Icons

`icons/icon.svg` is the source: hollow green outlines on a transparent background. The PNGs are transparent too, except the Android "maskable" icon, which has a black background because Android crops home-screen icons into its own shape. iPhones show transparent home-screen icons on black.

## Exchange rates

Rates come from [ExchangeRate-API](https://www.exchangerate-api.com)'s free endpoint, with the open [Currency API](https://github.com/fawazahmed0/exchange-api) as a backup. Neither needs an API key. Rates update once a day and are mid-market rates, so banks and card providers may charge a little more.
