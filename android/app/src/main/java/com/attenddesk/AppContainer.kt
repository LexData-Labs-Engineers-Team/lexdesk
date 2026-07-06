package com.attenddesk

import android.content.Context
import androidx.datastore.preferences.preferencesDataStore
import com.attenddesk.checks.AntiCheatRunner
import com.attenddesk.checks.GpsCheck
import com.attenddesk.checks.WifiCheck
import com.attenddesk.data.AuthRepository
import com.attenddesk.data.DeviceId
import com.attenddesk.data.PolicyRepository
import com.attenddesk.data.ProfileStore
import com.attenddesk.data.ReminderPreferences
import com.attenddesk.data.ThemePreferences
import com.attenddesk.data.api.AttendApi
import com.attenddesk.data.api.ApiClient
import com.attenddesk.location.LocationModeManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

val Context.dataStore by preferencesDataStore(name = "attenddesk_prefs")

/**
 * Manual DI container. Kept simple so first build "just works" without Hilt/KSP.
 * Phase-5 hardening: migrate to Hilt for tighter scoping if the codebase grows.
 */
class AppContainer(private val app: App) {
    val profileStore: ProfileStore = ProfileStore(app.dataStore)
    val themePrefs: ThemePreferences = ThemePreferences(app.dataStore)
    val reminderPrefs: ReminderPreferences = ReminderPreferences(app.dataStore)
    val api: AttendApi = ApiClient.build(BuildConfig.API_BASE, DeviceId.get(app))
    val authRepo: AuthRepository = AuthRepository(api, profileStore)
    val policyRepo: PolicyRepository = PolicyRepository(api)
    val wifiCheck: WifiCheck = WifiCheck(app)
    val gpsCheck: GpsCheck = GpsCheck(app)
    val antiCheatRunner: AntiCheatRunner = AntiCheatRunner(wifiCheck, gpsCheck)
    val locationModeManager: LocationModeManager = LocationModeManager(app)

    private val _lastQrToken = MutableStateFlow<String?>(null)
    val lastQrToken: StateFlow<String?> = _lastQrToken
    fun setQrToken(token: String?) { _lastQrToken.value = token }

    /**
     * Cached face embedding (base64) + capture timestamp (epoch millis). Captured by
     * [com.attenddesk.ui.faceverify.FaceVerifyScreen] before the user taps Check IN;
     * included on the next [com.attenddesk.data.api.CheckInRequest] if still fresh.
     */
    private val _lastFaceEmbedding = MutableStateFlow<Pair<String, Long>?>(null)
    val lastFaceEmbedding: StateFlow<Pair<String, Long>?> = _lastFaceEmbedding
    fun setFaceEmbedding(b64: String) {
        _lastFaceEmbedding.value = b64 to System.currentTimeMillis()
    }
    fun clearFaceEmbedding() { _lastFaceEmbedding.value = null }
}

/** How long a captured face embedding is considered fresh for a pending check-in. */
const val FACE_EMBEDDING_TTL_MS = 60_000L
