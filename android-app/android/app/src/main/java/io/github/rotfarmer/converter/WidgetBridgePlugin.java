package io.github.rotfarmer.converter;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Called from the web app (js/app.js, sendWidgetData) whenever your currencies, quick reference amounts,
 * rates or theme change. Saves the data and redraws both widgets.
 */
@CapacitorPlugin(name = "Widgets")
public class WidgetBridgePlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        WidgetData.save(getContext(), call.getData().toString());
        Widgets.renderAll(getContext());
        call.resolve();
    }
}
