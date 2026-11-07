package io.github.rotfarmer.converter;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

/**
 * Switches the app's icon to the theme's a minute after you leave the app, unless you're back by then (see AppIcon).
 * Android closes the app when the launcher entry it was opened from is switched off, so doing it the moment you leave
 * would close it while you take a photo with the camera app or glance at another app.
 */
public class IconJobService extends JobService {

    private static final int JOB_ID = 4202;
    private static final long AFTER_LEAVING_MS = 60_000;

    /** You left the app: switch the icon in a minute, if it needs switching. Never throws. */
    static void schedule(Context context) {
        try {
            if (!AppIcon.needsChange(context)) return;
            JobScheduler scheduler = context.getSystemService(JobScheduler.class);
            if (scheduler == null) return;
            JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(context, IconJobService.class))
                .setMinimumLatency(AFTER_LEAVING_MS)
                .setOverrideDeadline(AFTER_LEAVING_MS * 5)
                .build();
            scheduler.schedule(job);
        } catch (Throwable t) {
            CrashLog.caught(context, "icon schedule", t);
        }
    }

    /** You're back in the app: not now. */
    static void cancel(Context context) {
        try {
            JobScheduler scheduler = context.getSystemService(JobScheduler.class);
            if (scheduler != null) scheduler.cancel(JOB_ID);
        } catch (Throwable t) {
            CrashLog.caught(context, "icon schedule", t);
        }
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        if (!ConverterActivity.isVisible()) AppIcon.apply(getApplicationContext());
        return false;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return false;
    }
}
