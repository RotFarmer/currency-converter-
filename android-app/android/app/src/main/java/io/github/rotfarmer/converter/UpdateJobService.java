package io.github.rotfarmer.converter;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

/** Every few hours, with a connection: install a newer build by itself (when that can happen without asking). */
public class UpdateJobService extends JobService {

    private static final int JOB_ID = 4201;
    private static final long EVERY_MS = 6 * 60 * 60 * 1000L;

    /**
     * Schedules the periodic check. It needs ACCESS_NETWORK_STATE (for the "with a connection" condition); without
     * it Android refuses the job by throwing, and that once closed the app on every start, so it can't throw now.
     */
    static void schedule(Context context) {
        try {
            JobScheduler scheduler = context.getSystemService(JobScheduler.class);
            if (scheduler == null || scheduler.getPendingJob(JOB_ID) != null) return;
            JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(context, UpdateJobService.class))
                .setPeriodic(EVERY_MS)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build();
            scheduler.schedule(job);
        } catch (Throwable t) {
            CrashLog.caught(context, "update schedule", t);
        }
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        if (!Updater.canUpdateQuietly(this)) return false;
        new Thread(() -> {
            Updater.updateQuietly(getApplicationContext());
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }
}
