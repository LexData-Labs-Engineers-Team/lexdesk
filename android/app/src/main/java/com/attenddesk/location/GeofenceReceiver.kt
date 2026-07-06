package com.attenddesk.location

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.attenddesk.App
import com.attenddesk.MainActivity
import com.attenddesk.R
import com.attenddesk.data.api.CheckInRequest
import com.attenddesk.data.api.LocationPingRequest
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Receives ENTER / EXIT events from [GeofenceController].
 *
 * Behaviour is HYBRID per the org's policy (see LocationPrefs.faceRequired):
 * - If face verify is OFF for the org, we attempt an auto check-in / check-out
 *   directly via /api/v1/me/check-in with GPS-only proof. The server still
 *   enforces all anti-cheat checks; if WiFi/QR/etc. are required and missing,
 *   the call returns 422 and we fall back to a reminder notification.
 * - If face verify is ON, we never attempt an auto check-in — face match
 *   requires a foreground camera. We post a notification asking the user to
 *   open the Verify tab.
 *
 * Either way, the event itself is recorded as a `geofence_enter` /
 * `geofence_exit` location ping for audit.
 */
class GeofenceReceiver : BroadcastReceiver() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_GEOFENCE) return
        val event = GeofencingEvent.fromIntent(intent)
        if (event == null || event.hasError()) {
            Log.w(TAG, "Geofence event error: ${event?.errorCode}")
            return
        }
        val transition = event.geofenceTransition
        val triggering: List<Geofence> = event.triggeringGeofences.orEmpty()
        Log.i(TAG, "Geofence transition=$transition for ${triggering.map { it.requestId }}")

        // BroadcastReceiver.onReceive returns synchronously — kick the work
        // off on IO and let it run. Geofence broadcasts hold a wakelock for
        // a few seconds; we use goAsync() to extend it cleanly.
        val pending: PendingResult = goAsync()
        scope.launch {
            try {
                handle(context, transition, event)
            } catch (t: Throwable) {
                Log.w(TAG, "Geofence handler crashed: ${t.message}")
            } finally {
                pending.finish()
            }
        }
    }

    @SuppressLint("MissingPermission")
    private suspend fun handle(context: Context, transition: Int, event: GeofencingEvent) {
        val app = context.applicationContext as? App ?: return
        val container = app.container
        val snapshot = LocationPrefs.load(context)
        // We may have been triggered after the user disabled the feature
        // mid-session — bail.
        if (snapshot.mode == "manual") {
            Log.i(TAG, "Org is in manual mode; ignoring geofence event")
            return
        }

        val location = event.triggeringLocation
        val nowIso = isoNow()

        // 1) Always record the transition as a location ping.
        val source = when (transition) {
            Geofence.GEOFENCE_TRANSITION_ENTER -> "geofence_enter"
            Geofence.GEOFENCE_TRANSITION_EXIT -> "geofence_exit"
            else -> return
        }
        if (location != null) {
            runCatching {
                container.api.locationPing(
                    LocationPingRequest(
                        lat = location.latitude,
                        lng = location.longitude,
                        accuracy = location.accuracy.toDouble(),
                        capturedAt = nowIso,
                        source = source,
                        isMockLocation = isMockLocation(location),
                    ),
                )
            }.onFailure { Log.w(TAG, "ping failed: ${it.message}") }
        }

        // 2) Hybrid: if face is NOT required, attempt an auto-checkin/out.
        //    If it IS required, post a reminder notification.
        if (!snapshot.faceRequired && location != null) {
            val type = if (transition == Geofence.GEOFENCE_TRANSITION_ENTER) "CHECK_IN" else "CHECK_OUT"
            val attempted = runCatching {
                container.api.checkIn(
                    CheckInRequest(
                        type = type,
                        lat = location.latitude,
                        lng = location.longitude,
                        accuracyMeters = location.accuracy.toDouble(),
                        isMockLocation = isMockLocation(location),
                        // No SSID/QR/face — server will reject if any of those
                        // are required. That's fine; the notification fallback
                        // covers it.
                    ),
                )
            }
            if (attempted.isFailure || attempted.getOrNull()?.ok != true) {
                Log.i(TAG, "Auto check-in did not pass; falling back to notification")
                postNotification(context, transition, autoCheckedIn = false)
            } else {
                Log.i(TAG, "Auto check-in succeeded via geofence")
                // Surface the action to the user — Play policy requires that
                // any background-triggered behavior visible to the user be
                // disclosed at the time it happens.
                postNotification(context, transition, autoCheckedIn = true)
            }
        } else {
            postNotification(context, transition, autoCheckedIn = false)
        }
    }

    private fun postNotification(context: Context, transition: Int, autoCheckedIn: Boolean) {
        LocationNotifications.ensureChannels(context)
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return

        val (title, body, notifId) =
            if (transition == Geofence.GEOFENCE_TRANSITION_ENTER) {
                Triple(
                    if (autoCheckedIn) "TeamOS checked you in" else "You arrived at the office",
                    if (autoCheckedIn) "Auto check-in succeeded at the office geofence."
                    else "Tap to check in.",
                    LocationNotifications.NOTIF_ID_GEOFENCE_ENTER,
                )
            } else {
                Triple(
                    if (autoCheckedIn) "TeamOS checked you out" else "You left the office",
                    if (autoCheckedIn) "Auto check-out succeeded when you left the geofence."
                    else "Tap to check out.",
                    LocationNotifications.NOTIF_ID_GEOFENCE_EXIT,
                )
            }
        val contentIntent = PendingIntent.getActivity(
            context,
            notifId,
            Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or
                if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_IMMUTABLE else 0,
        )
        val notif = NotificationCompat.Builder(context, LocationNotifications.CHANNEL_GEOFENCE)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(notifId, notif) }
    }

    private fun isMockLocation(location: android.location.Location): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            location.isMock
        } else {
            @Suppress("DEPRECATION") location.isFromMockProvider
        }
    }

    companion object {
        const val ACTION_GEOFENCE = "com.attenddesk.location.ACTION_GEOFENCE"
        private const val TAG = "GeofenceReceiver"

        fun isoNow(): String {
            val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            fmt.timeZone = TimeZone.getTimeZone("UTC")
            return fmt.format(Date())
        }
    }
}
