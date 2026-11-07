package io.github.rotfarmer.converter;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.format.DateUtils;
import android.text.style.TypefaceSpan;
import android.view.View;
import android.widget.RemoteViews;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Shared by both widgets: redrawing, the colours, tap actions and downloading fresh rates. */
final class Widgets {

    static final String ACTION_REFRESH = "io.github.rotfarmer.converter.REFRESH_RATES";
    static final String ACTION_KEY = "io.github.rotfarmer.converter.CONVERTER_KEY";
    static final String EXTRA_KEY = "key";

    private static final String RATES_URL = "https://open.er-api.com/v6/latest/USD";
    private static final long REFRESH_AFTER_MS = 3 * DateUtils.HOUR_IN_MILLIS;

    private Widgets() {}

    /** Redraws every Converter, Quick reference and Scan widget on the home screen. */
    static void renderAll(Context context) {
        AppWidgetManager manager;
        WidgetData data;
        try {
            manager = AppWidgetManager.getInstance(context);
            data = WidgetData.load(context);
        } catch (Throwable t) {
            CrashLog.caught(context, "widgets", t);
            return;
        }
        renderEach(context, manager, data, ReferenceWidget.class, ReferenceWidget::build);
        renderEach(context, manager, data, ConverterWidget.class, ConverterWidget::build);
        renderEach(context, manager, data, ScanWidget.class, ScanWidget::build);
    }

    /** Builds one widget's views. */
    interface Builder {
        RemoteViews build(Context context, AppWidgetManager manager, int widgetId, WidgetData data);
    }

    private static void renderEach(Context context, AppWidgetManager manager, WidgetData data, Class<?> provider, Builder builder) {
        int[] ids;
        try {
            ids = manager.getAppWidgetIds(new ComponentName(context, provider));
        } catch (Throwable t) {
            CrashLog.caught(context, "widgets", t);
            return;
        }
        for (int id : ids) update(context, manager, id, data, builder);
    }

    /** While true (on this thread), widgets are drawn plain: no theme art, and one colour for both modes. */
    private static final ThreadLocal<Boolean> PLAIN = new ThreadLocal<>();

    static boolean plain() {
        return Boolean.TRUE.equals(PLAIN.get());
    }

    /**
     * Draws one widget. Nothing here may close the app: if drawing it with the theme's art fails (for example the
     * home screen refuses the image), it's drawn plain instead, and the error is kept for Settings → App.
     */
    static void update(Context context, AppWidgetManager manager, int widgetId, WidgetData data, Builder builder) {
        try {
            manager.updateAppWidget(widgetId, builder.build(context, manager, widgetId, data));
            return;
        } catch (Throwable t) {
            CrashLog.caught(context, "widget " + widgetId, t);
        }
        PLAIN.set(true);
        try {
            manager.updateAppWidget(widgetId, builder.build(context, manager, widgetId, data));
        } catch (Throwable t) {
            CrashLog.caught(context, "widget " + widgetId + " (plain)", t);
        } finally {
            PLAIN.set(false);
        }
    }

    /**
     * Background, border, accent marker and header text in the theme's look. With widget art (most themes), the
     * background is a bitmap composed at this widget's size; otherwise a rounded panel in the theme's colours.
     */
    static void paintFrame(Context context, RemoteViews views, WidgetData data, AppWidgetManager manager, int widgetId, int defaultWidthDp, int defaultHeightDp) {
        int[] size = sizeDp(manager, widgetId, defaultWidthDp, defaultHeightDp);
        boolean hasArt = false;
        try {
            hasArt = !plain() && paintArt(context, views, data, size);
        } catch (Throwable t) {
            CrashLog.caught(context, "widget art", t);
        }
        if (hasArt) {
            views.setInt(R.id.widget_bg, "setColorFilter", 0);
            views.setViewVisibility(R.id.widget_border, View.GONE);
        } else {
            views.setImageViewResource(R.id.widget_bg, R.drawable.widget_bg);
            paint(context, views, R.id.widget_bg, "setColorFilter", data, "bg");
            views.setViewVisibility(R.id.widget_border, View.VISIBLE);
            paint(context, views, R.id.widget_border, "setColorFilter", data, "line");
        }
        paint(context, views, R.id.marker, "setColorFilter", data, "accent");
        paint(context, views, R.id.divider, "setColorFilter", data, "line");
        paint(context, views, R.id.title, "setTextColor", data, "text");
        paint(context, views, R.id.pair, "setTextColor", data, "accent");
        paint(context, views, R.id.updated, "setTextColor", data, "dim");
    }

    /** The theme's art as the widget's background; false when the theme has none. */
    private static boolean paintArt(Context context, RemoteViews views, WidgetData data, int[] size) {
        if (Build.VERSION.SDK_INT >= 31) {
            // Both looks: the home screen shows the one that suits the phone's dark mode, and switches by itself.
            Bitmap light = WidgetArt.frame(context, data, size[0], size[1], false);
            Bitmap dark = light == null ? null : WidgetArt.frame(context, data, size[0], size[1], true);
            if (dark == null) return false;
            views.setIcon(R.id.widget_bg, "setImageIcon", Icon.createWithBitmap(light), Icon.createWithBitmap(dark));
            return true;
        }
        Bitmap art = WidgetArt.frame(context, data, size[0], size[1], isNight(context));
        if (art == null) return false;
        views.setImageViewBitmap(R.id.widget_bg, art);
        return true;
    }

