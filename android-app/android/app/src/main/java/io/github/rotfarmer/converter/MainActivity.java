package io.github.rotfarmer.converter;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    static final String ACTION_OPEN_CAMERA = "io.github.rotfarmer.converter.OPEN_CAMERA";

    /** Something the app was opened to do (from the Scan widget or the app shortcut), until the web app asks. */
    private static String pendingAction;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Lets the web app send the home-screen widgets their data.
        registerPlugin(WidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);
        // Keep the app's own text sizes: the web view would otherwise scale text with the phone's font size setting.
        if (bridge != null) bridge.getWebView().getSettings().setTextZoom(100);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null && ACTION_OPEN_CAMERA.equals(intent.getAction())) {
            pendingAction = "camera";
            // Already running: tell the page now. At startup the page asks by itself once it has loaded.
            if (bridge != null) bridge.triggerWindowJSEvent("converterlaunch");
        }
    }

    /** The action the app was opened for, once; null when there is none. */
    static synchronized String takePendingAction() {
        String action = pendingAction;
        pendingAction = null;
        return action;
    }
}
