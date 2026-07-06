package com.attenddesk.ui.verification

import android.Manifest
import android.content.pm.PackageManager
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Face
import androidx.compose.material.icons.outlined.QrCode2
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.attenddesk.AppContainer
import com.attenddesk.FACE_EMBEDDING_TTL_MS
import com.attenddesk.checks.CheckBundle
import com.attenddesk.data.api.CheckInRequest
import com.attenddesk.data.api.CheckInResponse
import com.attenddesk.data.api.PolicyResponse
import com.attenddesk.ui.components.ChipTone
import com.attenddesk.ui.components.LoadingDots
import com.attenddesk.ui.components.SectionCard
import com.attenddesk.ui.components.StatusChip
import com.attenddesk.ui.components.toneColors
import com.attenddesk.ui.theme.Brand500
import com.attenddesk.ui.theme.SuccessFg
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val errorJson = Json { ignoreUnknownKeys = true; encodeDefaults = true }

private data class CheckOutcome(
    val ok: Boolean,
    val type: String,
    val results: List<com.attenddesk.data.api.CheckResultDto>,
    val faceMatchScore: Double? = null,
    val isLate: Boolean = false,
    val isEarly: Boolean = false,
    val scheduledStart: String? = null,
    val scheduledEnd: String? = null,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VerificationTab(
    container: AppContainer,
    onOpenPermissions: () -> Unit,
    onOpenFaceEnroll: () -> Unit,
    onVerifyFace: () -> Unit,
    onScanQr: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var policy by remember { mutableStateOf<PolicyResponse?>(null) }
    var bundle by remember { mutableStateOf<CheckBundle?>(null) }
    var outcome by remember { mutableStateOf<CheckOutcome?>(null) }
    var errorText by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val qrToken by container.lastQrToken.collectAsState()
    val faceEmbeddingState by container.lastFaceEmbedding.collectAsState()
    // Features default to "everything enabled" so the UI behaves correctly
    // until /me/policy returns. SUPER_ADMIN-disabled features simply hide
    // their rows once the response arrives.
    val features = policy?.features ?: com.attenddesk.data.api.FeaturesDto()
    val requireFace = features.verify.face && policy?.policy?.requireFace == true
    val faceEmbeddingFresh = faceEmbeddingState != null &&
        System.currentTimeMillis() - faceEmbeddingState!!.second <= FACE_EMBEDDING_TTL_MS

    LaunchedEffect(Unit) {
        try { policy = container.policyRepo.get() } catch (_: Throwable) {}
        if (!hasAllRuntimePerms(context)) {
            onOpenPermissions()
            return@LaunchedEffect
        }
        scope.launch {
            bundle = container.antiCheatRunner.gatherAmbient(policy?.features?.verify)
        }
    }

    var refreshing by remember { mutableStateOf(false) }
    androidx.compose.material3.pulltorefresh.PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            refreshing = true
            scope.launch {
                try {
                    // Force-refresh so policy/office/features changes made in
                    // the admin panel get picked up immediately, not on next
                    // cold start.
                    val freshPolicy = container.policyRepo.get(forceRefresh = true)
                    policy = freshPolicy
                    // Re-apply the location mode too — otherwise a SUPER_ADMIN
                    // flip between manual/geofence/periodic/continuous would
                    // only take effect after backgrounding + resuming the app.
                    runCatching { container.locationModeManager.applyMode(freshPolicy) }
                    bundle = container.antiCheatRunner.gatherAmbient(freshPolicy.features.verify)
                } catch (_: Throwable) { /* keep existing state */ }
                refreshing = false
            }
        },
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            SectionCard(title = "Current environment") {
                if (bundle == null && policy == null) {
                    Row(
                        modifier = Modifier.padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        LoadingDots()
                        Text(
                            "Reading WiFi, GPS and policy…",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else {
                    // Render a row for each verify feature this org actually has
                    // access to. Disabled features are completely hidden — no
                    // "disabled" stub row, no faded text. Server enforcement
                    // mirrors this (the check isn't run at all).
                    var addedAny = false
                    if (features.verify.wifi) {
                        val officeAllowedSsids = policy?.office?.allowedSsids.orEmpty()
                        val officeAllowedBssids = policy?.office?.allowedBssids.orEmpty()
                        val capturedSsid = bundle?.wifi?.ssid?.trim().orEmpty()
                        val capturedBssid = bundle?.wifi?.bssid?.lowercase()?.trim().orEmpty()
                        val wifiOk =
                            (capturedSsid.isNotEmpty() &&
                                officeAllowedSsids.any { it.equals(capturedSsid, ignoreCase = true) }) ||
                            (capturedBssid.isNotEmpty() &&
                                officeAllowedBssids.any { it.lowercase() == capturedBssid })
                        CheckRow(
                            label = "WiFi",
                            required = policy?.policy?.requireWifi == true,
                            ok = wifiOk,
                            detail = bundle?.wifi?.ssid?.let { "SSID: $it" }
                                ?: bundle?.wifi?.bssid?.let { "BSSID: $it" }
                                ?: bundle?.wifi?.reason
                                ?: "no data",
                        )
                        addedAny = true
                    }
                    if (features.verify.gps) {
                        if (addedAny) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        val distanceToOffice: Float? = run {
                            val gLat = bundle?.gps?.lat
                            val gLng = bundle?.gps?.lng
                            val oLat = policy?.office?.lat
                            val oLng = policy?.office?.lng
                            if (gLat == null || gLng == null || oLat == null || oLng == null) null
                            else {
                                val results = FloatArray(1)
                                android.location.Location.distanceBetween(gLat, gLng, oLat, oLng, results)
                                results[0]
                            }
                        }
                        val radiusMeters = policy?.office?.radiusMeters ?: 0
                        val withinGeofence = distanceToOffice != null && distanceToOffice <= radiusMeters
                        val gpsOk = bundle?.gps?.lat != null && bundle?.gps?.isMock != true && withinGeofence
                        val gpsDetail = bundle?.gps?.let {
                            if (it.lat == null) {
                                it.reason ?: "no fix"
                            } else {
                                val distPart = distanceToOffice?.let { d ->
                                    if (radiusMeters > 0)
                                        " · ${d.toInt()}m from office (limit ${radiusMeters}m)"
                                    else
                                        " · ${d.toInt()}m from office"
                                } ?: " · office not set"
                                "${"%.5f".format(it.lat)}, ${"%.5f".format(it.lng ?: 0.0)} (~${it.accuracyMeters?.toInt() ?: -1}m)" +
                                    distPart +
                                    (if (it.isMock) " · MOCK" else "")
                            }
                        } ?: "no data"
                        CheckRow(
                            label = "GPS",
                            required = policy?.policy?.requireGeo == true,
                            ok = gpsOk,
                            detail = gpsDetail,
                        )
                        addedAny = true
                    }
                    if (features.verify.qr) {
                        if (addedAny) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        CheckRow(
                            label = "QR token",
                            required = policy?.policy?.requireQr == true,
                            ok = !qrToken.isNullOrBlank(),
                            detail = qrToken ?: "not scanned",
                        )
                        addedAny = true
                    }
                    if (features.verify.face) {
                        if (addedAny) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        CheckRow(
                            label = "Face",
                            required = requireFace,
                            ok = faceEmbeddingFresh,
                            detail = if (faceEmbeddingFresh) "captured" else "not captured",
                        )
                        addedAny = true
                    }
                }
            }

            // Action tiles row — hide tiles whose corresponding verify feature
            // is disabled at the system level. If none are shown, skip the row
            // entirely so we don't leave an empty band.
            val showQrTile = features.verify.qr
            val showFaceVerifyTile = features.verify.face && requireFace
            val showFaceEnrollTile = features.verify.face && features.service.faceEnrollment && !requireFace
            if (showQrTile || showFaceVerifyTile || showFaceEnrollTile) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    if (showQrTile) {
                        ActionTile(
                            modifier = Modifier.weight(1f),
                            icon = Icons.Outlined.QrCode2,
                            title = if (qrToken == null) "Scan QR" else "Re-scan QR",
                            subtitle = if (qrToken == null) "Scan the office code" else "Token captured",
                            accent = if (qrToken == null) Brand500 else SuccessFg,
                            onClick = onScanQr,
                        )
                    }
                    if (showFaceVerifyTile) {
                        ActionTile(
                            modifier = Modifier.weight(1f),
                            icon = Icons.Outlined.Face,
                            title = if (faceEmbeddingFresh) "Re-capture face" else "Verify face",
                            subtitle = if (faceEmbeddingFresh) "Captured — valid for 60s" else "Capture before check-in",
                            accent = if (faceEmbeddingFresh) SuccessFg else Brand500,
                            onClick = onVerifyFace,
                        )
                    } else if (showFaceEnrollTile) {
                        ActionTile(
                            modifier = Modifier.weight(1f),
                            icon = Icons.Outlined.Face,
                            title = "Enroll face",
                            subtitle = "Add your face vector",
                            accent = Brand500,
                            onClick = onOpenFaceEnroll,
                        )
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                val freshFaceB64 = if (faceEmbeddingFresh) faceEmbeddingState?.first else null
                Button(
                    onClick = {
                        submit(container, scope, "CHECK_IN", bundle, qrToken, freshFaceB64,
                            onResult = { o, err -> outcome = o; errorText = err },
                            onBusy = { busy = it })
                    },
                    enabled = !busy,
                    modifier = Modifier
                        .weight(1f)
                        .height(56.dp),
                    shape = MaterialTheme.shapes.small,
                ) {
                    if (busy) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = Color.White,
                        )
                    } else {
                        Text("Check IN", style = MaterialTheme.typography.titleSmall)
                    }
                }
                OutlinedButton(
                    onClick = {
                        submit(container, scope, "CHECK_OUT", bundle, qrToken, freshFaceB64,
                            onResult = { o, err -> outcome = o; errorText = err },
                            onBusy = { busy = it })
                    },
                    enabled = !busy,
                    modifier = Modifier
                        .weight(1f)
                        .height(56.dp),
                    shape = MaterialTheme.shapes.small,
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = MaterialTheme.colorScheme.primary,
                    ),
                ) {
                    Text("Check OUT", style = MaterialTheme.typography.titleSmall)
                }
            }

            outcome?.let { ResultBlock(it) }
            errorText?.let { ErrorBlock(it) }
        }
    }
}

