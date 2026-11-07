package io.github.rotfarmer.converter;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.os.SystemClock;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.common.model.DownloadConditions;
import com.google.mlkit.common.model.RemoteModelManager;
import com.google.mlkit.nl.languageid.LanguageIdentification;
import com.google.mlkit.nl.languageid.LanguageIdentificationOptions;
import com.google.mlkit.nl.languageid.LanguageIdentifier;
import com.google.mlkit.nl.translate.TranslateLanguage;
import com.google.mlkit.nl.translate.TranslateRemoteModel;
import com.google.mlkit.nl.translate.Translation;
import com.google.mlkit.nl.translate.Translator;
import com.google.mlkit.nl.translate.TranslatorOptions;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions;
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions;
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * On-device text reading and translation for the web app (js/ocr.js, js/translate.js), with Google's ML Kit: much
 * faster and more accurate than reading text inside the web page. Photos never leave the phone; the only download
 * is a language's translation model (about 30 MB), the first time that language is translated.
 *
 * Nothing here may throw into Capacitor (it would close the app): every method catches and rejects instead.
 */
@CapacitorPlugin(name = "Vision")
public class VisionPlugin extends Plugin {

    private static final List<String> SCRIPTS = Arrays.asList("latin", "chinese", "japanese", "korean", "devanagari");

    private final Map<String, TextRecognizer> recognizers = new HashMap<>();
    private final Map<String, Translator> translators = new HashMap<>();
    private final Set<String> downloading = new HashSet<>();
    private LanguageIdentifier identifier;

    /** What this app can do on the device: the scripts it reads, and translation. */
    @PluginMethod
    public void info(PluginCall call) {
        JSObject result = new JSObject();
        result.put("scripts", new JSArray(SCRIPTS));
        result.put("translate", true);
        call.resolve(result);
    }

