package io.github.rotfarmer.converter;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;
import android.text.format.DateUtils;
import android.view.View;
import android.widget.RemoteViews;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Scan widget: one tap opens the app straight into the live camera. Below the button it lists the prices
 * from your last scan, converted to your home currency with the latest rates.
 */
public class ScanWidget extends AppWidgetProvider {

    private static final int[] ROWS = { R.id.scan_row1, R.id.scan_row2, R.id.scan_row3, R.id.scan_row4 };
    private static final int[] LABELS = { R.id.scan_row1_label, R.id.scan_row2_label, R.id.scan_row3_label, R.id.scan_row4_label };
    private static final int[] VALUES = { R.id.scan_row1_value, R.id.scan_row2_value, R.id.scan_row3_value, R.id.scan_row4_value };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        Widgets.renderAll(context);
        Widgets.refreshIfStale(context, this);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int widgetId, Bundle newOptions) {
        manager.updateAppWidget(widgetId, build(context, manager, widgetId, WidgetData.load(context)));
    }

    static RemoteViews build(Context context, AppWidgetManager manager, int widgetId, WidgetData data) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_scan);
        Widgets.paintFrame(context, views, data, manager, widgetId, 250, 190);
        views.setOnClickPendingIntent(R.id.widget_root, Widgets.openCamera(context));
        views.setOnClickPendingIntent(R.id.updated, Widgets.refresh(context));
        views.setTextViewText(R.id.updated, Widgets.text(data, Widgets.updatedText(data)));

        Widgets.paint(context, views, R.id.scan_button_bg, "setColorFilter", data, "accent");
        Widgets.paint(context, views, R.id.scan_icon, "setColorFilter", data, "accent");
        views.setTextViewText(R.id.scan_label, Widgets.text(data, context.getString(R.string.scan_button)));
        views.setTextViewText(R.id.scan_hint, Widgets.text(data, context.getString(R.string.scan_button_hint)));
        views.setTextViewText(R.id.scan_empty, Widgets.text(data, context.getString(R.string.scan_empty)));
        Widgets.paint(context, views, R.id.scan_label, "setTextColor", data, "accent");
        Widgets.paint(context, views, R.id.scan_hint, "setTextColor", data, "dim");
        Widgets.paint(context, views, R.id.last_title, "setTextColor", data, "dim");
        Widgets.paint(context, views, R.id.scan_empty, "setTextColor", data, "dim");

        WidgetData.Place place = data == null || !data.hasRates() ? null : data.place();
        String label = place == null ? null : place.label();
        views.setTextViewText(R.id.title, Widgets.text(data, label != null ? label.toUpperCase(Locale.getDefault()) : context.getString(R.string.scan_title)));
        views.setTextViewText(R.id.pair, Widgets.text(data, place == null ? "" : place.code + " → " + (data == null ? "" : data.home())));

        // The last scan's prices, as many as fit under the button.
        JSONObject last = data == null ? null : data.json.optJSONObject("lastScan");
        JSONArray items = last == null ? null : last.optJSONArray("items");
        int height = Widgets.heightDp(manager, widgetId);
        int fit = height > 0 ? Math.max(0, (height - 124) / 21) : ROWS.length;
        boolean hasItems = items != null && items.length() > 0 && data.hasRates();
        boolean roomForList = height <= 0 || height >= 124;
        views.setViewVisibility(R.id.last_title, hasItems && fit > 0 ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.scan_empty, !hasItems && roomForList ? View.VISIBLE : View.GONE);
        if (hasItems) {
            long at = last.optLong("at", 0);
            String age = at > 0 ? " · " + DateUtils.getRelativeTimeSpanString(at, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS) : "";
            views.setTextViewText(R.id.last_title, Widgets.text(data, context.getString(R.string.scan_last) + age.toUpperCase(Locale.getDefault())));
        }
        String home = data == null ? null : data.home();
        for (int i = 0; i < ROWS.length; i++) {
            JSONObject item = hasItems && i < items.length() && i < fit ? items.optJSONObject(i) : null;
            String code = item == null ? null : WidgetData.str(item, "code");
            double amount = item == null ? 0 : item.optDouble("amount", 0);
            if (code == null || !(amount > 0) || !(data.rate(code) > 0)) {
                views.setViewVisibility(ROWS[i], View.GONE);
                continue;
            }
            String name = WidgetData.str(item, "label");
            String value = data.formatAmount(amount, code);
            if (!code.equals(home)) value += " → " + data.formatResult(data.convert(amount, code, home), home);
            views.setViewVisibility(ROWS[i], View.VISIBLE);
            views.setTextViewText(LABELS[i], Widgets.text(data, name == null ? "" : name));
            views.setTextViewText(VALUES[i], Widgets.text(data, value));
            Widgets.paint(context, views, LABELS[i], "setTextColor", data, "text");
            Widgets.paint(context, views, VALUES[i], "setTextColor", data, "accent");
        }
        return views;
    }
}
