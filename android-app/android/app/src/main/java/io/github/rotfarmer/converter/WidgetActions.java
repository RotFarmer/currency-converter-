package io.github.rotfarmer.converter;

import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Taps on the widgets: converter keys and refreshing the rates. */
public class WidgetActions extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (Widgets.ACTION_REFRESH.equals(action)) {
            Widgets.refreshRates(context, goAsync());
        } else if (Widgets.ACTION_KEY.equals(action)) {
            int widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
            String key = intent.getStringExtra(Widgets.EXTRA_KEY);
            if (widgetId != AppWidgetManager.INVALID_APPWIDGET_ID && key != null) ConverterWidget.onKey(context, widgetId, key);
        }
    }
}
