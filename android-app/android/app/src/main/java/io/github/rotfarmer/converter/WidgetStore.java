package io.github.rotfarmer.converter;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONException;
import org.json.JSONObject;

/** The widget's data: the JSON sent by the web app, with rates the widget may have refreshed since. */
final class WidgetStore {

    private static final String PREFS = "converter_widget";
    private static final String KEY = "data";

    private WidgetStore() {}

    static void save(Context context, String json) {
        prefs(context).edit().putString(KEY, json).apply();
    }

    static JSONObject load(Context context) {
        String json = prefs(context).getString(KEY, null);
        if (json == null) return null;
        try {
            return new JSONObject(json);
        } catch (JSONException e) {
            return null;
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
