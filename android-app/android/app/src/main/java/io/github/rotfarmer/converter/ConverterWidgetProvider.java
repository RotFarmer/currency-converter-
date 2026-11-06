package io.github.rotfarmer.converter;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.text.format.DateUtils;
import android.view.View;
import android.widget.RemoteViews;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Home-screen widget: your currencies, each with a typical amount, converted to your home currency.
 * The web app sends the currencies, amounts, rates and theme colours (ConverterWidgetPlugin). The widget
 * also downloads fresh rates every few hours by itself, and when you tap the time in its corner.
 */
public class ConverterWidgetProvider extends AppWidgetProvider {

    static final String ACTION_REFRESH = "io.github.rotfarmer.converter.REFRESH_WIDGET";
    private static final String RATES_URL = "https://open.er-api.com/v6/latest/USD";
    private static final long REFRESH_AFTER_MS = 3 * DateUtils.HOUR_IN_MILLIS;

    private static final int[] ROWS = { R.id.row1, R.id.row2, R.id.row3, R.id.row4, R.id.row5, R.id.row6 };
    private static final int[] FROM = { R.id.row1_from, R.id.row2_from, R.id.row3_from, R.id.row4_from, R.id.row5_from, R.id.row6_from };
    private static final int[] TO = { R.id.row1_to, R.id.row2_to, R.id.row3_to, R.id.row4_to, R.id.row5_to, R.id.row6_to };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        renderAll(context);
        JSONObject data = WidgetStore.load(context);
        long ratesTime = data == null ? 0 : data.optLong("ratesFetchedAt", data.optLong("ratesUpdatedAt", 0));
        if (data != null && System.currentTimeMillis() - ratesTime > REFRESH_AFTER_MS) {
            refreshRates(context, goAsync());
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int widgetId, Bundle newOptions) {
        // Resized: show as many rows as fit.
        manager.updateAppWidget(widgetId, build(context, manager, widgetId));
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) refreshRates(context, goAsync());
    }

    static void renderAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, ConverterWidgetProvider.class));
        for (int id : ids) manager.updateAppWidget(id, build(context, manager, id));
    }

    private static RemoteViews build(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.converter_widget);
        views.setOnClickPendingIntent(R.id.widget_root, openAppIntent(context));
        views.setOnClickPendingIntent(R.id.updated, refreshIntent(context));

        JSONObject data = WidgetStore.load(context);
        JSONObject colors = data == null ? null : data.optJSONObject("colors");
        int bg = color(colors, "bg", 0xFF040605);
        int text = color(colors, "text", 0xFFCFE3D3);
        int dim = color(colors, "dim", 0xFF6F8A76);
        int accent = color(colors, "accent", 0xFF7DFF72);
        int line = color(colors, "line", 0xFF2A5636);

        views.setInt(R.id.widget_bg, "setColorFilter", bg);
        views.setInt(R.id.widget_border, "setColorFilter", line);
        views.setInt(R.id.marker, "setColorFilter", accent);
        views.setInt(R.id.divider, "setColorFilter", line);
        views.setTextColor(R.id.title, text);
        views.setTextColor(R.id.home, accent);
        views.setTextColor(R.id.updated, dim);
        views.setTextColor(R.id.empty, dim);

        JSONArray rows = data == null ? null : data.optJSONArray("rows");
        JSONObject rates = data == null ? null : data.optJSONObject("rates");
        String home = data == null ? null : data.optString("home", null);
        if (rows == null || rows.length() == 0 || rates == null || home == null) {
            views.setTextViewText(R.id.home, "");
            views.setTextViewText(R.id.updated, "");
            views.setViewVisibility(R.id.empty, View.VISIBLE);
            views.setTextViewText(R.id.empty, context.getString(data == null ? R.string.widget_setup : R.string.widget_add_currencies));
            for (int row : ROWS) views.setViewVisibility(row, View.GONE);
            return views;
        }

        views.setViewVisibility(R.id.empty, View.GONE);
        views.setTextViewText(R.id.home, "→ " + home);
        long updatedAt = data.optLong("ratesUpdatedAt", 0);
        views.setTextViewText(R.id.updated, updatedAt > 0
            ? DateUtils.getRelativeTimeSpanString(updatedAt, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS) + "  ⟳"
            : "⟳");

        double homeRate = rates.optDouble(home, Double.NaN);
        int maxRows = rowsThatFit(manager, widgetId);
        int shown = 0;
        for (int i = 0; i < ROWS.length; i++) {
            JSONObject row = i < rows.length() ? rows.optJSONObject(i) : null;
            double rate = row == null ? Double.NaN : rates.optDouble(row.optString("code"), Double.NaN);
            if (row == null || shown >= maxRows || Double.isNaN(rate) || Double.isNaN(homeRate) || rate <= 0) {
                views.setViewVisibility(ROWS[i], View.GONE);
                continue;
            }
            double amount = row.optDouble("amount", 1);
            double inHome = amount / rate * homeRate;
            views.setViewVisibility(ROWS[i], View.VISIBLE);
            views.setTextViewText(FROM[i], money(amount, row.optString("prefix"), row.optString("suffix"), Math.min(row.optInt("decimals", 2), decimalsNeeded(amount))));
            views.setTextViewText(TO[i], money(inHome, data.optString("homePrefix"), data.optString("homeSuffix"), data.optInt("homeDecimals", 2)));
            views.setTextColor(FROM[i], text);
            views.setTextColor(TO[i], accent);
            shown++;
        }
        return views;
    }

    /** About 26dp per row below a 52dp header. */
    private static int rowsThatFit(AppWidgetManager manager, int widgetId) {
        Bundle options = manager.getAppWidgetOptions(widgetId);
        int height = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        if (height <= 0) return ROWS.length;
        return Math.max(1, Math.min(ROWS.length, (height - 52) / 26));
    }

    private static int decimalsNeeded(double amount) {
        return Math.abs(amount - Math.rint(amount)) < 1e-9 ? 0 : 2;
    }

    private static String money(double value, String prefix, String suffix, int decimals) {
        NumberFormat format = NumberFormat.getNumberInstance(Locale.getDefault());
        format.setMinimumFractionDigits(decimals);
        format.setMaximumFractionDigits(decimals);
        return prefix + format.format(value) + suffix;
    }

    private static int color(JSONObject colors, String key, int fallback) {
        if (colors == null) return fallback;
        try {
            return Color.parseColor(colors.optString(key, ""));
        } catch (IllegalArgumentException e) {
            return fallback;
        }
    }

    private static PendingIntent openAppIntent(Context context) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent refreshIntent(Context context) {
        Intent intent = new Intent(context, ConverterWidgetProvider.class);
        intent.setAction(ACTION_REFRESH);
        return PendingIntent.getBroadcast(context, 1, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Downloads fresh rates on a background thread, keeps the ones the widget needs and redraws. */
    private static void refreshRates(Context context, PendingResult pending) {
        Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                JSONObject data = WidgetStore.load(app);
                if (data == null) return;
                JSONObject fresh = fetchJson(RATES_URL);
                JSONObject freshRates = fresh.optJSONObject("rates");
                if (freshRates == null || freshRates.optDouble("USD", 0) != 1) return;
                JSONObject rates = data.optJSONObject("rates");
                if (rates == null) rates = new JSONObject();
                List<String> codes = new ArrayList<>();
                for (Iterator<String> it = rates.keys(); it.hasNext(); ) codes.add(it.next());
                for (String code : codes) {
                    if (freshRates.has(code)) rates.put(code, freshRates.getDouble(code));
                }
                data.put("rates", rates);
                data.put("ratesUpdatedAt", fresh.optLong("time_last_update_unix", System.currentTimeMillis() / 1000) * 1000);
                data.put("ratesFetchedAt", System.currentTimeMillis());
                WidgetStore.save(app, data.toString());
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
