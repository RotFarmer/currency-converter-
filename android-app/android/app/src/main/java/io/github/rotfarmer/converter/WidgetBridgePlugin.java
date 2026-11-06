package io.github.rotfarmer.converter;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Between the web app (js/app.js) and the home-screen widgets. */
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
}
