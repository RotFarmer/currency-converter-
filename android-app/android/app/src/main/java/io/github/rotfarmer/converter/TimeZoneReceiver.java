package io.github.rotfarmer.converter;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** The phone moved to another time zone (you travelled): the widgets switch to that country's currency. */
public class TimeZoneReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_TIMEZONE_CHANGED.equals(intent.getAction())) Widgets.renderAll(context);
    }
}
