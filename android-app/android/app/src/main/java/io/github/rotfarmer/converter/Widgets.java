package io.github.rotfarmer.converter;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.format.DateUtils;
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

    /** Redraws every Converter and Quick reference widget on the home screen. */
    static void renderAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        WidgetData data = WidgetData.load(context);
        for (int id : manager.getAppWidgetIds(new ComponentName(context, ReferenceWidget.class))) {
            manager.updateAppWidget(id, ReferenceWidget.build(context, manager, id, data));
        }
        for (int id : manager.getAppWidgetIds(new ComponentName(context, ConverterWidget.class))) {
            manager.updateAppWidget(id, ConverterWidget.build(context, id, data));
        }
    }

    /** Background, border, accent marker and header text in the theme's colours. */
    static void paintFrame(RemoteViews views, WidgetData data) {
        int bg = color(data, "bg", 0xFF040605);
        int line = color(data, "line", 0xFF2A5636);
        views.setInt(R.id.widget_bg, "setColorFilter", bg);
        views.setInt(R.id.widget_border, "setColorFilter", line);
        views.setInt(R.id.marker, "setColorFilter", color(data, "accent", 0xFF7DFF72));
        views.setInt(R.id.divider, "setColorFilter", line);
        views.setTextColor(R.id.title, color(data, "text", 0xFFCFE3D3));
        views.setTextColor(R.id.pair, color(data, "accent", 0xFF7DFF72));
        views.setTextColor(R.id.updated, color(data, "dim", 0xFF6F8A76));
    }

    static int color(WidgetData data, String key, int fallback) {
        return data == null ? fallback : data.color(key, fallback);
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
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
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
