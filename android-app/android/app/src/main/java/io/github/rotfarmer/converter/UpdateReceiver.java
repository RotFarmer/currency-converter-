package io.github.rotfarmer.converter;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

/** Android's package installer reporting on an update: ask you to confirm it, or note that it failed. */
public class UpdateReceiver extends BroadcastReceiver {

    @Override
    @SuppressWarnings("deprecation")
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            // Only show Android's "Update this app?" screen when you asked for the update.
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null && intent.getBooleanExtra(Updater.EXTRA_USER, false)) {
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(confirm);
                Updater.lastStatus = "confirm";
            } else {
                Updater.lastStatus = null;
            }
        } else if (status == PackageInstaller.STATUS_SUCCESS) {
            Updater.lastStatus = "installed";
        } else {
            String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            Updater.lastStatus = "failed: " + (message == null ? "the update couldn't be installed" : message);
        }
    }
}
