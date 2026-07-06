package com.attenddesk.ui.permissions

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.MyLocation
import androidx.compose.material.icons.outlined.Wifi
import androidx.compose.material.icons.outlined.WifiFind
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.attenddesk.location.LocationPrefs
import com.attenddesk.ui.components.AppTopBar
import com.attenddesk.ui.components.ChipTone
import com.attenddesk.ui.components.SectionCard
import com.attenddesk.ui.components.StatusChip
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.MultiplePermissionsState
import com.google.accompanist.permissions.PermissionState
import com.google.accompanist.permissions.PermissionStatus
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberMultiplePermissionsState
import com.google.accompanist.permissions.rememberPermissionState
import com.google.accompanist.permissions.shouldShowRationale

@OptIn(ExperimentalPermissionsApi::class, ExperimentalMaterial3Api::class)
@Composable
fun PermissionsScreen(onGranted: () -> Unit) {
    val perms = buildList {
        add(Manifest.permission.ACCESS_FINE_LOCATION)
        add(Manifest.permission.ACCESS_COARSE_LOCATION)
        add(Manifest.permission.CAMERA)
        add(Manifest.permission.ACCESS_WIFI_STATE)
        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.NEARBY_WIFI_DEVICES)
    }
    val state = rememberMultiplePermissionsState(perms)

    // Phase 2: background location. Optional — onGranted fires after Phase 1
    // so users who decline "Allow all the time" aren't locked out of the app.
    val bgState: PermissionState? =
        if (Build.VERSION.SDK_INT >= 29) {
            rememberPermissionState(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        } else {
            null
        }
    val context = LocalContext.current

    // Read the cached location mode so we can tailor the Phase 2 copy. If we
    // don't know (no prior policy fetch), we default to "your organization
    // may turn on..." optional framing.
    var cachedMode by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        runCatching { cachedMode = LocationPrefs.load(context).mode }
    }

    LaunchedEffect(state.allPermissionsGranted) {
        if (state.allPermissionsGranted) onGranted()
    }

    // The Phase 2 prompt is functionally REQUIRED when the org has already
    // opted into a non-manual mode. Reflect that in the copy.
    val bgRequired = cachedMode != null && cachedMode != "manual"
    val modeName = when (cachedMode) {
        "geofence" -> "geofence office reminders"
        "periodic" -> "periodic location audit"
        "continuous" -> "continuous location tracking"
        else -> "background location features"
    }

    Scaffold(
        topBar = { AppTopBar(title = "Permissions") },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Permissions", style = MaterialTheme.typography.titleLarge)
            Text(
                "TeamOS needs the following to verify you're physically at the office. " +
                    "We never upload your photo — only a numeric face vector.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            SectionCard(padding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
                PermRow(
                    icon = Icons.Outlined.LocationOn,
                    name = "Location",
                    reason = "Reads the office WiFi and checks the geofence.",
                    granted = isGranted(state, Manifest.permission.ACCESS_FINE_LOCATION),
                )
                Divider()
                PermRow(
                    icon = Icons.Outlined.Wifi,
                    name = "WiFi state",
                    reason = "Reads the connected SSID/BSSID for the WiFi check.",
                    granted = isGranted(state, Manifest.permission.ACCESS_WIFI_STATE),
                )
                if (Build.VERSION.SDK_INT >= 33) {
                    Divider()
                    PermRow(
                        icon = Icons.Outlined.WifiFind,
                        name = "Nearby WiFi devices",
                        reason = "Android 13+ requires this for current-network info APIs.",
                        granted = isGranted(state, Manifest.permission.NEARBY_WIFI_DEVICES),
                    )
                }
                Divider()
                PermRow(
                    icon = Icons.Outlined.CameraAlt,
                    name = "Camera",
                    reason = "Scans the rotating office QR and runs face verification.",
                    granted = isGranted(state, Manifest.permission.CAMERA),
                )
            }

            Spacer(Modifier.height(4.dp))
            Button(
                onClick = { state.launchMultiplePermissionRequest() },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = MaterialTheme.shapes.small,
                enabled = !state.allPermissionsGranted,
            ) {
                Text(if (state.allPermissionsGranted) "All set" else "Grant permissions")
            }

            // Escape hatch — if the user permanently denied something we can
            // recover by routing them to App Settings. shouldShowRationale
            // returns false BOTH before any prompt AND after a permanent
            // deny; we can't distinguish, so just always show this link when
            // a permission is missing.
            if (!state.allPermissionsGranted) {
                TextButton(
                    onClick = { openAppSettings(context) },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Open app settings")
                }
            }

            // Background location section. Shown only when the foreground
            // bundle has been granted — Android 11+ flat-out refuses to show
            // the system prompt until you've already been granted FG.
            if (state.allPermissionsGranted && bgState != null && !bgState.status.isGranted) {
                Spacer(Modifier.height(8.dp))
                Text(
                    if (bgRequired) "Allow all the time (required by your org)"
                    else "Allow all the time (optional)",
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(
                    buildString {
                        if (bgRequired) {
                            append("Your organization has enabled $modeName. ")
                            append("Until you grant \"Allow all the time\", TeamOS cannot read ")
                            append("your location while the app is closed and you may miss ")
                            append("auto check-ins or location audit entries. ")
                        } else {
                            append("Your organization may enable geofence reminders, periodic ")
                            append("location audit, or continuous tracking. Granting \"Allow ")
                            append("all the time\" lets the app honor those settings. ")
                        }
                        append(
                            "When enabled by your admin: latitude, longitude, accuracy, and a " +
                                "timestamp are uploaded to TeamOS and visible to your " +
                                "organization's administrators. You can grant or revoke this " +
                                "permission at any time in Android Settings.",
                        )
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                SectionCard(padding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
                    PermRow(
                        icon = Icons.Outlined.MyLocation,
                        name = "Background location",
                        reason =
                            if (Build.VERSION.SDK_INT >= 30) {
                                "Tap below — choose \"Allow all the time\" on the next screen."
                            } else {
                                "Required for geofence, periodic, or continuous modes."
                            },
                        granted = bgState.status.isGranted,
                    )
                }
                OutlinedButton(
                    onClick = {
                        if (Build.VERSION.SDK_INT >= 30 && !bgState.status.shouldShowRationale) {
                            // First-time on API 30+: launchPermissionRequest()
                            // takes the user to the per-permission picker
                            // directly. Settings is the fallback once they
                            // permanently deny.
                            bgState.launchPermissionRequest()
                        } else if (Build.VERSION.SDK_INT >= 30) {
                            openAppSettings(context)
                        } else {
                            bgState.launchPermissionRequest()
                        }
                    },
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    shape = MaterialTheme.shapes.small,
                ) {
                    Text(
                        if (Build.VERSION.SDK_INT >= 30 && bgState.status.shouldShowRationale)
                            "Open Settings"
                        else "Allow all the time",
                    )
                }
            }

            Spacer(Modifier.height(4.dp))
            Text(
                "You can revoke any of these in Android Settings later.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private fun openAppSettings(context: android.content.Context) {
    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
        data = Uri.fromParts("package", context.packageName, null)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    runCatching { context.startActivity(intent) }
}

@OptIn(ExperimentalPermissionsApi::class)
private fun isGranted(state: MultiplePermissionsState, name: String): Boolean =
    state.permissions.firstOrNull { it.permission == name }?.status?.isGranted == true

@Composable
private fun PermRow(icon: ImageVector, name: String, reason: String, granted: Boolean) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(22.dp),
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(name, style = MaterialTheme.typography.titleSmall)
            Text(reason, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (granted) {
            StatusChip(text = "Granted", tone = ChipTone.Success)
        } else {
            StatusChip(text = "Needed", tone = ChipTone.Muted, showDot = false)
        }
    }
}

@Composable
private fun Divider() {
    androidx.compose.material3.HorizontalDivider(
        thickness = 1.dp,
        color = MaterialTheme.colorScheme.outlineVariant,
    )
}
