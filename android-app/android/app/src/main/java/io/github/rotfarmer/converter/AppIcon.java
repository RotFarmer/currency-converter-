package io.github.rotfarmer.converter;

import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;

/**
 * The app's icon follows the theme: each theme has a launcher entry (an activity-alias in the manifest), and only the
 * chosen one is switched on. The web app says which theme (setIcon); the switch happens when you leave the app, since
 * launchers redraw (and some briefly close the app) when it changes.
 */
final class AppIcon {
    private static final String PREFS = "app_icon";
    /** The HUD theme's entry, on by default (the manifest's). */
    private static final String DEFAULT = "MainActivity";
    /** Where the entries' names start (the manifest's ".Name" is short for this). */
    private static final String PACKAGE = AppIcon.class.getName().substring(0, AppIcon.class.getName().lastIndexOf('.') + 1);
    private static final String[] THEMES = {"aurora", "medieval", "cottage", "forest", "ocean", "ironbeetle", "cloud", "aero", "retro95", "vapor", "pixel", "notebook", "pet"};

    private AppIcon() {}

    /** The icon for this theme ("hud" or an unknown theme: the standard icon), from the next time you leave the app. */
    static void choose(Context context, String theme) {
        prefs(context).edit().putString("theme", theme == null ? "hud" : theme).apply();
    }

    /** Switch to the chosen theme's icon, if it changed. Never throws. */
    static void apply(Context context) {
        try {
            String wanted = entryFor(prefs(context).getString("theme", "hud"));
            PackageManager pm = context.getPackageManager();
            // Switch the new one on first, so there's always an icon.
            set(context, pm, wanted, true);
            set(context, pm, DEFAULT, wanted.equals(DEFAULT));
            for (String theme : THEMES) set(context, pm, entry(theme), entry(theme).equals(wanted));
        } catch (Throwable t) {
            CrashLog.caught(context, "app icon", t);
        }
    }

    private static void set(Context context, PackageManager pm, String entry, boolean on) {
        ComponentName component = new ComponentName(context.getPackageName(), PACKAGE + entry);
        boolean onByDefault = entry.equals(DEFAULT);
        // "Default" is the manifest's own setting: use it where it matches, so nothing is stored that needn't be.
        int state = on == onByDefault
            ? PackageManager.COMPONENT_ENABLED_STATE_DEFAULT
            : on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
        if (pm.getComponentEnabledSetting(component) == state) return;
        pm.setComponentEnabledSetting(component, state, PackageManager.DONT_KILL_APP);
    }

    private static String entryFor(String theme) {
        for (String known : THEMES) if (known.equals(theme)) return entry(known);
        return DEFAULT;
    }

    private static String entry(String theme) {
        return "Icon" + Character.toUpperCase(theme.charAt(0)) + theme.substring(1);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