@Composable
private fun CheckRow(label: String, required: Boolean, ok: Boolean, detail: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.labelLarge)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        val (tone, text) = when {
            !required -> ChipTone.Muted to "optional"
            ok -> ChipTone.Success to "ok"
            else -> ChipTone.Danger to "missing"
        }
        StatusChip(text = text, tone = tone)
    }
}

@Composable
private fun ActionTile(
    modifier: Modifier,
    icon: ImageVector,
    title: String,
    subtitle: String,
    accent: Color,
    onClick: () -> Unit,
) {
    androidx.compose.material3.OutlinedCard(
        onClick = onClick,
        modifier = modifier,
        shape = MaterialTheme.shapes.medium,
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .background(accent.copy(alpha = 0.10f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(imageVector = icon, contentDescription = null, tint = accent, modifier = Modifier.size(18.dp))
            }
            Spacer(Modifier.height(8.dp))
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ResultBlock(o: CheckOutcome) {
    val isOk = o.ok
    val tone = toneColors(if (isOk) ChipTone.Success else ChipTone.Danger)
    val bg = tone.bg
    val fg = tone.fg
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(bg, MaterialTheme.shapes.medium)
            .border(1.dp, tone.border, MaterialTheme.shapes.medium)
            .padding(14.dp),
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(
                    imageVector = if (isOk) Icons.Outlined.CheckCircle else Icons.Outlined.ErrorOutline,
                    contentDescription = null,
                    tint = fg,
                    modifier = Modifier.size(20.dp),
                )
                Text(
                    text = if (isOk) {
                        val verb = if (o.type == "CHECK_IN") "Checked in" else "Checked out"
                        "$verb · ${nowTimeLabel()}"
                    } else {
                        "Check-in failed"
                    },
                    style = MaterialTheme.typography.titleSmall,
                    color = fg,
                )
            }
            if (isOk && o.isLate) {
                Spacer(Modifier.height(6.dp))
                TimingBanner(
                    text = if (o.scheduledStart != null)
                        "Marked as late — office starts at ${o.scheduledStart}"
                    else "Marked as late",
                )
            }
            if (isOk && o.isEarly) {
                Spacer(Modifier.height(6.dp))
                TimingBanner(
                    text = if (o.scheduledEnd != null)
                        "Marked as early leave — office ends at ${o.scheduledEnd}"
                    else "Marked as early leave",
                )
            }
            Spacer(Modifier.height(6.dp))
            o.results.forEach { r ->
                val dotColor = when {
                    r.passed -> toneColors(ChipTone.Success).fg
                    r.required -> toneColors(ChipTone.Danger).fg
                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                }
                val textColor = if (!r.required && !r.passed) fg.copy(alpha = 0.65f) else fg
                val score = if (r.name == "face") o.faceMatchScore else null
                val detail = if (r.passed) "ok" else humanizeReason(r.name, r.reason, score)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.padding(vertical = 1.dp),
                ) {
                    Box(
                        Modifier
                            .size(6.dp)
                            .background(dotColor, CircleShape),
                    )
                    Text(
                        text = "${checkLabel(r.name)}: $detail",
                        style = MaterialTheme.typography.bodySmall,
                        color = textColor,
                    )
                }
            }
        }
    }
}

