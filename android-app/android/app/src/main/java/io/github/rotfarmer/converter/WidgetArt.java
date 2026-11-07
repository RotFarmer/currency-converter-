package io.github.rotfarmer.converter;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.RectF;
import android.util.Base64;
import android.util.LruCache;
import java.io.File;
import java.io.FileOutputStream;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;

/**
 * The theme's look for the widgets. The web app sends the theme's art as images (js/app.js, widgetArtPayload),
 * a light and a dark set: a backdrop that fills the widget, scenery along the bottom, a strip along the top edge
 * and corner ornaments, with the corner radius, border and font. Here the images are saved and composed into a background bitmap the
 * size of each widget, so the art fits however the widget is resized.
 */
final class WidgetArt {

    private static final String[] MODES = { "light", "dark" };
    private static final String[] LAYERS = { "backdrop", "strip", "topper", "corner" };
    /** Composed backgrounds by art id, look and size; each is up to a couple of MB, so keep a few. */
    private static final LruCache<String, Bitmap> FRAMES = new LruCache<>(8);
    private static final Map<String, Bitmap> LAYER_CACHE = new HashMap<>();
    private static String cachedArtId;

    private WidgetArt() {}

    /**
     * Saves the images the app sent, one file per look (light, dark) and layer, and returns the art's description
     * without them.
     */
    static JSONObject save(Context context, JSONObject art) throws Exception {
        JSONObject meta = new JSONObject(art.toString());
        for (String mode : MODES) {
            JSONObject layers = art.optJSONObject(mode);
            JSONObject layersMeta = meta.optJSONObject(mode);
            for (String name : LAYERS) {
                File file = file(context, mode, name);
                Object layer = layers == null ? null : layers.opt(name);
                String data = layer instanceof JSONObject ? ((JSONObject) layer).optString("png", "") : layer instanceof String ? (String) layer : "";
                if (data.isEmpty()) {
                    file.delete();
                    if (layersMeta != null) layersMeta.remove(name);
                    continue;
                }
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(Base64.decode(data, Base64.DEFAULT));
                }
                if (layer instanceof JSONObject) layersMeta.getJSONObject(name).remove("png");
                else layersMeta.put(name, true);
            }
        }
        synchronized (WidgetArt.class) {
            FRAMES.evictAll();
            LAYER_CACHE.clear();
            cachedArtId = null;
        }
        return meta;
    }

    static JSONObject meta(WidgetData data) {
        return data == null ? null : data.json.optJSONObject("artMeta");
    }

    /** The light or dark background for a widget of this size in dp, or null when the theme has no widget art. */
    static synchronized Bitmap frame(Context context, WidgetData data, int widthDp, int heightDp, boolean night) {
        JSONObject meta = meta(data);
        String mode = night ? "dark" : "light";
        JSONObject layers = meta == null ? null : meta.optJSONObject(mode);
        if (layers == null || !layers.has("backdrop")) return null;
        String id = meta.optString("id") + ":" + mode;
        // At most twice the dp size: sharp enough, and small enough to hand to the home screen.
        float scale = Math.min(context.getResources().getDisplayMetrics().density, 2f);
        // Each background stays under about 1.6 MB (two per widget from Android 12): the home screen limits how
        // much image a widget may send.
        while (scale > 1f && widthDp * scale * heightDp * scale > 400_000) scale -= 0.25f;
        int w = Math.max(1, Math.round(widthDp * scale));
        int h = Math.max(1, Math.round(heightDp * scale));
        String key = id + ":" + w + "x" + h;
        Bitmap cached = FRAMES.get(key);
        if (cached != null) return cached;

        Bitmap out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        float radius = (float) meta.optDouble("radius", 16) * scale;
        float border = (float) meta.optDouble("border", 1) * scale;
        Path clip = new Path();
        clip.addRoundRect(new RectF(0, 0, w, h), radius, radius, Path.Direction.CW);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);

        canvas.save();
        canvas.clipPath(clip);
        canvas.drawColor(data.color("bg", 0xFF040605, night));
        Bitmap backdrop = layer(context, id, mode, "backdrop");
        if (backdrop != null) drawCover(canvas, backdrop, w, h, paint);

        JSONObject strip = layers.optJSONObject("strip");
        Bitmap stripArt = strip == null ? null : layer(context, id, mode, "strip");
        if (stripArt != null) {
            // Full width, anchored to the bottom; if it would be too tall, its top is cut off.
            float fullHeight = stripArt.getHeight() * (w / (float) stripArt.getWidth());
            float shown = Math.min(fullHeight, h * (float) strip.optDouble("maxHeight", 0.45));
            int srcTop = Math.round(stripArt.getHeight() * (1 - shown / fullHeight));
            paint.setAlpha(Math.round(255 * (float) strip.optDouble("opacity", 1)));
            canvas.drawBitmap(stripArt, new Rect(0, srcTop, stripArt.getWidth(), stripArt.getHeight()), new RectF(0, h - shown, w, h), paint);
            paint.setAlpha(255);
        }

        JSONObject topper = layers.optJSONObject("topper");
        Bitmap topperArt = topper == null ? null : layer(context, id, mode, "topper");
        if (topperArt != null) {
            float th = (float) topper.optDouble("height", 8) * scale;
            float tw = topperArt.getWidth() * th / topperArt.getHeight();
            for (float x = 0; x < w; x += tw) canvas.drawBitmap(topperArt, null, new RectF(x, 0, x + tw, th), paint);
        }

        JSONObject corner = layers.optJSONObject("corner");
        Bitmap cornerArt = corner == null ? null : layer(context, id, mode, "corner");
        if (cornerArt != null) {
            float size = (float) corner.optDouble("size", 20) * scale;
            float inset = border + 2 * scale;
            RectF topLeft = new RectF(inset, inset, inset + size, inset + size);
            canvas.drawBitmap(cornerArt, null, topLeft, paint);
            canvas.save();
            canvas.scale(-1, 1, w / 2f, 0);
            canvas.drawBitmap(cornerArt, null, topLeft, paint);
            canvas.restore();
            canvas.save();
            canvas.scale(1, -1, 0, h / 2f);
            canvas.drawBitmap(cornerArt, null, topLeft, paint);
            canvas.restore();
            canvas.save();
            canvas.scale(-1, -1, w / 2f, h / 2f);
            canvas.drawBitmap(cornerArt, null, topLeft, paint);
            canvas.restore();
        }
        canvas.restore();

        drawBorder(canvas, meta.optString("borderStyle", "single"), border, radius, w, h, data.color("line", 0xFF2A5636, night), scale);
        FRAMES.put(key, out);
        return out;
    }

    private static void drawBorder(Canvas canvas, String style, float width, float radius, int w, int h, int color, float scale) {
        if (width <= 0) return;
        Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setColor(color);
        if ("bevel".equals(style)) {
            // Windows 95: light along the top and left, dark along the bottom and right, two pixels each.
            float t = Math.max(1, width / 2);
            stroke.setStrokeWidth(t);
            drawBevel(canvas, stroke, t / 2, w, h, 0xFFFFFFFF, 0xFF0A0A0A);
            drawBevel(canvas, stroke, t * 1.5f, w, h, 0xFFDFDFDF, 0xFF808080);
        } else if ("double".equals(style)) {
            float line = Math.max(1, width / 3);
            stroke.setStrokeWidth(line);
            canvas.drawRoundRect(new RectF(line / 2, line / 2, w - line / 2, h - line / 2), radius, radius, stroke);
            float inner = width - line / 2;
            float r = Math.max(0, radius - (width - line));
            canvas.drawRoundRect(new RectF(inner, inner, w - inner, h - inner), r, r, stroke);
        } else {
            stroke.setStrokeWidth(width);
            canvas.drawRoundRect(new RectF(width / 2, width / 2, w - width / 2, h - width / 2), radius, radius, stroke);
        }
    }

    private static void drawBevel(Canvas canvas, Paint stroke, float at, int w, int h, int light, int dark) {
        stroke.setColor(light);
        canvas.drawLine(at, h - at, at, at, stroke);
        canvas.drawLine(at, at, w - at, at, stroke);
        stroke.setColor(dark);
        canvas.drawLine(w - at, at, w - at, h - at, stroke);
        canvas.drawLine(w - at, h - at, at, h - at, stroke);
    }

    /** Scales the image to fill w × h and crops what sticks out. */
    private static void drawCover(Canvas canvas, Bitmap image, int w, int h, Paint paint) {
        float s = Math.max(w / (float) image.getWidth(), h / (float) image.getHeight());
        float dw = image.getWidth() * s;
        float dh = image.getHeight() * s;
        canvas.drawBitmap(image, null, new RectF((w - dw) / 2, (h - dh) / 2, (w + dw) / 2, (h + dh) / 2), paint);
    }

    private static Bitmap layer(Context context, String frameId, String mode, String name) {
        String artId = frameId.substring(0, frameId.lastIndexOf(':'));
        if (!artId.equals(cachedArtId)) {
            LAYER_CACHE.clear();
            cachedArtId = artId;
        }
        String key = mode + "-" + name;
        if (LAYER_CACHE.containsKey(key)) return LAYER_CACHE.get(key);
        File file = file(context, mode, name);
        Bitmap bitmap = file.isFile() ? BitmapFactory.decodeFile(file.getPath()) : null;
        LAYER_CACHE.put(key, bitmap);
        return bitmap;
    }

    private static File file(Context context, String mode, String name) {
        return new File(context.getFilesDir(), "widget-art-" + mode + "-" + name);
    }
}
