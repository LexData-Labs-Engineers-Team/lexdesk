package com.attenddesk.ui.attendance

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.attenddesk.AppContainer
import com.attenddesk.data.api.HistoryEvent
import com.attenddesk.ui.components.DayTypeBadge
import com.attenddesk.ui.components.EmptyState
import com.attenddesk.ui.components.GradientHeader
import com.attenddesk.ui.components.LoadingDots
import com.attenddesk.ui.components.toneColors
import com.attenddesk.ui.util.DhakaZone
import com.attenddesk.ui.util.LocalIs24Hour
import com.attenddesk.ui.util.formatClock
import com.attenddesk.ui.util.formatDay
import com.attenddesk.ui.util.formatWeekday
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MyAttendanceScreen(container: AppContainer, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var events by remember { mutableStateOf<List<HistoryEvent>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    suspend fun load() {
        try { events = container.api.history(200).events; error = null }
        catch (e: Throwable) { error = e.message ?: "Failed to load" }
    }
    LaunchedEffect(Unit) { scope.launch { load() } }

    Scaffold(
        topBar = { GradientHeader(title = "My Attendance", onBack = onBack) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            val rows = remember(events) { buildDayRows(events.orEmpty(), DhakaZone) }
            androidx.compose.material3.pulltorefresh.PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = { refreshing = true; scope.launch { load(); refreshing = false } },
                modifier = Modifier.fillMaxSize(),
            ) {
                when {
                    events == null && error != null -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                        Text(error!!, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    events == null -> Box(Modifier.fillMaxSize(), Alignment.Center) { LoadingDots() }
                    rows.isEmpty() -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                        EmptyState(title = "No attendance yet", description = "Your daily check-ins will appear here.")
                    }
                    else -> LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 14.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        items(rows, key = { it.date.toString() }) { row -> AttendanceDayCard(row) }
                    }
                }
            }
        }
    }
}

@Composable
private fun AttendanceDayCard(row: DayRow) {
    val is24h = LocalIs24Hour.current
    val accent = toneColors(row.type.tone).fg
    val shape = RoundedCornerShape(14.dp)
    Card(
        modifier = Modifier.fillMaxWidth().shadow(2.dp, shape, clip = false),
        shape = shape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(modifier = Modifier.fillMaxWidth().height(72.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(modifier = Modifier.width(4.dp).fillMaxHeight().background(accent))
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1.3f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(
                        "Date (${formatWeekday(row.date)})",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(formatDay(row.date), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        DayTypeBadge(row.type)
                    }
                }
                TimeColumn("In Time", formatClock(row.inIso, is24h, fallback = "_"), Modifier.weight(1f))
                TimeColumn("Out Time", formatClock(row.outIso, is24h, fallback = "_"), Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun TimeColumn(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
        Text(value, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(0.dp))
    }
}
