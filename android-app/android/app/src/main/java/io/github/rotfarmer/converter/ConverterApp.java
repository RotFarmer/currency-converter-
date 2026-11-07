package io.github.rotfarmer.converter;

import android.app.Application;

/** The app process: starts the crash log first, so crashes in the widgets and the app alike are recorded. */
public class ConverterApp extends Application {

    @Override
    public void onCreate() {
        super.onCreate();
        CrashLog.install(this);
    }
}
