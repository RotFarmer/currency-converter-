package io.github.rotfarmer.converter;

import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import java.util.ArrayList;
import java.util.List;

/**
 * The app's icon follows the theme: each theme has a launcher entry (an activity-alias in the manifest), and only the
 * chosen one is switched on. The web app says which theme (setIcon). Android closes the app when the entry it was
 * opened from is switched off, so the switch waits until you've been away from the app for a minute (IconJobService).
 */
final class AppIcon {
    private static final String PREFS = "app_icon";
    /** The HUD theme's entry, on by default (the manifest's). */
    private static final String DEFAULT = "MainActivity";
    /** Where the entries' names start (the manifest's ".Name" is short for this). */
    private static final String PACKAGE = AppIcon.class.getName().substring(0, AppIcon.class.getName().lastIndexOf('.') + 1);
    private static final String[] THEMES = {"aurora", "medieval", "cottage", "forest", "ocean", "ironbeetle", "cloud", "aero", "retro95", "vapor", "pixel", "notebook", "pet"};

    private AppIcon() {}

    /**
     * The icon to show: always the standard one now. Switching in theme icons (builds 16–18) left Samsung's app drawer
     * blank, so whatever the page asks, this puts the standard icon back once you've left the app.
     */
    static void choose(Context context, String theme) {
        prefs(context).edit().putString("theme", "hud").apply();
    }

    /** Whether the launcher shows another theme's icon than the chosen one. Never throws. */
    static boolean needsChange(Context context) {
        try {
            return !changes(context).isEmpty();
        } catch (Throwable t) {
            return false;
        }
    }

    /** Switch to the chosen theme's icon, if it changed. This may close the app (see above). Never throws. */
    static void apply(Context context) {
        try {
            List<Change> changes = changes(context);
            if (changes.isEmpty()) return;
            PackageManager pm = context.getPackageManager();
            if (Build.VERSION.SDK_INT >= 33) {
                // All at once: there's never no icon, or two.
                List<PackageManager.ComponentEnabledSetting> settings = new ArrayList<>();
                for (Change change : changes) {
                    settings.add(new PackageManager.ComponentEnabledSetting(change.component, change.state, PackageManager.DONT_KILL_APP));
                }
                pm.setComponentEnabledSettings(settings);
            } else {
                // The new one is first in the list, so there's always an icon.
                for (Change change : changes) pm.setComponentEnabledSetting(change.component, change.state, PackageManager.DONT_KILL_APP);
            }
        } catch (Throwable t) {
            CrashLog.caught(context, "app icon", t);
        }
    }

    private static final class Change {
        final ComponentName component;
        final int state;

        Change(ComponentName component, int state) {
            this.component = component;
            this.state = state;
        }
    }

    /** The entries to switch on or off for the chosen theme: the one to switch on first. */
    private static List<Change> changes(Context context) {
        String wanted = entryFor(prefs(context).getString("theme", "hud"));
        PackageManager pm = context.getPackageManager();
        List<Change> changes = new ArrayList<>();
        List<String> entries = new ArrayList<>();
        entries.add(wanted);
        if (!wanted.equals(DEFAULT)) entries.add(DEFAULT);
        for (String theme : THEMES) if (!entry(theme).equals(wanted)) entries.add(entry(theme));
        for (String entry : entries) {
            ComponentName component = new ComponentName(context.getPackageName(), PACKAGE + entry);
            boolean on = entry.equals(wanted);
            boolean onByDefault = entry.equals(DEFAULT);
            // "Default" is the manifest's own setting: use it where it matches, so nothing is stored that needn't be.
            int state = on == onByDefault
                ? PackageManager.COMPONENT_ENABLED_STATE_DEFAULT
                : on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
            if (pm.getComponentEnabledSetting(component) != state) changes.add(new Change(component, state));
        }
        return changes;
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
