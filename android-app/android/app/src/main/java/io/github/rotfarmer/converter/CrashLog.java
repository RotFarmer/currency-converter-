package io.github.rotfarmer.converter;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.SystemClock;
import android.webkit.WebView;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Keeps the details of the last crash, and of the last error the widgets caught and recovered from, so that
 * Settings → App can show them (and they can be copied into a bug report).
 */
final class CrashLog {

    static final String CRASH = "last-crash.txt";
    static final String CAUGHT = "last-caught-error.txt";
    private static final String PREFS = "converter_crashes";
    private static final String QUICK = "quick_crashes";
    /** Set while the app is opening; still set at the next start means it died before it settled. */
    private static final String STARTING = "starting";
    private static final String EXIT_SHOWN = "exit_shown";

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

    /**
     * The app is opening. Returns how many times in a row it died straight after opening, counting the last time
     * if it never settled (closed by a crash of any kind, native ones included, rather than by leaving it).
     */
    static int beginLaunch(Context context) {
        try {
            SharedPreferences prefs = prefs(context);
            int quick = prefs.getBoolean(STARTING, false) ? prefs.getInt(QUICK, 0) + 1 : 0;
            prefs.edit().putBoolean(STARTING, true).putInt(QUICK, quick).commit();
            return quick;
        } catch (Throwable t) {
            return 0;
        }
    }

    /** You left the app, so it didn't die while opening. */
    static void settle(Context context) {
        try {
            prefs(context).edit().putBoolean(STARTING, false).apply();
        } catch (Throwable ignored) {
            // nothing to settle
        }
    }

    /** The app has been open a while without crashing: it works again. */
    static void resetQuickCrashes(Context context) {
        try {
            prefs(context).edit().putBoolean(STARTING, false).putInt(QUICK, 0).apply();
        } catch (Throwable ignored) {
            // nothing to reset
        }
    }

    /**
     * Android's own record of why the app last closed (Android 11+), when that was a crash, a freeze or running
     * out of memory, and it hasn't been shown yet. This covers native crashes, which the crash handler can't see.
     */
    static String lastExitReport(Context context) {
        if (Build.VERSION.SDK_INT < 30) return null;
        try {
            ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            List<ApplicationExitInfo> exits = manager.getHistoricalProcessExitReasons(null, 0, 5);
            if (exits == null || exits.isEmpty()) return null;
            ApplicationExitInfo last = exits.get(0);
            SharedPreferences prefs = prefs(context);
            if (last.getTimestamp() <= prefs.getLong(EXIT_SHOWN, 0)) return null;
            prefs.edit().putLong(EXIT_SHOWN, last.getTimestamp()).apply();
            String reason = exitReason(last.getReason());
            if (reason == null) return null;
            // Android often closes apps in the background to free memory; that only counts while it was on screen.
            boolean crash = last.getReason() == ApplicationExitInfo.REASON_CRASH
                || last.getReason() == ApplicationExitInfo.REASON_CRASH_NATIVE
                || last.getReason() == ApplicationExitInfo.REASON_ANR;
            if (!crash && last.getImportance() > ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE) return null;
            StringBuilder text = new StringBuilder();
            text.append(new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date(last.getTimestamp())))
                .append(" · Android says: ").append(reason)
                .append(" · status ").append(last.getStatus())
                .append(" · importance ").append(last.getImportance())
                .append(" · memory ").append(last.getPss() / 1024).append(" MB (rss ").append(last.getRss() / 1024).append(" MB)")
                .append(" · ").append(device(context)).append('\n');
            if (last.getDescription() != null) text.append(last.getDescription()).append('\n');
            if (last.getReason() == ApplicationExitInfo.REASON_ANR) {
                try (InputStream in = last.getTraceInputStream()) {
                    if (in != null) {
                        byte[] bytes = new byte[8000];
                        int read = in.read(bytes);
                        if (read > 0) text.append(new String(bytes, 0, read, StandardCharsets.UTF_8));
                    }
                }
            }
            return text.toString();
        } catch (Throwable t) {
            return null;
        }
    }

    private static String exitReason(int reason) {
        switch (reason) {
            case ApplicationExitInfo.REASON_CRASH:
                return "crashed (Java)";
            case ApplicationExitInfo.REASON_CRASH_NATIVE:
                return "crashed (native code)";
            case ApplicationExitInfo.REASON_ANR:
                return "froze and was closed";
            case ApplicationExitInfo.REASON_LOW_MEMORY:
                return "closed to free memory";
            case ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE:
                return "closed for using too many resources";
            case ApplicationExitInfo.REASON_INITIALIZATION_FAILURE:
                return "failed to start";
            case ApplicationExitInfo.REASON_SIGNALED:
                return "was killed by a signal";
            default:
                return null; // left normally, updated, force-stopped and so on
        }
    }

    /** The build, Android version, phone and web view version, for reports. */
    static String device(Context context) {
        String build = "?";
        try {
            build = String.valueOf(Updater.installedVersion(context));
        } catch (Throwable ignored) {
            // the report matters more than the build number
        }
        String webView = "?";
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                PackageInfo info = WebView.getCurrentWebViewPackage();
                if (info != null) webView = info.packageName + " " + info.versionName;
            }
        } catch (Throwable ignored) {
            // unknown
        }
        return "build " + build + " · Android " + Build.VERSION.RELEASE + " (" + Build.VERSION.SDK_INT + ") · "
            + Build.MANUFACTURER + " " + Build.MODEL + " · WebView " + webView;
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
        String time = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date());
        long seconds = (SystemClock.elapsedRealtime() - ConverterApp.startedAt) / 1000;
        return time + " · " + where + " · " + seconds + "s after opening · " + device(context) + "\n" + trace;
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
            if (previous != null) previous.uncaughtException(thread, error);
        }
    }
}
