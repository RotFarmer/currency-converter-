package io.github.rotfarmer.converter;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Called from the web app (js/app.js, sendWidgetData) whenever the currencies, rates or theme change.
 * Saves what the widget should show and redraws every widget on the home screen.
 */
@CapacitorPlugin(name = "ConverterWidget")
public class ConverterWidgetPlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        WidgetStore.save(getContext(), call.getData().toString());
        ConverterWidgetProvider.renderAll(getContext());
        call.resolve();
    }
}
