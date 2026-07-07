package com.attenddesk.ui.home

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Login
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.FactCheck
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.attenddesk.AppContainer
import com.attenddesk.BuildConfig
import com.attenddesk.data.api.HistoryEvent
import com.attenddesk.data.api.MeResponse
import com.attenddesk.ui.Routes
import com.attenddesk.ui.attendance.computeMonthStats
import com.attenddesk.ui.attendance.todayCanon
import com.attenddesk.ui.components.ChipTone
import com.attenddesk.ui.components.GradientHeader
import com.attenddesk.ui.components.ModuleGrid
import com.attenddesk.ui.components.ModuleItem
import com.attenddesk.ui.components.SectionCard
import com.attenddesk.ui.components.TimePill
import com.attenddesk.ui.components.toneColors
import com.attenddesk.ui.util.DhakaZone
import com.attenddesk.ui.util.LocalIs24Hour
import com.attenddesk.ui.util.formatClock
import com.attenddesk.ui.util.formatDay
import com.attenddesk.ui.util.formatWeekday
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.YearMonth

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeTab(
    container: AppContainer,
    onMenu: () -> Unit,
    onBell: () -> Unit,
    onNavigate: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val is24h = LocalIs24Hour.current
    var events by remember { mutableStateOf<List<HistoryEvent>?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val role by container.profileStore.roleFlow.collectAsState(initial = null)
    val email by container.profileStore.emailFlow.collectAsState(initial = null)
    var me by remember { mutableStateOf<MeResponse?>(null) }
    // Prefer the real name; fall back to the email prefix only until me() loads.
    val displayName = me?.name?.takeIf { it.isNotBlank() }
        ?: email?.substringBefore('@')?.replaceFirstChar { it.titlecase() }

    suspend fun load() {
        try { events = container.api.history(200).events } catch (_: Throwable) { if (events == null) events = emptyList() }
    }
    LaunchedEffect(Unit) {
        scope.launch { load() }
        scope.launch { runCatching { me = container.api.me() } }
    }

    val today = LocalDate.now(DhakaZone)
    val canon = remember(events) { todayCanon(events.orEmpty(), today, DhakaZone) }
    val stats = remember(events) { computeMonthStats(events.orEmpty(), YearMonth.from(today), DhakaZone) }

    val modules = listOf(
        ModuleItem("Check In / Out", Icons.Outlined.FactCheck, onClick = { onNavigate(Routes.CHECK_IN) }),
        ModuleItem("Assets", Icons.Outlined.Inventory2, onClick = { onNavigate(Routes.ASSETS) }),
        ModuleItem("My Attendance", Icons.Outlined.CalendarMonth, onClick = { onNavigate(Routes.MY_ATTENDANCE) }),
    )

    Column(modifier = Modifier.fillMaxSize()) {
        GradientHeader(
            title = "",
            onMenu = onMenu,
            onBell = onBell,
            bottomContent = {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        displayName?.let { "Hi, $it" } ?: "Welcome",
                        style = MaterialTheme.typography.headlineSmall,
                        color = androidx.compose.ui.graphics.Color.White,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 2,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    )
                    Text(
                        "${formatWeekday(today)}, ${formatDay(today)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = androidx.compose.ui.graphics.Color.White.copy(alpha = 0.8f),
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    TimePill(
                        "In Time",
                        formatClock(canon?.firstCheckIn?.timestamp, is24h, fallback = "—"),
                        Icons.AutoMirrored.Outlined.Login,
                        Modifier.weight(1f),
                    )
                    TimePill(
                        "Out Time",
                        formatClock(canon?.lastCheckOut?.timestamp, is24h, fallback = "—"),
                        Icons.AutoMirrored.Outlined.Logout,
                        Modifier.weight(1f),
                    )
                }
            },
        )

        androidx.compose.material3.pulltorefresh.PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { refreshing = true; scope.launch { load(); refreshing = false } },
            modifier = Modifier.weight(1f).fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                if (role == "ADMIN") AdminBanner()

                SectionCard(title = "Summary") {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SummaryCell("Present", stats.presentDays.toString(), ChipTone.Success, Modifier.weight(1f))
                        SummaryCell("On-time", stats.onTimeDays.toString(), ChipTone.Info, Modifier.weight(1f))
                        SummaryCell("Late", stats.late.toString(), ChipTone.Warn, Modifier.weight(1f))
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "This month · ${YearMonth.from(today).month.name.lowercase().replaceFirstChar { it.titlecase() }}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                SectionCard(title = "Modules") {
                    ModuleGrid(items = modules)
                }
                Spacer(Modifier.height(8.dp))
            }
        }
    }
}

@Composable
private fun SummaryCell(label: String, value: String, tone: ChipTone, modifier: Modifier = Modifier) {
    val c = toneColors(tone)
    Column(
        modifier = modifier
            .height(72.dp)
            .background(c.bg, MaterialTheme.shapes.medium)
            .padding(12.dp),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = c.fg)
        Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = c.fg)
    }
}

@Composable
private fun AdminBanner() {
    val context = LocalContext.current
    val tone = toneColors(ChipTone.Info)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(tone.bg, MaterialTheme.shapes.medium)
            .padding(14.dp),
    ) {
        Text("You're signed in as admin", style = MaterialTheme.typography.titleSmall, color = tone.fg)
        Spacer(Modifier.height(2.dp))
        Text(
            "Use the web dashboard for full controls. Marking attendance from the app still works.",
            style = MaterialTheme.typography.bodySmall,
            color = tone.fg,
        )
        Spacer(Modifier.height(10.dp))
        OutlinedButton(
            onClick = {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.ADMIN_WEB_URL))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
            },
            shape = MaterialTheme.shapes.small,
        ) {
            Icon(Icons.AutoMirrored.Outlined.OpenInNew, contentDescription = null, modifier = Modifier.size(16.dp))
            Spacer(Modifier.size(6.dp))
            Text("Open admin web")
        }
    }
}
