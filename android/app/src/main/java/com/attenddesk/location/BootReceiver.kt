package com.attenddesk.location

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.attenddesk.MainActivity
import com.attenddesk.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Re-bootstraps the location subsystem after device boot or app update.
 *
 * Geofences are wiped by the OS on reboot; the foreground service is killed.
 * WorkManager auto-resumes its periodic schedule natively, so we only need
 * to handle geofence + FGS here.
 */
class BootReceiver : BroadcastReceiver() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) return

        Log.i("BootReceiver", "Re-applying cached location mode after ${intent.action}")
        val pending = goAsync()
        scope.launch {
            try {
                val snap = LocationPrefs.load(context.applicationContext)
                LocationModeManager(context.applicationContext).applyCached()
                // If a 24/7 mode resumed silently after reboot, post a
                // user-facing notification so the user knows tracking
                // started up again without them opening the app.
                if (snap.mode == "continuous") {
                    postBootResumeNotification(context.applicationContext)
                }
            } catch (t: Throwable) {
                Log.w("BootReceiver", "applyCached crashed: ${t.message}")
            } finally {
                pending.finish()
            }
        }
    }

    private fun postBootResumeNotification(context: Context) {
        LocationNotifications.ensureChannels(context)
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
        val intent = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_IMMUTABLE else 0
        val notif = NotificationCompat.Builder(context, LocationNotifications.CHANNEL_STATUS)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("TeamOS resumed location tracking")
            .setContentText("Continuous tracking restarted after your device booted.")
            .setContentIntent(PendingIntent.getActivity(context, 0, intent, flags))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setAutoCancel(true)
            .build()
        runCatching {
            NotificationManagerCompat.from(context)
                .notify(LocationNotifications.NOTIF_ID_STATUS_DEGRADED, notif)
        }
    }
}
