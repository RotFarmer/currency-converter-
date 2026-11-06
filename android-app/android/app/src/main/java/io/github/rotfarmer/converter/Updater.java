package io.github.rotfarmer.converter;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.json.JSONObject;

/**
 * Keeps the app itself up to date. Each GitHub build publishes Converter.apk and version.json (its build number
 * and the fingerprint of the key it was signed with) as the "android-latest" release. The app downloads a newer
 * build and installs it with Android's package installer: the first time you confirm it; after that, on
 * Android 12 and newer, updates install without asking while you're not using the app.
 * Android only installs an update signed with the same key as the installed app, so builds signed with a
 * temporary key can't update each other.
 */
final class Updater {

    static final String RELEASE = "https://github.com/RotFarmer/currency-converter-/releases/download/android-latest/";
    static final String ACTION_STATUS = "io.github.rotfarmer.converter.UPDATE_STATUS";
    static final String EXTRA_USER = "user";

    /** What the last update attempt did, for Settings ("installing", "failed: …"). */
    static volatile String lastStatus = null;

    private Updater() {}

    /** The newest build on GitHub. */
    static final class Release {

        final long versionCode;
        final String versionName;
        final String apkUrl;
        final boolean sameKey;

        Release(long versionCode, String versionName, String apkUrl, boolean sameKey) {
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.apkUrl = apkUrl;
            this.sameKey = sameKey;
        }
    }

    static Release latest(Context context) throws Exception {
        JSONObject json = new JSONObject(fetchText(RELEASE + "version.json"));
        String cert = json.optString("certSha256", "").replace(":", "");
        return new Release(
            json.optLong("versionCode", 0),
            json.optString("versionName", ""),
            json.optString("apk", RELEASE + "Converter.apk"),
            !cert.isEmpty() && cert.equalsIgnoreCase(ownCertSha256(context))
        );
    }

    static long installedVersion(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
        } catch (PackageManager.NameNotFoundException e) {
            return 0;
        }
    }

    static String installedVersionName(Context context) {
        try {
            return context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "";
        }
    }

    /** SHA-256 of the certificate this app was signed with, as lowercase hex. */
    @SuppressWarnings("deprecation")
    static String ownCertSha256(Context context) {
        try {
            PackageManager pm = context.getPackageManager();
            Signature[] signatures;
            if (Build.VERSION.SDK_INT >= 28) {
                PackageInfo info = pm.getPackageInfo(context.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
                signatures = info.signingInfo.getApkContentsSigners();
            } else {
                signatures = pm.getPackageInfo(context.getPackageName(), PackageManager.GET_SIGNATURES).signatures;
            }
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray());
            StringBuilder hex = new StringBuilder();
            for (byte b : digest) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (Exception e) {
            return "";
        }
    }

    /** The app may install packages (the "Install unknown apps" switch for Converter). */
    static boolean mayInstall(Context context) {
        return Build.VERSION.SDK_INT < 26 || context.getPackageManager().canRequestPackageInstalls();
    }

    /**
     * Updates can install without asking: Android 12+, and the installed copy was itself installed by this app
     * (true from the first update on; the very first install came from the browser).
     */
    @SuppressWarnings("deprecation")
    static boolean canUpdateQuietly(Context context) {
        if (Build.VERSION.SDK_INT < 31 || !mayInstall(context)) return false;
        try {
            String installer = context.getPackageManager().getInstallSourceInfo(context.getPackageName()).getInstallingPackageName();
            return context.getPackageName().equals(installer);
        } catch (Exception e) {
            return false;
        }
    }

    /** Downloads the APK into the app's cache (kept, so an interrupted install can start again quickly). */
    static File download(Context context, Release release) throws IOException {
        File dir = new File(context.getCacheDir(), "updates");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("No room for the update");
        File apk = new File(dir, "Converter-" + release.versionCode + ".apk");
        File[] old = dir.listFiles();
        if (old != null) for (File file : old) if (!file.equals(apk)) file.delete();
        if (apk.length() > 0) return apk;
        File partial = new File(dir, "download.part");
        HttpURLConnection connection = (HttpURLConnection) new URL(release.apkUrl).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(partial)) {
            byte[] buffer = new byte[64 * 1024];
            int n;
            while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
        } finally {
            connection.disconnect();
        }
        if (partial.length() < 100_000 || !partial.renameTo(apk)) {
            partial.delete();
            throw new IOException("The download didn't finish");
        }
        return apk;
    }

    /** Hands the APK to Android's package installer. user: you tapped Install (so a confirmation may be shown). */
    static void install(Context context, File apk, boolean user) throws IOException {
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(context.getPackageName());
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        int sessionId = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(sessionId)) {
            try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("Converter.apk", 0, apk.length())) {
                byte[] buffer = new byte[64 * 1024];
                int n;
                while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
                session.fsync(out);
            }
            Intent intent = new Intent(context, UpdateReceiver.class).setAction(ACTION_STATUS).putExtra(EXTRA_USER, user);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent status = PendingIntent.getBroadcast(context, sessionId, intent, flags);
            lastStatus = "installing";
            session.commit(status.getIntentSender());
        }
    }

    /**
     * Without you: if a newer build signed with the same key exists and it can install without asking, download
     * and install it. Used when you leave the app and by the periodic check (UpdateJobService).
     */
    static void updateQuietly(Context context) {
        try {
            if (!canUpdateQuietly(context) || MainActivity.isVisible()) return;
            Release release = latest(context);
            if (release.versionCode <= installedVersion(context) || !release.sameKey) return;
            File apk = download(context, release);
            if (MainActivity.isVisible()) return;
            install(context, apk, false);
        } catch (Exception e) {
            lastStatus = "failed: " + e.getMessage();
        }
    }

    private static String fetchText(String address) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(10000);
        connection.setUseCaches(false);
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
            StringBuilder body = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) body.append(line);
            return body.toString();
        } finally {
            connection.disconnect();
        }
    }
}