    /**
     * Reads the text in a JPEG (base64). Each script's reader also reads Latin letters and digits, so prices come
     * out of any of them. Lines come back with boxes in the image's pixels, like the web reader's.
     */
    @PluginMethod
    public void recognize(PluginCall call) {
        try {
            String script = call.getString("script", "latin");
            byte[] bytes = Base64.decode(call.getString("image", ""), Base64.DEFAULT);
            Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bitmap == null) {
                call.reject("Couldn't open the picture");
                return;
            }
            long start = SystemClock.elapsedRealtime();
            recognizer(script).process(InputImage.fromBitmap(bitmap, 0))
                .addOnSuccessListener(text -> {
                    try {
                        JSObject result = new JSObject();
                        result.put("width", bitmap.getWidth());
                        result.put("height", bitmap.getHeight());
                        result.put("script", script);
                        result.put("ms", SystemClock.elapsedRealtime() - start);
                        result.put("lines", lines(text));
                        call.resolve(result);
                    } catch (Throwable t) {
                        CrashLog.caught(getContext(), "read text", t);
                        call.reject("Couldn't read the text");
                    }
                })
                .addOnFailureListener(e -> call.reject("Couldn't read the text: " + e.getMessage()));
        } catch (Throwable t) {
            CrashLog.caught(getContext(), "read text", t);
            call.reject("Couldn't read the text");
        }
    }

    private synchronized TextRecognizer recognizer(String script) {
        String key = SCRIPTS.contains(script) ? script : "latin";
        TextRecognizer recognizer = recognizers.get(key);
        if (recognizer == null) {
            switch (key) {
                case "chinese":
                    recognizer = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
                    break;
                case "japanese":
                    recognizer = TextRecognition.getClient(new JapaneseTextRecognizerOptions.Builder().build());
                    break;
                case "korean":
                    recognizer = TextRecognition.getClient(new KoreanTextRecognizerOptions.Builder().build());
                    break;
                case "devanagari":
                    recognizer = TextRecognition.getClient(new DevanagariTextRecognizerOptions.Builder().build());
                    break;
                default:
                    recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
            }
            recognizers.put(key, recognizer);
        }
        return recognizer;
    }

    private static JSArray lines(Text text) {
        JSArray out = new JSArray();
        for (Text.TextBlock block : text.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                Rect box = line.getBoundingBox();
                if (box == null) continue;
                JSObject entry = new JSObject();
                entry.put("text", line.getText());
                entry.put("bbox", box(box));
                entry.put("confidence", Math.round(line.getConfidence() * 100));
                entry.put("angle", (double) line.getAngle());
                entry.put("lang", line.getRecognizedLanguage());
                JSArray words = new JSArray();
                for (Text.Element element : line.getElements()) {
                    Rect wordBox = element.getBoundingBox();
                    if (wordBox == null) continue;
                    JSObject word = new JSObject();
                    word.put("text", element.getText());
                    word.put("bbox", box(wordBox));
                    word.put("confidence", Math.round(element.getConfidence() * 100));
                    words.put(word);
                }
                entry.put("words", words);
                out.put(entry);
            }
        }
        return out;
    }

    private static JSObject box(Rect rect) {
        JSObject box = new JSObject();
        box.put("x0", rect.left);
        box.put("y0", rect.top);
        box.put("x1", rect.right);
        box.put("y1", rect.bottom);
        return box;
    }

    /**
     * Translates lines on the device. If the languages' models aren't downloaded yet, this starts downloading them
     * and answers { status: "downloading" } straight away, so the web app can use the online translator meanwhile.
     * Languages it can't translate answer { status: "unsupported" }.
     */
    @PluginMethod
    public void translate(PluginCall call) {
        try {
            String from = TranslateLanguage.fromLanguageTag(base(call.getString("from", "")));
            String to = TranslateLanguage.fromLanguageTag(base(call.getString("to", "")));
            JSArray texts = call.getArray("texts", new JSArray());
            if (from == null || to == null) {
                call.resolve(status("unsupported"));
                return;
            }
            String key = from + ">" + to;
            Translator translator = translator(key, from, to);
            RemoteModelManager models = RemoteModelManager.getInstance();
            Task<Boolean> hasFrom = models.isModelDownloaded(new TranslateRemoteModel.Builder(from).build());
            Task<Boolean> hasTo = models.isModelDownloaded(new TranslateRemoteModel.Builder(to).build());
            Tasks.whenAllComplete(hasFrom, hasTo).addOnCompleteListener(done -> {
                // English is part of every translation and always on the device.
                boolean ready = (TranslateLanguage.ENGLISH.equals(from) || downloaded(hasFrom))
                    && (TranslateLanguage.ENGLISH.equals(to) || downloaded(hasTo));
                if (!ready) {
                    download(key, translator);
                    call.resolve(status("downloading"));
                    return;
                }
                List<Task<String>> tasks = new ArrayList<>();
                for (int i = 0; i < texts.length(); i++) tasks.add(translator.translate(texts.optString(i, "")));
                Tasks.<String>whenAllSuccess(tasks)
                    .addOnSuccessListener(results -> {
                        JSObject result = status("done");
                        result.put("translations", new JSArray(results));
                        call.resolve(result);
                    })
                    .addOnFailureListener(e -> call.reject("Couldn't translate: " + e.getMessage()));
            });
        } catch (Throwable t) {
            CrashLog.caught(getContext(), "translate", t);
            call.reject("Couldn't translate");
        }
    }

    private static boolean downloaded(Task<Boolean> check) {
        return check.isSuccessful() && Boolean.TRUE.equals(check.getResult());
    }

    private synchronized Translator translator(String key, String from, String to) {
        Translator translator = translators.get(key);
        if (translator == null) {
            translator = Translation.getClient(new TranslatorOptions.Builder().setSourceLanguage(from).setTargetLanguage(to).build());
            translators.put(key, translator);
        }
        return translator;
    }

    /** Downloads a language pair's models in the background (any connection; about 30 MB per language). */
    private synchronized void download(String key, Translator translator) {
        if (downloading.contains(key)) return;
        downloading.add(key);
        translator.downloadModelIfNeeded(new DownloadConditions.Builder().build())
            .addOnCompleteListener(task -> {
                synchronized (VisionPlugin.this) {
                    downloading.remove(key);
                }
            });
    }

    /** The language of some text (a tag such as "fr"), or null when it can't tell. */
    @PluginMethod
    public void identify(PluginCall call) {
        try {
            String text = call.getString("text", "");
            languageIdentifier().identifyLanguage(text)
                .addOnSuccessListener(tag -> {
                    JSObject result = new JSObject();
                    if (tag != null && !"und".equals(tag)) result.put("lang", tag);
                    call.resolve(result);
                })
                .addOnFailureListener(e -> call.resolve(new JSObject()));
        } catch (Throwable t) {
            CrashLog.caught(getContext(), "identify language", t);
            call.resolve(new JSObject());
        }
    }

    private synchronized LanguageIdentifier languageIdentifier() {
        if (identifier == null) {
            identifier = LanguageIdentification.getClient(new LanguageIdentificationOptions.Builder().setConfidenceThreshold(0.5f).build());
        }
        return identifier;
    }

    private static JSObject status(String status) {
        JSObject result = new JSObject();
        result.put("status", status);
        return result;
    }

    private static String base(String tag) {
        String lower = tag == null ? "" : tag.toLowerCase();
        int dash = lower.indexOf('-');
        return dash > 0 ? lower.substring(0, dash) : lower;
    }
}
