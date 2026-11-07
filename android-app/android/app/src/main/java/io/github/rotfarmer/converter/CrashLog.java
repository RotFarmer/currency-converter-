package io.github.rotfarmer.converter;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.SystemClock;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Keeps the details of the last crash, and of the last error the widgets caught and recovered from, so that
 * Settings → App can show them (and they can be copied into a bug report).
 */
final class CrashLog {

    static final String CRASH = "last-crash.txt";
    static final String CAUGHT = "last-caught-error.txt";
    /** A crash this soon after the app started counts as "straight after opening". */
    private static final long QUICK_MS = 30_000;
    private static final String PREFS = "converter_crashes";
    private static final String QUICK = "quick_crashes";

    private CrashLog() {}

    /** From now on, a crash anywhere in the app writes its details before the app closes. */
    static synchronized void install(Context context) {
        Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        if (previous instanceof Recorder) return;
        Thread.setDefaultUncaughtExceptionHandler(new Recorder(context.getApplicationContext(), previous));
    }

    /** An error that was caught (the app carried on): remembered so it can be looked at. */
    static void caught(Context context, String where, Throwable error) {
        record(context, where, error);
    }

    /** Like caught, and returns the report. */
    static String record(Context context, String where, Throwable error) {
        String text = describe(context, where, error);
        write(context, CAUGHT, text);
        return text;
    }

    /** How many times in a row the app crashed straight after opening. */
    static int quickCrashes(Context context) {
        try {
            return prefs(context).getInt(QUICK, 0);
        } catch (Throwable t) {
            return 0;
        }
    }

    /** The app has been open a while without crashing: it works again. */
    static void resetQuickCrashes(Context context) {
        try {
            prefs(context).edit().putInt(QUICK, 0).apply();
        } catch (Throwable ignored) {
            // nothing to reset
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** The saved report, or null; a crash report is removed once read, so it's shown once. */
    static String take(Context context, String name, boolean remove) {
        try {
            File file = new File(context.getFilesDir(), name);
            if (!file.isFile()) return null;
            byte[] bytes = new byte[(int) Math.min(file.length(), 64 * 1024)];
            try (FileInputStream in = new FileInputStream(file)) {
                int read = in.read(bytes);
                if (remove) file.delete();
                return read > 0 ? new String(bytes, 0, read, StandardCharsets.UTF_8) : null;
            }
        } catch (Throwable t) {
            return null;
        }
    }

    private static String describe(Context context, String where, Throwable error) {
        StringWriter trace = new StringWriter();
        error.printStackTrace(new PrintWriter(trace));
        String build = "?";
        try {
            build = String.valueOf(Updater.installedVersion(context));
        } catch (Throwable ignored) {
            // the report matters more than the build number
        }
        String time = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date());
        long seconds = (SystemClock.elapsedRealtime() - ConverterApp.startedAt) / 1000;
        return time + " · " + where + " · " + seconds + "s after opening · build " + build + " · Android " + Build.VERSION.RELEASE
            + " (" + Build.VERSION.SDK_INT + ") · " + Build.MANUFACTURER + " " + Build.MODEL + "\n" + trace;
    }

    private static void write(Context context, String name, String text) {
        try (FileOutputStream out = new FileOutputStream(new File(context.getFilesDir(), name))) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
        } catch (Throwable ignored) {
            // nothing more can be done
        }
    }

    private static final class Recorder implements Thread.UncaughtExceptionHandler {

        private final Context context;
        private final Thread.UncaughtExceptionHandler previous;

        Recorder(Context context, Thread.UncaughtExceptionHandler previous) {
            this.context = context;
            this.previous = previous;
        }

        @Override
        public void uncaughtException(Thread thread, Throwable error) {
            write(context, CRASH, describe(context, "crash in " + thread.getName(), error));
            try {
                // Straight after opening? Then the next start is careful (safe mode, then just the report).
                boolean quick = SystemClock.elapsedRealtime() - ConverterApp.startedAt < QUICK_MS;
                SharedPreferences prefs = prefs(context);
                prefs.edit().putInt(QUICK, quick ? prefs.getInt(QUICK, 0) + 1 : 0).commit();
            } catch (Throwable ignored) {
                // the report is what matters
            }
            if (previous != null) previous.uncaughtException(thread, error);
        }
    }
}