@Composable
private fun TimingBanner(text: String) {
    val tone = toneColors(ChipTone.Warn)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(tone.bg, MaterialTheme.shapes.small)
            .border(1.dp, tone.border, MaterialTheme.shapes.small)
            .padding(horizontal = 10.dp, vertical = 6.dp),
    ) {
        Text(
            text = text,
            color = tone.fg,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
private fun ErrorBlock(message: String) {
    val tone = toneColors(ChipTone.Danger)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(tone.bg, MaterialTheme.shapes.medium)
            .border(1.dp, tone.border, MaterialTheme.shapes.medium)
            .padding(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(
                imageVector = Icons.Outlined.ErrorOutline,
                contentDescription = null,
                tint = tone.fg,
                modifier = Modifier.size(18.dp),
            )
            Text(text = message, color = tone.fg, style = MaterialTheme.typography.bodySmall)
        }
    }
}

private fun submit(
    container: AppContainer,
    scope: kotlinx.coroutines.CoroutineScope,
    type: String,
    bundle: CheckBundle?,
    qrToken: String?,
    faceEmbeddingB64: String?,
    onResult: (CheckOutcome?, String?) -> Unit,
    onBusy: (Boolean) -> Unit,
) {
    onBusy(true)
    onResult(null, null)
    scope.launch {
        try {
            val req = CheckInRequest(
                type = type,
                lat = bundle?.gps?.lat,
                lng = bundle?.gps?.lng,
                accuracyMeters = bundle?.gps?.accuracyMeters,
                isMockLocation = bundle?.gps?.isMock,
                ssid = bundle?.wifi?.ssid,
                bssid = bundle?.wifi?.bssid,
                qrToken = qrToken,
                faceEmbeddingB64 = faceEmbeddingB64,
                faceLivenessOk = if (faceEmbeddingB64 != null) true else null,
            )
            val res: CheckInResponse = container.api.checkIn(req)
            if (faceEmbeddingB64 != null) container.clearFaceEmbedding()
            if (qrToken != null) container.setQrToken(null)
            onResult(
                CheckOutcome(
                    ok = res.ok,
                    type = type,
                    results = res.results,
                    faceMatchScore = res.faceMatchScore,
                    isLate = res.isLate,
                    isEarly = res.isEarly,
                    scheduledStart = res.scheduledStart,
                    scheduledEnd = res.scheduledEnd,
                ),
                null,
            )
        } catch (e: HttpException) {
            val body = runCatching { e.response()?.errorBody()?.string() }.getOrNull()
            val parsed = body?.let {
                runCatching { errorJson.decodeFromString<CheckInResponse>(it) }.getOrNull()
            }
            if (parsed != null) {
                if (faceEmbeddingB64 != null) container.clearFaceEmbedding()
                if (qrToken != null) container.setQrToken(null)
                onResult(
                    CheckOutcome(
                        ok = parsed.ok,
                        type = type,
                        results = parsed.results,
                        faceMatchScore = parsed.faceMatchScore,
                        isLate = parsed.isLate,
                        isEarly = parsed.isEarly,
                        scheduledStart = parsed.scheduledStart,
                        scheduledEnd = parsed.scheduledEnd,
                    ),
                    null,
                )
            } else {
                onResult(null, "Server error (HTTP ${e.code()}). Try again in a moment.")
            }
        } catch (e: Throwable) {
            onResult(null, "Network error: ${e.message ?: "check your connection"}")
        } finally {
            onBusy(false)
        }
    }
}

private fun hasAllRuntimePerms(context: android.content.Context): Boolean {
    val needed = listOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.CAMERA,
    )
    return needed.all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }
}

