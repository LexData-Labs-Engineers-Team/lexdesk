package com.attenddesk.ui.remote

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.attenddesk.AppContainer
import com.attenddesk.data.api.RemoteDto
import com.attenddesk.data.api.RemoteSubmitRequest
import com.attenddesk.ui.components.EmptyState
import com.attenddesk.ui.components.GradientHeader
import com.attenddesk.ui.components.LoadingDots
import com.attenddesk.ui.components.SectionCard
import com.attenddesk.ui.requests.RequestStatusChip
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.time.OffsetDateTime
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteScreen(container: AppContainer, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<RemoteDto>?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var showForm by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        runCatching { container.api.listMyRemote().requests }
            .onSuccess { items = it }
            .onFailure { if (items == null) items = emptyList() }
    }
    LaunchedEffect(Unit) { load() }

    val active = items?.firstOrNull { it.status == "working" }
    val past = items?.filter { it.status != "working" } ?: emptyList()

    Scaffold(
        topBar = { GradientHeader(title = "Remote Attendance", onBack = onBack) },
        floatingActionButton = {
            // One active session at a time — hide + while working.
            if (items != null && active == null) {
                FloatingActionButton(onClick = { showForm = true }, containerColor = MaterialTheme.colorScheme.primary) {
                    Icon(Icons.Outlined.Add, contentDescription = "Start remote work", tint = MaterialTheme.colorScheme.onPrimary)
                }
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        androidx.compose.material3.pulltorefresh.PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { refreshing = true; scope.launch { load(); refreshing = false } },
            modifier = Modifier.padding(padding).fillMaxSize(),
        ) {
            if (items == null) {
                Box(Modifier.fillMaxSize(), Alignment.Center) { LoadingDots() }
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    if (active != null) {
                        item(key = "active") {
                            ActiveSessionCard(active, busy) {
                                busy = true; error = null
                                scope.launch {
                                    val ok = runCatching { container.api.doneRemote(active.id) }.isSuccess
                                    busy = false
                                    if (ok) load() else error = "Couldn't mark done. Try again."
                                }
                            }
                        }
                    }
                    if (error != null) {
                        item(key = "err") { Text(error!!, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                    }
                    if (active == null && past.isEmpty()) {
                        item(key = "empty") { EmptyState(title = "No remote sessions", description = "Tap + to start remote work.") }
                    }
                    items(past, key = { it.id }) { r ->
                        RemoteRow(r, onCancel = { scope.launch { runCatching { container.api.cancelRemote(r.id) }; load() } })
                    }
                }
            }
        }
    }

    if (showForm) {
        RemoteStartForm(
            onDismiss = { showForm = false },
            onStart = { reason, place ->
                scope.launch {
                    val ok = runCatching { container.api.submitRemote(RemoteSubmitRequest(reason = reason, place = place)) }.isSuccess
                    if (ok) { showForm = false; load() }
                }
            },
        )
    }
}

@Composable
private fun ActiveSessionCard(r: RemoteDto, busy: Boolean, onDone: () -> Unit) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(r.id) {
        while (true) { now = System.currentTimeMillis(); delay(1000) }
    }
    val startedMs = remember(r.startedAt) { parseIsoMs(r.startedAt) }
    val elapsed = if (startedMs != null) (now - startedMs).coerceAtLeast(0) else 0L
    SectionCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Working", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
                Text("Started ${fmtClock(r.startedAt)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (r.reason.isNotBlank()) Text(r.reason, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(fmtElapsed(elapsed), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(12.dp))
        Button(onClick = onDone, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
            Text(if (busy) "Saving…" else "Done")
        }
    }
}

@Composable
private fun RemoteRow(r: RemoteDto, onCancel: () -> Unit) {
    SectionCard {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text("Remote · ${r.day}", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Text(
                    if (r.durationMinutes != null) fmtDur(r.durationMinutes) else "—",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (r.reason.isNotBlank()) Text(r.reason, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (!r.decisionNote.isNullOrBlank()) Text("Note: ${r.decisionNote}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.width(8.dp))
            RequestStatusChip(r.status)
        }
        if (r.status == "pending") {
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = onCancel) { Text("Cancel") }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RemoteStartForm(onDismiss: () -> Unit, onStart: (String, String) -> Unit) {
    var place by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    val canStart = reason.trim().isNotEmpty()
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            Button(enabled = canStart, onClick = { onStart(reason.trim(), place.trim()) }) { Text("Start work") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        title = { Text("Start remote work") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(value = place, onValueChange = { if (it.length <= 120) place = it }, label = { Text("Location (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = reason, onValueChange = { if (it.length <= 500) reason = it }, label = { Text("Reason") }, minLines = 2, modifier = Modifier.fillMaxWidth())
            }
        },
    )
}

private fun parseIsoMs(iso: String?): Long? =
    iso?.let { runCatching { OffsetDateTime.parse(it).toInstant().toEpochMilli() }.getOrNull() }

private fun fmtClock(iso: String?): String =
    parseIsoMs(iso)?.let { SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(it)) } ?: "—"

private fun fmtElapsed(ms: Long): String {
    val totalSec = ms / 1000
    val h = totalSec / 3600
    val m = (totalSec % 3600) / 60
    val s = totalSec % 60
    return "%02d:%02d:%02d".format(h, m, s)
}

private fun fmtDur(mins: Int): String {
    val h = mins / 60
    val m = mins % 60
    return if (h > 0) "${h}h ${m}m" else "${m}m"
}
