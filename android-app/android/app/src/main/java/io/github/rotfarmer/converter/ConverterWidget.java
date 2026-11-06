package io.github.rotfarmer.converter;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.SharedPreferences;
import android.widget.RemoteViews;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Locale;

/**
 * Converter widget: a keypad. Type a price in the currency of the country you're in and see it in your home
 * currency; ⇄ flips the direction. Each widget remembers what was typed in it.
 */
public class ConverterWidget extends AppWidgetProvider {

    private static final String[] KEYS = { "7", "8", "9", "back", "4", "5", "6", "clear", "1", "2", "3", "swap", "0", "00", "dot" };
    private static final int[] KEY_IDS = {
        R.id.key_7, R.id.key_8, R.id.key_9, R.id.key_back,
        R.id.key_4, R.id.key_5, R.id.key_6, R.id.key_clear,
        R.id.key_1, R.id.key_2, R.id.key_3, R.id.key_swap,
        R.id.key_0, R.id.key_00, R.id.key_dot,
    };
    private static final int MAX_DIGITS = 12;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        Widgets.renderAll(context);
        Widgets.refreshIfStale(context, this);
    }

    @Override
    public void onDeleted(Context context, int[] widgetIds) {
        SharedPreferences.Editor editor = WidgetData.prefs(context).edit();
        for (int id : widgetIds) editor.remove("input_" + id).remove("swap_" + id);
        editor.apply();
    }

    static RemoteViews build(Context context, int widgetId, WidgetData data) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_converter);
        Widgets.paintFrame(views, data);
        views.setOnClickPendingIntent(R.id.display, Widgets.openApp(context));
        views.setOnClickPendingIntent(R.id.updated, Widgets.refresh(context));
        views.setTextViewText(R.id.updated, Widgets.updatedText(data));

        int text = Widgets.color(data, "text", 0xFFCFE3D3);
        int accent = Widgets.color(data, "accent", 0xFF7DFF72);
        int dim = Widgets.color(data, "dim", 0xFF6F8A76);
        int keyBackground = WidgetData.isDark(Widgets.color(data, "bg", 0xFF040605)) ? R.drawable.widget_key_dark : R.drawable.widget_key_light;
        for (int i = 0; i < KEYS.length; i++) {
            views.setOnClickPendingIntent(KEY_IDS[i], Widgets.key(context, widgetId, KEYS[i]));
            views.setInt(KEY_IDS[i], "setBackgroundResource", keyBackground);
            views.setTextColor(KEY_IDS[i], KEYS[i].length() > 2 ? accent : text);
        }

        WidgetData.Place place = data == null || !data.hasRates() ? null : data.place();
        if (place == null) {
            views.setTextViewText(R.id.title, context.getString(R.string.converter_title));
            views.setTextViewText(R.id.pair, "");
            views.setTextViewText(R.id.input, "—");
            views.setTextColor(R.id.input, dim);
            views.setTextViewText(R.id.output, context.getString(data == null ? R.string.widget_setup_short : R.string.widget_no_currency_short));
            views.setTextColor(R.id.output, dim);
            return views;
        }

        SharedPreferences prefs = WidgetData.prefs(context);
        String typed = prefs.getString("input_" + widgetId, "");
        boolean swap = prefs.getBoolean("swap_" + widgetId, false);
        String from = swap ? data.home() : place.code;
        String to = swap ? place.code : data.home();
        String label = place.label();
        views.setTextViewText(R.id.title, label != null ? label.toUpperCase(Locale.getDefault()) : context.getString(R.string.converter_title));
        views.setTextViewText(R.id.pair, from + " → " + to);
        double value = typed.isEmpty() ? 0 : Double.parseDouble(typed);
        views.setTextViewText(R.id.input, typed.isEmpty() ? data.format(0, from, 0) : data.formatTyped(typed, from));
        views.setTextColor(R.id.input, typed.isEmpty() ? dim : text);
        views.setTextViewText(R.id.output, "= " + data.formatResult(data.convert(value, from, to), to));
        views.setTextColor(R.id.output, accent);
        return views;
    }

    /** A key was tapped on a converter widget. */
    static void onKey(Context context, int widgetId, String key) {
        WidgetData data = WidgetData.load(context);
        WidgetData.Place place = data == null || !data.hasRates() ? null : data.place();
        SharedPreferences prefs = WidgetData.prefs(context);
        String typed = prefs.getString("input_" + widgetId, "");
        boolean swap = prefs.getBoolean("swap_" + widgetId, false);
        if (place != null) {
            String from = swap ? data.home() : place.code;
            String to = swap ? place.code : data.home();
            if ("swap".equals(key)) {
                // Flip the direction, keeping the amounts: what was the result is now what's typed.
                if (!typed.isEmpty()) typed = plain(data.convert(Double.parseDouble(typed), from, to), data.decimals(to));
                swap = !swap;
            } else {
                typed = press(typed, key, data.decimals(from));
            }
        }
        prefs.edit().putString("input_" + widgetId, typed).putBoolean("swap_" + widgetId, swap).apply();
        AppWidgetManager.getInstance(context).updateAppWidget(widgetId, build(context, widgetId, data));
    }

    /** What's typed after pressing a key: digits, "00", the decimal point, backspace or clear. */
    static String press(String typed, String key, int decimals) {
        switch (key) {
            case "clear":
                return "";
            case "back":
                return typed.isEmpty() ? "" : typed.substring(0, typed.length() - 1);
            case "dot":
                if (decimals == 0 || typed.contains(".")) return typed;
                return (typed.isEmpty() ? "0" : typed) + ".";
            default:
                String next = typed;
                for (char digit : key.toCharArray()) {
                    int dot = next.indexOf('.');
                    if (dot >= 0 && next.length() - dot - 1 >= decimals) break;
                    if (next.replace(".", "").length() >= MAX_DIGITS) break;
                    next = next.equals("0") ? String.valueOf(digit) : next + digit;
                }
                return next;
        }
    }

    /** A number as typed text: rounded to the currency's decimals, no trailing zeros. */
    private static String plain(double value, int decimals) {
        if (!(value > 0) || Double.isInfinite(value)) return "";
        String text = BigDecimal.valueOf(value).setScale(decimals, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString();
        return text.equals("0") ? "" : text;
    }
}