private fun checkLabel(name: String): String = when (name) {
    "wifi" -> "WiFi"
    "geo"  -> "GPS"
    "qr"   -> "QR token"
    "face" -> "Face"
    else   -> name.replaceFirstChar { it.titlecase() }
}

private fun humanizeReason(checkName: String, reason: String?, score: Double?): String {
    if (reason == null) return "ok"
    return when (reason) {
        "ssid_and_bssid_not_in_allowlist" -> "Not connected to office WiFi"
        "mock_location"                   -> "Location appears to be faked"
        "missing_location"                -> "No GPS signal — try outside or near a window"
        "low_accuracy"                    -> "GPS signal too weak — wait a moment and retry"
        "outside_geofence"                -> "You're not at the office location"
        "missing_qr_token"                -> "Scan the office QR code first"
        "invalid_qr_token"                -> "QR code is invalid or expired"
        "qr_token_already_used"           -> "QR code already used — wait for a fresh one"
        "face_not_enrolled"               -> "Enroll your face first"
        "missing_face_embedding"          -> "Capture your face before checking in"
        "liveness_failed"                 -> "Keep your eyes open"
        "similarity_below_threshold"      ->
            if (score != null) "Face didn't match (score ${"%.2f".format(score)}) — try better lighting"
            else "Face didn't match — try better lighting"
        "bad_embedding_dim"               -> "Face model mismatch — re-enroll required"
        else -> when {
            reason.startsWith("embedding_decode_error") -> "Face data error — re-enroll required"
            else -> reason
        }
    }
}

private fun nowTimeLabel(): String =
    SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
