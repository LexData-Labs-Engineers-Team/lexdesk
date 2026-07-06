package com.attenddesk.ui.attendance

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.attenddesk.AppContainer
import com.attenddesk.data.api.TeamMemberSummaryDto
import com.attenddesk.ui.components.EmptyState
import com.attenddesk.ui.components.GradientHeader
import com.attenddesk.ui.components.LoadingDots
import com.attenddesk.ui.components.SectionCard
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeamScreen(container: AppContainer, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var members by remember { mutableStateOf<List<TeamMemberSummaryDto>?>(null) }
    var error by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }

    suspend fun load() {
        runCatching { container.api.viewAttendance() }
            .onSuccess { members = it.members; error = false }
            .onFailure { if (members == null) error = true }
    }
    LaunchedEffect(Unit) { load() }

    Scaffold(
        topBar = { GradientHeader(title = "View Attendance", onBack = onBack) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { refreshing = true; scope.launch { load(); refreshing = false } },
            modifier = Modifier.padding(padding).fillMaxSize(),
        ) {
            val list = members
            when {
                list == null && error -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    EmptyState(
                        icon = Icons.Outlined.CloudOff,
                        title = "Couldn't load",
                        description = "Check your connection and pull down to refresh.",
                    )
                }
                list == null -> Box(Modifier.fillMaxSize(), Alignment.Center) { LoadingDots() }
                list.isEmpty() -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    EmptyState(icon = Icons.Outlined.Groups, title = "No attendance", description = "No employee attendance to show yet.")
                }
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(list, key = { it.uid }) { m -> MemberCard(m) }
                }
            }
        }
    }
}

@Composable
private fun MemberCard(m: TeamMemberSummaryDto) {
    SectionCard {
        Text(m.name.ifBlank { m.email }, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(6.dp))
        Text(
            "Today · in ${m.todayIn ?: "—"} · out ${m.todayOut ?: "—"}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
