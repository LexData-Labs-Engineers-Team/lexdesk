package com.attenddesk.data.api

import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

object ApiClient {
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        coerceInputValues = true
    }

    fun build(baseUrl: String, deviceId: String): AttendApi {
        val deviceName = (android.os.Build.MODEL ?: "Android").take(80)
        val authInterceptor = Interceptor { chain ->
            val req = chain.request()
            val user = FirebaseAuth.getInstance().currentUser
            val token = if (user != null) {
                runCatching {
                    runBlocking { user.getIdToken(false).await().token }
                }.getOrNull()
            } else null
            // Device identity for the server-side 2-device login cap (see loginGuard.js).
            val builder = req.newBuilder()
                .header("X-Device-Id", deviceId)
                .header("X-Device-Name", deviceName)
            if (token != null) builder.header("Authorization", "Bearer $token")
            chain.proceed(builder.build())
        }

        // On 401, force-refresh the Firebase ID token once and retry.
        // Handles the cold-start case where the cached token is stale.
        val tokenAuthenticator = okhttp3.Authenticator { _, response ->
            if (response.request.header("Authorization") == null) return@Authenticator null
            if (response.priorResponse != null) return@Authenticator null
            val user = FirebaseAuth.getInstance().currentUser ?: return@Authenticator null
            val fresh = runCatching {
                runBlocking { user.getIdToken(true).await().token }
            }.getOrNull() ?: return@Authenticator null
            response.request.newBuilder().header("Authorization", "Bearer $fresh").build()
        }

        // Retry a GET once on a transient failure (IOException/timeout, or a
        // 502/503/504) so a Neon cold-start — the DB waking from auto-suspend —
        // surfaces as a slightly slower load instead of "couldn't load". GET-only,
        // so a POST (e.g. check-in) is never re-sent. Placed after authInterceptor
        // so the retried request keeps its Authorization header; 401s are left to
        // tokenAuthenticator above.
        val retryInterceptor = Interceptor { chain ->
            val request = chain.request()
            if (!request.method.equals("GET", ignoreCase = true)) {
                chain.proceed(request)
            } else {
                try {
                    val response = chain.proceed(request)
                    if (response.code in setOf(502, 503, 504)) {
                        response.close()
                        Thread.sleep(1200)
                        chain.proceed(request)
                    } else {
                        response
                    }
                } catch (e: java.io.IOException) {
                    Thread.sleep(1200)
                    chain.proceed(request)
                }
            }
        }

        val client = OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(retryInterceptor)
            .authenticator(tokenAuthenticator)
            .addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .build()

        val finalUrl = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"
        return Retrofit.Builder()
            .baseUrl(finalUrl)
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(AttendApi::class.java)
    }
}
