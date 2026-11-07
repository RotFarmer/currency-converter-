package io.github.rotfarmer.converter;

import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import org.json.JSONObject;

/** Between the web app (js/app.js) and the native parts: the home-screen widgets and app updates. */
@CapacitorPlugin(name = "Widgets")
public class WidgetBridgePlugin extends Plugin {

    /** Your currencies, quick reference amounts, last scan, rates or theme changed: save and redraw the widgets. */
    @PluginMethod
    public void update(PluginCall call) {
        // Anything thrown here would close the app (Capacitor rethrows), and the app sends this every time it opens.
        try {
            JSObject data = call.getData();
            JSONObject art = data.optJSONObject("art");
            if (art != null) {
                // A new theme look: save its images, keep only its description with the data.
                data.remove("art");
                try {
                    data.put("artMeta", WidgetArt.save(getContext(), art));
                } catch (Throwable t) {
                    CrashLog.caught(getContext(), "widget art", t);
                }
            } else {
                // Same look as before: carry its description over.
                WidgetData previous = WidgetData.load(getContext());
                JSONObject meta = WidgetArt.meta(previous);
                if (meta != null && meta.optString("id").equals(data.optString("artId", ""))) data.put("artMeta", meta);
            }
            WidgetData.save(getContext(), data.toString());
        } catch (Throwable t) {
            CrashLog.caught(getContext(), "widget data", t);
        }
        Widgets.renderAll(getContext());
        call.resolve();
    }

    /** The theme changed (or "App icon follows the theme" did): the icon to show from the next time you leave the app. */
    @PluginMethod
    public void setIcon(PluginCall call) {
        try {
            AppIcon.choose(getContext(), call.getString("theme", "hud"));
        } catch (Throwable t) {
            CrashLog.caught(getContext(), "app icon", t);
        }
        call.resolve();
    }

    /** The last crash (once) and the last error the app caught and carried on from, for Settings → App. */
    @PluginMethod
    public void diagnostics(PluginCall call) {
        JSObject result = new JSObject();
        String crash = CrashLog.take(getContext(), CrashLog.CRASH, true);
        String caught = CrashLog.take(getContext(), CrashLog.CAUGHT, call.getBoolean("clear", false));
        if (crash != null) result.put("crash", crash);
        if (caught != null) result.put("caught", caught);
        call.resolve(result);
    }

    /** What the app was opened for (for example "camera" from the Scan widget), once. */
    @PluginMethod
    public void takeLaunchAction(PluginCall call) {
        JSObject result = new JSObject();
        String action = ConverterActivity.takePendingAction();
        if (action != null) result.put("action", action);
        call.resolve(result);
    }

    /** This app's version and the newest build on GitHub. */
    @PluginMethod
    public void checkUpdate(PluginCall call) {
        new Thread(() -> {
            try {
                call.resolve(updateStatus());
            } catch (Throwable t) {
                CrashLog.caught(getContext(), "update check", t);
                call.reject("Couldn't check for updates");
            }
        }).start();
    }

    private JSObject updateStatus() {
        JSObject result = new JSObject();
        result.put("installed", Updater.installedVersion(getContext()));
        result.put("installedName", Updater.installedVersionName(getContext()));
        result.put("quiet", Updater.canUpdateQuietly(getContext()));
        if (Updater.lastStatus != null) result.put("status", Updater.lastStatus);
        try {
            Updater.Release release = Updater.latest(getContext());
            result.put("latest", release.versionCode);
            result.put("latestName", release.versionName);
            result.put("sameKey", release.sameKey);
        } catch (Exception e) {
            result.put("error", "Couldn't check for updates");
        }
        return result;
    }

    /** You tapped Install: download the newest build and hand it to Android's installer. */
    @PluginMethod
    public void installUpdate(PluginCall call) {
        try {
            startInstall(call);
        } catch (Throwable t) {
            CrashLog.caught(getContext(), "install update", t);
            call.reject("Couldn't install the update.");
        }
    }

    private void startInstall(PluginCall call) {
        if (!Updater.mayInstall(getContext())) {
            // First Android asks you to allow Converter to install updates.
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(settings);
            JSObject result = new JSObject();
            result.put("needsPermission", true);
            call.resolve(result);
            return;
        }
        new Thread(() -> {
            try {
                Updater.Release release = Updater.latest(getContext());
                if (!release.sameKey) {
                    call.reject("This build was signed with a different key. Remove the app and install it again.");
                    return;
                }
                File apk = Updater.download(getContext(), release);
                Updater.install(getContext(), apk, true);
                JSObject result = new JSObject();
                result.put("started", true);
                call.resolve(result);
            } catch (Throwable e) {
                Updater.lastStatus = "failed: " + e.getMessage();
                String reason = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                call.reject("Couldn't download the update (" + reason + "). Tap Install update to carry on where it stopped.");
            }
        }).start();
    }
}
