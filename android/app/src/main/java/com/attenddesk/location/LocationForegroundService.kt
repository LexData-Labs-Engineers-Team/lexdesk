package com.attenddesk.location

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.attenddesk.App
import com.attenddesk.MainActivity
import com.attenddesk.R
import com.attenddesk.data.api.LocationPingRequest
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Continuous-mode foreground service. Runs 24/7 while the org's location
 * mode is `continuous`, streaming location fixes to /me/location-ping at
 * the configured cadence. Persistent notification is always visible.
 *
 * Starts via [start] (called from LocationModeManager.applyMode and
 * BootReceiver). Stops via [stop] or its built-in Stop action.
 */
class LocationForegroundService : Service() {

    private lateinit var client: FusedLocationProviderClient
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var intervalSeconds: Int = 60

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val loc = result.lastLocation ?: return
            scope.launch { sendPing(loc) }
        }
    }

    override fun onCreate() {
        super.onCreate()
        client = LocationServices.getFusedLocationProviderClient(this)
        LocationNotifications.ensureChannels(this)
    }

    @SuppressLint("MissingPermission")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopForegroundCompat()
            stopSelf()
            return START_NOT_STICKY
        }
        intervalSeconds = intent?.getIntExtra(EXTRA_INTERVAL_SECONDS, 60) ?: 60

        // Foreground promotion. If we don't have BG location permission yet,
        // promoting to FGS still works but we'll silently fail to read
        // location until the user grants permission.
        val notif = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                LocationNotifications.NOTIF_ID_CONTINUOUS_FGS,
                notif,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            )
        } else {
            startForeground(LocationNotifications.NOTIF_ID_CONTINUOUS_FGS, notif)
        }

        if (!hasFineLocation(this)) {
            Log.w(TAG, "FGS started but ACCESS_FINE_LOCATION not granted; not subscribing")
            return START_STICKY
        }

        val req = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            intervalSeconds * 1000L,
        )
            .setMinUpdateIntervalMillis((intervalSeconds * 1000L) / 2)
            .build()
        runCatching {
            client.requestLocationUpdates(req, callback, Looper.getMainLooper())
        }.onFailure { Log.w(TAG, "requestLocationUpdates failed: ${it.message}") }
        return START_STICKY
    }

    override fun onDestroy() {
        runCatching { client.removeLocationUpdates(callback) }
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= 24) {
            stopForeground(Service.STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION") stopForeground(true)
        }
    }

    // Minimal-but-compliant. Android requires SOME notification while the
    // location FGS is running, and Play policy requires it disclose that
    // tracking is happening — done by the title + channel description (see
    // LocationNotifications.kt). PRIORITY_MIN + VISIBILITY_SECRET keep it
    // out of the lock screen and out of the main notification section.
    private fun buildNotification() = NotificationCompat.Builder(
        this, LocationNotifications.CHANNEL_CONTINUOUS,
    )
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle("TeamOS · location")
        .setContentText("Background tracking is on.")
        .setOngoing(true)
        .setPriority(NotificationCompat.PRIORITY_MIN)
        .setVisibility(NotificationCompat.VISIBILITY_SECRET)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setShowWhen(false)
        .setContentIntent(
            PendingIntent.getActivity(
                this, 0,
                Intent(this, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                },
                PendingIntent.FLAG_UPDATE_CURRENT or
                    if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_IMMUTABLE else 0,
            ),
        )
        .addAction(
            0, "Stop",
            PendingIntent.getService(
                this, 1,
                Intent(this, LocationForegroundService::class.java).apply { action = ACTION_STOP },
                PendingIntent.FLAG_UPDATE_CURRENT or
                    if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_IMMUTABLE else 0,
            ),
        )
        .build()

    private suspend fun sendPing(loc: Location) {
        val app = applicationContext as? App ?: return
        val isMock = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) loc.isMock
        else @Suppress("DEPRECATION") loc.isFromMockProvider
        runCatching {
            app.container.api.locationPing(
                LocationPingRequest(
                    lat = loc.latitude,
                    lng = loc.longitude,
                    accuracy = loc.accuracy.toDouble(),
                    capturedAt = GeofenceReceiver.isoNow(),
                    source = "continuous",
                    isMockLocation = isMock,
                ),
            )
        }.onFailure {
            if (it is retrofit2.HttpException && it.code() == 403) {
                Log.i(TAG, "Server returned 403; stopping FGS")
                stop(applicationContext)
            } else {
                Log.w(TAG, "ping failed: ${it.message}")
            }
        }
    }

    companion object {
        private const val TAG = "LocationFGS"
        const val ACTION_STOP = "com.attenddesk.location.STOP_FGS"
        const val EXTRA_INTERVAL_SECONDS = "intervalSeconds"

        fun start(context: Context, intervalSeconds: Int) {
            if (!hasFineLocation(context)) {
                Log.i(TAG, "Not starting FGS — ACCESS_FINE_LOCATION missing")
                return
            }
            val intent = Intent(context, LocationForegroundService::class.java).apply {
                putExtra(EXTRA_INTERVAL_SECONDS, intervalSeconds)
            }
            runCatching { ContextCompat.startForegroundService(context, intent) }
                .onFailure { Log.w(TAG, "startForegroundService failed: ${it.message}") }
        }

        fun stop(context: Context) {
            runCatching {
                context.stopService(Intent(context, LocationForegroundService::class.java))
            }
        }

        private fun hasFineLocation(context: Context): Boolean =
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.ACCESS_FINE_LOCATION,
            ) == PackageManager.PERMISSION_GRANTED
    }
}
