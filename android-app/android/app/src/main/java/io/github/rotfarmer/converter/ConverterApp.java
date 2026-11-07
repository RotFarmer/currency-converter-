package io.github.rotfarmer.converter;

import android.app.Application;
import android.os.SystemClock;

/** The app process: starts the crash log first, so crashes in the widgets and the app alike are recorded. */
public class ConverterApp extends Application {

    /** When this process started (elapsed realtime), to tell a crash straight after opening from a later one. */
    static long startedAt = SystemClock.elapsedRealtime();

    @Override
    public void onCreate() {
        super.onCreate();
        startedAt = SystemClock.elapsedRealtime();
        CrashLog.install(this);
    }
}
