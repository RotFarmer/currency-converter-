package io.github.rotfarmer.converter;

import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {

    static final String ACTION_OPEN_CAMERA = "io.github.rotfarmer.converter.OPEN_CAMERA";
    /** After you leave the app for this long (not just to take a photo), a waiting update installs by itself. */
    private static final long INSTALL_AFTER_LEAVING_MS = 60_000;
    /** Open this long without crashing, and the app counts as working again. */
    private static final long WORKING_AFTER_MS = 30_000;

    /** Something the app was opened to do (from the Scan widget or the app shortcut), until the web app asks. */
    private static String pendingAction;
    private static volatile boolean visible;
    /** The page crashed: the activity starts again with the page in safe mode, and shows this report. */
    private static String pageCrashReport;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable installWhenAway = () -> new Thread(() -> Updater.updateQuietly(getApplicationContext())).start();
    private final Runnable markWorking = () -> CrashLog.resetQuickCrashes(getApplicationContext());

    /** The page opens without the theme's moving art (?safe=1), after a crash. */
    private boolean safeMode;
    /** It crashed straight after opening twice in a row: show what happened instead of trying again. */
    private boolean reportOnly;
    /** What went wrong last time, to show. */
    private String report;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Lets the web app send the home-screen widgets their data, and check for app updates.
        registerPlugin(WidgetBridgePlugin.class);
        // Reads and translates text on the device for the camera and photo scans.
        registerPlugin(VisionPlugin.class);
        int quickCrashes = CrashLog.beginLaunch(this);
        if (pageCrashReport != null) {
            report = pageCrashReport;
        } else {
            // What went wrong last time: the crash handler's report (Java) and Android's own record (any crash).
            report = join(CrashLog.take(this, CrashLog.CRASH, true), CrashLog.lastExitReport(this));
            if (report == null && quickCrashes >= 1) {
                report = "Converter closed straight after opening last time, without leaving any details. " + CrashLog.device(this);
            }
        }
        safeMode = pageCrashReport != null || quickCrashes >= 1;
        reportOnly = pageCrashReport == null && quickCrashes >= 2;
        pageCrashReport = null;
        // The report screen itself is safe: leaving it shouldn't count as another crash.
        if (reportOnly) CrashLog.settle(this);

        super.onCreate(savedInstanceState); // calls load()

        if (bridge != null) {
            // Keep the app's own text sizes: the web view would otherwise scale text with the phone's font size setting.
            bridge.getWebView().getSettings().setTextZoom(100);
            // If the page's process dies, Android would close the whole app unless someone handles it.
            bridge.addWebViewListener(new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    pageGone(detail);
                    return true;
                }
            });
            if (safeMode) bridge.getWebView().loadUrl(safeUrl());
        }
        if (!reportOnly) {
            UpdateJobService.schedule(this);
            handler.postDelayed(markWorking, WORKING_AFTER_MS);
            if (report != null) showCrashDialog(report);
        }
    }

    @Override
    protected void load() {
        if (reportOnly) {
            setContentView(reportView(report));
            return;
        }
        super.load();
    }

    @Override
    public void onStart() {
        super.onStart();
        visible = true;
        handler.removeCallbacks(installWhenAway);
    }

    @Override
    public void onStop() {
        super.onStop();
        visible = false;
        CrashLog.settle(this);
        if (!reportOnly && Updater.canUpdateQuietly(this)) handler.postDelayed(installWhenAway, INSTALL_AFTER_LEAVING_MS);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(markWorking);
        super.onDestroy();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Dark mode switched on or off: before Android 12 the widgets only have one look, so draw them again.
        if (Build.VERSION.SDK_INT < 31) new Thread(() -> Widgets.renderAll(getApplicationContext())).start();
    }

    static boolean isVisible() {
        return visible;
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

    /** The page's process crashed or was stopped: start again in safe mode, or if that's what crashed, say so. */
    private void pageGone(RenderProcessGoneDetail detail) {
        boolean crashed = Build.VERSION.SDK_INT >= 26 && detail != null && detail.didCrash();
        int priority = Build.VERSION.SDK_INT >= 26 && detail != null ? detail.rendererPriorityAtExit() : -1;
        String what = crashed ? "The app's page crashed" : "Android stopped the app's page (probably to free memory)";
        String text = CrashLog.record(this, "page gone" + (safeMode ? " in safe mode" : ""),
            new RuntimeException(what + "; renderer priority " + priority));
        if (safeMode) {
            reportOnly = true;
            setContentView(reportView(text));
        } else {
            pageCrashReport = text;
            recreate();
        }
    }

    private static String join(String a, String b) {
        if (a == null) return b;
        if (b == null) return a;
        return a + "\n\n" + b;
    }

    private String safeUrl() {
        String base = bridge.getServerUrl();
        if (base == null || base.isEmpty()) base = bridge.getAppUrl();
        return Uri.parse(base).buildUpon().appendQueryParameter("safe", "1").build().toString();
    }

    private void showCrashDialog(String text) {
        String[] lines = text.split("\n");
        StringBuilder brief = new StringBuilder();
        for (int i = 0; i < Math.min(lines.length, 5); i++) brief.append(lines[i].trim()).append('\n');
        String note = safeMode
            ? "\nIt's open in safe mode: the theme's moving art is off until you next open the app."
            : "";
        new AlertDialog.Builder(this)
            .setTitle("Converter closed unexpectedly")
            .setMessage(brief + note + "\nTap Copy details and send them to get this fixed.")
            .setPositiveButton("Copy details", (dialog, which) -> copy(text))
            .setNegativeButton("Close", null)
            .show();
    }

    /** A plain screen with what went wrong, for when the app's page can't be shown. */
    private ScrollView reportView(String text) {
        float dp = getResources().getDisplayMetrics().density;
        int pad = Math.round(20 * dp);
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(pad, Math.round(48 * dp), pad, pad);

        TextView title = new TextView(this);
        title.setText("Converter keeps closing");
        title.setTextSize(22);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(0xFFFFFFFF);
        column.addView(title);

        TextView hint = new TextView(this);
        hint.setText("It closed right after opening several times in a row. Tap Copy details and send them to get this fixed, or try again.");
        hint.setTextSize(16);
        hint.setTextColor(0xFFCFD8DC);
        hint.setPadding(0, Math.round(10 * dp), 0, Math.round(16 * dp));
        column.addView(hint);

        Button copy = new Button(this);
        copy.setText("Copy details");
        copy.setOnClickListener(v -> copy(text == null ? "No details were saved." : text));
        column.addView(copy);

        Button retry = new Button(this);
        retry.setText("Try again");
        retry.setOnClickListener(v -> {
            CrashLog.resetQuickCrashes(getApplicationContext());
            recreate();
        });
        column.addView(retry);

        TextView details = new TextView(this);
        details.setText(text == null ? "No details were saved." : text);
        details.setTypeface(Typeface.MONOSPACE);
        details.setTextSize(11);
        details.setTextColor(0xFFB0BEC5);
        details.setTextIsSelectable(true);
        details.setPadding(0, Math.round(16 * dp), 0, 0);
        column.addView(details);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(0xFF101418);
        scroll.addView(column);
        return scroll;
    }

    private void copy(String text) {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText("Converter crash report", text));
        Toast.makeText(this, "Details copied", Toast.LENGTH_SHORT).show();
    }
}
