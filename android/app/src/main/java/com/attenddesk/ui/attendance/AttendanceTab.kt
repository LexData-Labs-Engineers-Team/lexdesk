package com.attenddesk.ui.attendance

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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.EditCalendar
import androidx.compose.material.icons.automirrored.outlined.ListAlt
import androidx.compose.material.icons.outlined.PhonelinkRing
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.RuleFolder
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.attenddesk.AppContainer
import com.attenddesk.data.api.HistoryEvent
import com.attenddesk.ui.Routes
import com.attenddesk.ui.components.DonutChart
import com.attenddesk.ui.components.DonutSegment
import com.attenddesk.ui.components.GradientHeader
import com.attenddesk.ui.components.ModuleGrid
import com.attenddesk.ui.components.ModuleItem
import com.attenddesk.ui.components.SectionCard
import com.attenddesk.ui.theme.Brand500
import com.attenddesk.ui.theme.DonutGreen
import com.attenddesk.ui.theme.MutedBorder
import com.attenddesk.ui.util.DhakaZone
import kotlinx.coroutines.launch
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttendanceTab(
    container: AppContainer,
    onMenu: () -> Unit,
    onBell: () -> Unit,
    onNavigate: (String) -> Unit,
    isManager: Boolean,
) {
    val scope = rememberCoroutineScope()
    var events by remember { mutableStateOf<List<HistoryEvent>?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    suspend fun load() {
        try { events = container.api.history(200).events } catch (_: Throwable) { if (events == null) events = emptyList() }
    }
    LaunchedEffect(Unit) { scope.launch { load() } }

    val today = LocalDate.now(DhakaZone)
    val month = remember(events) { monthSummary(events.orEmpty(), today) }
    val monthLabel = remember(today) {
        today.month.getDisplayName(java.time.format.TextStyle.FULL, java.util.Locale.getDefault())
    }

    val actions = buildList {
        add(ModuleItem("My Attendance", Icons.Outlined.CalendarMonth, onClick = { onNavigate(Routes.MY_ATTENDANCE) }))
        add(ModuleItem("View Attendance", Icons.AutoMirrored.Outlined.ListAlt, onClick = { onNavigate(Routes.TEAM) }))
        add(ModuleItem("QR / Face Att.", Icons.Outlined.QrCodeScanner, onClick = { onNavigate(Routes.CHECK_IN) }))
        add(ModuleItem("Recon. Application", Icons.Outlined.EditCalendar, onClick = { onNavigate(Routes.RECON) }))
        add(ModuleItem("Remote Attendance", Icons.Outlined.PhonelinkRing, onClick = { onNavigate(Routes.REMOTE) }))
        if (isManager) {
            add(ModuleItem("Recon. Approval", Icons.Outlined.RuleFolder, onClick = { onNavigate(Routes.approvals(2)) }))
            add(ModuleItem("Remote Att. Approval", Icons.Outlined.TaskAlt, onClick = { onNavigate(Routes.approvals(3)) }))
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        GradientHeader(title = "Attendance", onMenu = onMenu, onBell = onBell)
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
                SectionCard(title = "Monthly Summary") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        DonutChart(
                            segments = listOf(
                                DonutSegment(month.onTime.toFloat(), DonutGreen),
                                DonutSegment(month.late.toFloat(), Brand500),
                                DonutSegment(month.absent.toFloat(), MutedBorder),
                            ),
                            diameter = 132.dp,
                            ringWidth = 18.dp,
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    "${month.present}",
                                    style = MaterialTheme.typography.headlineSmall,
                                    fontWeight = FontWeight.Bold,
                                )
                                Text(
                                    "of ${month.workingDays} days",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        Spacer(Modifier.size(16.dp))
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Legend(DonutGreen, "On-time", month.onTime)
                            Legend(Brand500, "Late", month.late)
                            Legend(MutedBorder, "Absent", month.absent)
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "$monthLabel so far — working days (excl. Fri/Sat). See everyone's in/out in View Attendance.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                SectionCard(title = "Attendance") {
                    ModuleGrid(items = actions)
                }
                Spacer(Modifier.height(8.dp))
            }
        }
    }
}

@Composable
private fun Legend(color: Color, label: String, count: Int) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(12.dp).clip(CircleShape).background(color))
        Text("$label ($count)", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
    }
}

private data class MonthSummary(
    val present: Int,
    val onTime: Int,
    val late: Int,
    val absent: Int,
    val workingDays: Int,
)

/**
 * Current-month-to-date summary. present = days with a passing check-in this
 * month; absent = elapsed working days (excl. the Fri/Sat Dhaka weekend) not yet
 * present. Holidays aren't available on-device, so a holiday reads as absent.
 */
private fun monthSummary(events: List<HistoryEvent>, today: LocalDate): MonthSummary {
    val stats = computeMonthStats(events, YearMonth.from(today), DhakaZone)
    var workingDays = 0
    var d = today.withDayOfMonth(1)
    while (!d.isAfter(today)) {
        if (d.dayOfWeek != DayOfWeek.FRIDAY && d.dayOfWeek != DayOfWeek.SATURDAY) workingDays++
        d = d.plusDays(1)
    }
    val present = stats.onTimeDays + stats.late
    val absent = (workingDays - present).coerceAtLeast(0)
    return MonthSummary(present, stats.onTimeDays, stats.late, absent, workingDays)
}
