package com.attenddesk.data

import android.content.Context
import java.util.UUID

/**
 * Stable per-install device id for the server's 2-device login cap. A random UUID
 * kept in SharedPreferences (read synchronously so the OkHttp interceptor can add
 * it without blocking on DataStore). Reinstalling/clearing app data rotates it —
 * which then counts as a new device; recover with an admin "reset devices".
 */
object DeviceId {
    private const val PREFS = "device_prefs"
    private const val KEY = "device_id"

    fun get(context: Context): String {
        val sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        var id = sp.getString(KEY, null)
        if (id.isNullOrBlank()) {
            id = UUID.randomUUID().toString()
            sp.edit().putString(KEY, id).apply()
        }
        return id
    }
}
