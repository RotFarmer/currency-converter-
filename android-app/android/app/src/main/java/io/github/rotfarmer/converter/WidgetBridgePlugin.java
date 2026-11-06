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

/** Between the web app (js/app.js) and the native parts: the home-screen widgets and app updates. */
@CapacitorPlugin(name = "Widgets")
public class WidgetBridgePlugin extends Plugin {

    /** Your currencies, quick reference amounts, last scan, rates or theme changed: save and redraw the widgets. */
    @PluginMethod
    public void update(PluginCall call) {
        WidgetData.save(getContext(), call.getData().toString());
        Widgets.renderAll(getContext());
        call.resolve();
    }

    /** What the app was opened for (for example "camera" from the Scan widget), once. */
    @PluginMethod
    public void takeLaunchAction(PluginCall call) {
        JSObject result = new JSObject();
        String action = MainActivity.takePendingAction();
        if (action != null) result.put("action", action);
        call.resolve(result);
    }

    /** This app's version and the newest build on GitHub. */
    @PluginMethod
    public void checkUpdate(PluginCall call) {
        new Thread(() -> {
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
            call.resolve(result);
        }).start();
    }

    /** You tapped Install: download the newest build and hand it to Android's installer. */
    @PluginMethod
    public void installUpdate(PluginCall call) {
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
            } catch (Exception e) {
                Updater.lastStatus = "failed: " + e.getMessage();
                call.reject("Couldn't download the update. Check your connection.");
            }
        }).start();
    }
}
