package io.github.rotfarmer.converter;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import java.util.Locale;

/** Quick reference widget: your amounts in the currency of the country you're in, and what each is at home. */
public class ReferenceWidget extends AppWidgetProvider {

    private static final int[] ROWS = {
        R.id.row1, R.id.row2, R.id.row3, R.id.row4, R.id.row5, R.id.row6, R.id.row7, R.id.row8, R.id.row9, R.id.row10,
    };
    private static final int[] FROM = {
        R.id.row1_from, R.id.row2_from, R.id.row3_from, R.id.row4_from, R.id.row5_from,
        R.id.row6_from, R.id.row7_from, R.id.row8_from, R.id.row9_from, R.id.row10_from,
    };
    private static final int[] TO = {
        R.id.row1_to, R.id.row2_to, R.id.row3_to, R.id.row4_to, R.id.row5_to,
        R.id.row6_to, R.id.row7_to, R.id.row8_to, R.id.row9_to, R.id.row10_to,
    };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        Widgets.renderAll(context);
        Widgets.refreshIfStale(context, this);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int widgetId, Bundle newOptions) {
        // Resized: show as many rows as fit.
        Widgets.update(context, manager, widgetId, WidgetData.load(context), ReferenceWidget::build);
    }

    static RemoteViews build(Context context, AppWidgetManager manager, int widgetId, WidgetData data) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_reference);
        Widgets.paintFrame(context, views, data, manager, widgetId, 240, 230);
        views.setOnClickPendingIntent(R.id.widget_root, Widgets.openApp(context));
        views.setOnClickPendingIntent(R.id.updated, Widgets.refresh(context));
        views.setTextViewText(R.id.updated, Widgets.text(data, Widgets.updatedText(data)));
        Widgets.paint(context, views, R.id.empty, "setTextColor", data, "dim");

        WidgetData.Place place = data == null || !data.hasRates() ? null : data.place();
        double[] amounts = place == null ? new double[0] : data.amounts(place.code);
        String label = place == null ? null : place.label();
        views.setTextViewText(R.id.title, Widgets.text(data, label != null ? label.toUpperCase(Locale.getDefault()) : context.getString(R.string.reference_title)));
        views.setTextViewText(R.id.pair, Widgets.text(data, place == null ? "" : place.code + " → " + data.home()));

        if (amounts.length == 0) {
            int message = data == null ? R.string.widget_setup : place == null ? R.string.widget_no_currency : R.string.reference_no_amounts;
            views.setViewVisibility(R.id.empty, View.VISIBLE);
            views.setTextViewText(R.id.empty, Widgets.text(data, context.getString(message)));
            for (int row : ROWS) views.setViewVisibility(row, View.GONE);
            return views;
        }
        views.setViewVisibility(R.id.empty, View.GONE);
        int height = Widgets.heightDp(manager, widgetId);
        int fit = height > 0 ? Math.max(1, (height - 54) / 24) : ROWS.length;
        for (int i = 0; i < ROWS.length; i++) {
            boolean show = i < amounts.length && i < fit;
            views.setViewVisibility(ROWS[i], show ? View.VISIBLE : View.GONE);
            if (!show) continue;
            views.setTextViewText(FROM[i], Widgets.text(data, data.formatAmount(amounts[i], place.code)));
            views.setTextViewText(TO[i], Widgets.text(data, data.formatResult(data.convert(amounts[i], place.code, data.home()), data.home())));
            Widgets.paint(context, views, FROM[i], "setTextColor", data, "text");
            Widgets.paint(context, views, TO[i], "setTextColor", data, "accent");
        }
        return views;
    }
}