    /**
     * Gives a view one of the theme's colours (bg, text, dim, accent, line) through a method taking a colour, such
     * as setTextColor or setColorFilter. From Android 12 it gets both the light and the dark version and the home
     * screen picks the one for the phone's dark mode; before that, the one for the mode the phone is in now.
     */
    static void paint(Context context, RemoteViews views, int viewId, String method, WidgetData data, String key) {
        int fallback = fallbackColor(key);
        if (data == null) {
            views.setInt(viewId, method, fallback);
        } else if (Build.VERSION.SDK_INT >= 31 && !plain()) {
            views.setColorInt(viewId, method, data.color(key, fallback, false), data.color(key, fallback, true));
        } else {
            views.setInt(viewId, method, data.color(key, fallback, isNight(context)));
        }
    }

    static int fallbackColor(String key) {
        switch (key) {
            case "bg":
                return 0xFF040605;
            case "dim":
                return 0xFF6F8A76;
            case "accent":
                return 0xFF7DFF72;
            case "line":
                return 0xFF2A5636;
            default:
                return 0xFFCFE3D3;
        }
    }

    /** Whether the phone is in dark mode. */
    static boolean isNight(Context context) {
        Configuration config = context.getResources().getConfiguration();
        return (config.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    /** The widget's size in dp (portrait: its width and the height the launcher gives it). */
    static int[] sizeDp(AppWidgetManager manager, int widgetId, int defaultWidthDp, int defaultHeightDp) {
        Bundle options = manager.getAppWidgetOptions(widgetId);
        int w = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        int h = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        return new int[] { w > 0 ? w : defaultWidthDp, h > 0 ? h : defaultHeightDp };
    }

    /** Text in the theme's font family (serif, monospace, casual …), when it has one. */
    static CharSequence text(WidgetData data, CharSequence value) {
        JSONObject meta = WidgetArt.meta(data);
        String family = meta == null ? "" : meta.optString("font", "");
        if (value == null || value.length() == 0 || family.isEmpty()) return value;
        SpannableString styled = new SpannableString(value);
        styled.setSpan(new TypefaceSpan(family), 0, value.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return styled;
    }

    /**
     * The keypad's keys: square, rounded or pill-shaped as the theme likes. They're a see-through grey, which shows
     * on light and dark looks alike, so they suit the widget in either of the phone's modes.
     */
    static int keyBackground(WidgetData data) {
        JSONObject meta = WidgetArt.meta(data);
        String shape = meta == null ? "round" : meta.optString("keys", "round");
        if ("square".equals(shape)) return R.drawable.widget_key_square;
        if ("pill".equals(shape)) return R.drawable.widget_key_pill;
        return R.drawable.widget_key;
    }

    /** How old the rates are, short enough for the corner: "now", "12m", "3h", "2d". Tap it to refresh. */
    static CharSequence updatedText(WidgetData data) {
        long updatedAt = data == null ? 0 : data.ratesUpdatedAt();
        if (updatedAt <= 0) return "⟳";
        long minutes = Math.max(0, (System.currentTimeMillis() - updatedAt) / DateUtils.MINUTE_IN_MILLIS);
        String age = minutes < 1 ? "now" : minutes < 60 ? minutes + "m" : minutes < 48 * 60 ? (minutes / 60) + "h" : (minutes / (24 * 60)) + "d";
        return age + " ⟳";
    }

    /** The widget's height in dp (portrait: the max height the launcher gives it). */
    static int heightDp(AppWidgetManager manager, int widgetId) {
        Bundle options = manager.getAppWidgetOptions(widgetId);
        if (options == null) return 0;
        int max = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        return max > 0 ? max : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
    }

    static PendingIntent openApp(Context context) {
        Intent intent = new Intent(context, ConverterActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Opens the app straight into the live camera. */
    static PendingIntent openCamera(Context context) {
        Intent intent = new Intent(context, ConverterActivity.class).setAction(ConverterActivity.ACTION_OPEN_CAMERA);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, 2, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static PendingIntent refresh(Context context) {
        Intent intent = new Intent(context, WidgetActions.class).setAction(ACTION_REFRESH);
        return PendingIntent.getBroadcast(context, 1, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** A key on the converter widget's keypad. Each key of each widget gets its own intent. */
    static PendingIntent key(Context context, int widgetId, String key) {
        Intent intent = new Intent(context, WidgetActions.class)
            .setAction(ACTION_KEY)
            .setData(Uri.parse("converter-widget://" + widgetId + "/" + key))
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
            .putExtra(EXTRA_KEY, key);
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Downloads fresh rates if the saved ones are more than a few hours old. */
    static void refreshIfStale(Context context, BroadcastReceiver receiver) {
        WidgetData data = WidgetData.load(context);
        if (data == null || System.currentTimeMillis() - data.ratesFetchedAt() < REFRESH_AFTER_MS) return;
        refreshRates(context, receiver.goAsync());
    }

    /** Downloads fresh rates on a background thread, saves them and redraws the widgets. */
    static void refreshRates(Context context, BroadcastReceiver.PendingResult pending) {
        Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                WidgetData data = WidgetData.load(app);
                if (data == null) return;
                JSONObject fresh = fetchJson(RATES_URL);
                JSONObject rates = fresh.optJSONObject("rates");
                if (rates == null || rates.optDouble("USD", 0) != 1 || rates.length() < 30) return;
                data.json.put("rates", rates);
                data.json.put("ratesUpdatedAt", fresh.optLong("time_last_update_unix", System.currentTimeMillis() / 1000) * 1000);
                data.json.put("ratesFetchedAt", System.currentTimeMillis());
                data.save(app);
            } catch (Exception ignored) {
                // Offline or the rates service is down: keep showing the saved rates.
            } finally {
                renderAll(app);
                if (pending != null) pending.finish();
            }
        }).start();
    }

    private static JSONObject fetchJson(String address) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(8000);
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
            StringBuilder body = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) body.append(line);
            return new JSONObject(body.toString());
        } finally {
            connection.disconnect();
        }
    }
}
