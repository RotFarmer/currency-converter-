package io.github.rotfarmer.converter;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import java.text.DecimalFormatSymbols;
import java.text.NumberFormat;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * What the widgets know: the data the web app sent (js/app.js, sendWidgetData) with rates the widgets may
 * have refreshed since. Works out the currency of the country you're in, converts and formats money.
 */
final class WidgetData {

    static final String PREFS = "converter_widget";
    private static final String KEY = "data";
    private static final int[] STEPS = { 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000 };

    final JSONObject json;

    private WidgetData(JSONObject json) {
        this.json = json;
    }

    static WidgetData load(Context context) {
        String text = prefs(context).getString(KEY, null);
        if (text == null) return null;
        try {
            return new WidgetData(new JSONObject(text));
        } catch (JSONException e) {
            return null;
        }
    }

    static void save(Context context, String text) {
        prefs(context).edit().putString(KEY, text).apply();
    }

    void save(Context context) {
        save(context, json.toString());
    }

    static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    String home() {
        String home = str(json, "home");
        return home == null ? "USD" : home;
    }

    boolean hasRates() {
        return rate(home()) > 0;
    }

    /**
     * The currency of the country you're in and that country's code (which may be null).
     * Normally the app's "Price in" currency. If "Price in" follows your location and the phone's time zone
     * changed since the app last ran, the new time zone's country is used, so the widgets follow you
     * when you travel. At home, the first currency in the ☰ drawer is used instead (with no country).
     */
    Place place() {
        String home = home();
        String code = str(json, "source");
        String region = null;
        boolean auto = json.optBoolean("autoSource", false);
        if (auto) {
            region = str(json, "sourceRegion");
            String zone = TimeZone.getDefault().getID();
            if (!zone.equals(str(json, "timeZone"))) {
                String zoneRegion = str(json.optJSONObject("tzRegions"), zone);
                String zoneCurrency = str(json.optJSONObject("regionCurrencies"), zoneRegion);
                if (zoneCurrency != null && rate(zoneCurrency) > 0) {
                    code = zoneCurrency;
                    region = zoneRegion;
                }
            }
        }
        if (code == null || code.equals(home) || !(rate(code) > 0)) {
            JSONArray extra = json.optJSONArray("extra");
            for (int i = 0; extra != null && i < extra.length(); i++) {
                String other = extra.optString(i);
                if (!other.equals(home) && rate(other) > 0) return new Place(other, null);
            }
            return null;
        }
        return new Place(code, region);
    }

    double rate(String code) {
        JSONObject rates = json.optJSONObject("rates");
        return rates == null || code == null ? Double.NaN : rates.optDouble(code, Double.NaN);
    }

    /** Rates are per US dollar. */
    double convert(double amount, String from, String to) {
        return amount / rate(from) * rate(to);
    }

    /** Your quick reference amounts for a currency, or the suggested 1, 2, 5, 10 … scaled to its value. */
    double[] amounts(String code) {
        JSONObject chosen = json.optJSONObject("refAmounts");
        JSONArray custom = chosen == null ? null : chosen.optJSONArray(code);
        if (custom != null) {
            double[] out = new double[custom.length()];
            for (int i = 0; i < out.length; i++) out[i] = custom.optDouble(i, 0);
            return out;
        }
        double homeInCode = rate(code) / rate(home());
        double base = Math.pow(10, Math.max(0, Math.floor(Math.log10(homeInCode))));
        double[] out = new double[STEPS.length];
        for (int i = 0; i < STEPS.length; i++) out[i] = STEPS[i] * base;
        return out;
    }

    int decimals(String code) {
        JSONArray money = money(code);
        return money == null ? 2 : money.optInt(2, 2);
    }

    String prefix(String code) {
        JSONArray money = money(code);
        return money == null ? code + " " : money.optString(0, "");
    }

    String suffix(String code) {
        JSONArray money = money(code);
        return money == null ? "" : money.optString(1, "");
    }

    /** An amount as listed: no decimals for whole amounts. */
    String formatAmount(double value, String code) {
        boolean whole = Math.abs(value - Math.rint(value)) < 1e-9;
        return format(value, code, whole ? 0 : Math.max(2, decimals(code)));
    }

    /** A converted amount, with the currency's usual decimals. */
    String formatResult(double value, String code) {
        return format(value, code, decimals(code));
    }

    String format(double value, String code, int decimals) {
        NumberFormat number = NumberFormat.getNumberInstance(Locale.getDefault());
        number.setMinimumFractionDigits(decimals);
        number.setMaximumFractionDigits(decimals);
        return prefix(code) + number.format(value) + suffix(code);
    }

    /** What you're typing in the converter widget, e.g. "1280.5" shown as "¥1,280.5". */
    String formatTyped(String typed, String code) {
        String whole = typed;
        String fraction = null;
        int dot = typed.indexOf('.');
        if (dot >= 0) {
            whole = typed.substring(0, dot);
            fraction = typed.substring(dot + 1);
        }
        NumberFormat number = NumberFormat.getIntegerInstance(Locale.getDefault());
        String text = number.format(whole.isEmpty() ? 0 : Double.parseDouble(whole));
        if (fraction != null) text += DecimalFormatSymbols.getInstance(Locale.getDefault()).getDecimalSeparator() + fraction;
        return prefix(code) + text + suffix(code);
    }

    long ratesUpdatedAt() {
        return json.optLong("ratesUpdatedAt", 0);
    }

    long ratesFetchedAt() {
        return json.optLong("ratesFetchedAt", ratesUpdatedAt());
    }

    /** The theme's colour for the light (night = false) or dark look; older data has one set for both. */
    int color(String key, int fallback, boolean night) {
        JSONObject colors = json.optJSONObject(night ? "colorsDark" : "colorsLight");
        String value = str(colors != null ? colors : json.optJSONObject("colors"), key);
        if (value == null) return fallback;
        try {
            return Color.parseColor(value);
        } catch (IllegalArgumentException e) {
            return fallback;
        }
    }

    private JSONArray money(String code) {
        JSONObject money = json.optJSONObject("money");
        return money == null || code == null ? null : money.optJSONArray(code);
    }

    /** A string value, or null when it's missing, JSON null or empty. */
    static String str(JSONObject object, String key) {
        if (object == null || key == null || !object.has(key) || object.isNull(key)) return null;
        String value = object.optString(key, "");
        return value.isEmpty() ? null : value;
    }

    /** A currency and the country it's for (null when unknown). */
    static final class Place {

        final String code;
        final String region;

        Place(String code, String region) {
            this.code = code;
            this.region = region;
        }

        /** E.g. "🇯🇵 Japan", or null when the country isn't known. */
        String label() {
            if (region == null || region.length() != 2) return null;
            String upper = region.toUpperCase(Locale.ROOT);
            String flag = new String(Character.toChars(0x1F1E6 + upper.charAt(0) - 'A')) + new String(Character.toChars(0x1F1E6 + upper.charAt(1) - 'A'));
            String name = new Locale("", upper).getDisplayCountry();
            return flag + " " + (name.isEmpty() ? upper : name);
        }
    }
}
