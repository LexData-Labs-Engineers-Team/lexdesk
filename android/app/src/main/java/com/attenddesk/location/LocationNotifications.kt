package com.attenddesk.location

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.content.getSystemService

/**
 * Single source of truth for the notification channels the location
 * subsystem uses. Created idempotently on first use — Android dedups.
 */
object LocationNotifications {
    /** ENTER/EXIT geofence reminders. User-facing, dismissible. */
    const val CHANNEL_GEOFENCE = "location_geofence"
    /** Persistent "TeamOS is tracking your location" notification. */
    const val CHANNEL_CONTINUOUS = "location_continuous"
    /** Low-importance status/diagnostic notifications. */
    const val CHANNEL_STATUS = "location_status"
    /** Daily "time to check in" reminder. */
    const val CHANNEL_REMINDER = "attendance_reminder"

    const val NOTIF_ID_GEOFENCE_ENTER = 7001
    const val NOTIF_ID_GEOFENCE_EXIT = 7002
    const val NOTIF_ID_CONTINUOUS_FGS = 7100
    const val NOTIF_ID_STATUS_DEGRADED = 7200
    const val NOTIF_ID_REMINDER = 8000

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val mgr = context.getSystemService<NotificationManager>() ?: return
        if (mgr.getNotificationChannel(CHANNEL_GEOFENCE) == null) {
            mgr.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_GEOFENCE,
                    "Office reminders",
                    NotificationManager.IMPORTANCE_DEFAULT,
                ).apply {
                    description = "Nudges when you arrive at or leave the office."
                },
            )
        }
        if (mgr.getNotificationChannel(CHANNEL_CONTINUOUS) == null) {
            mgr.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_CONTINUOUS,
                    "Continuous location tracking",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = "Shows while TeamOS is recording your location for your employer."
                    setShowBadge(false)
                },
            )
        }
        if (mgr.getNotificationChannel(CHANNEL_STATUS) == null) {
            mgr.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_STATUS,
                    "Status",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = "Diagnostic warnings about background location."
                    setShowBadge(false)
                },
            )
        }
        if (mgr.getNotificationChannel(CHANNEL_REMINDER) == null) {
            mgr.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_REMINDER,
                    "Attendance reminder",
                    NotificationManager.IMPORTANCE_DEFAULT,
                ).apply {
                    description = "Daily reminder to mark your attendance."
                },
            )
        }
    }
}
