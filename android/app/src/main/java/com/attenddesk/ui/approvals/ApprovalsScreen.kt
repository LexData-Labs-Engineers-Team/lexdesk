package com.attenddesk.ui.approvals

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.attenddesk.AppContainer
import com.attenddesk.data.api.DecisionRequest
import com.attenddesk.ui.components.EmptyState
import com.attenddesk.ui.components.GradientHeader
import com.attenddesk.ui.components.LoadingDots
import com.attenddesk.ui.components.SectionCard
import com.attenddesk.ui.theme.DangerFg
import com.attenddesk.ui.theme.SuccessFg
import kotlinx.coroutines.launch

private val TABS = listOf("Leave", "Asset", "Recon", "Remote")

private class ApprovalItem(
    val id: String,
    val title: String,
    val subtitle: String,
    val decide: suspend (String, String?) -> Unit,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApprovalsScreen(container: AppContainer, onBack: () -> Unit, initialTab: Int = 0) {
    val scope = rememberCoroutineScope()
    var tab by remember { mutableIntStateOf(initialTab.coerceIn(0, TABS.size - 1)) }
    var items by remember { mutableStateOf<List<ApprovalItem>?>(null) }
    var rejecting by remember { mutableStateOf<ApprovalItem?>(null) }

    suspend fun load(which: Int) {
        items = null
        val api = container.api
        val result = runCatching {
            when (which) {
                0 -> api.manageLeave().requests.map { r ->
                    ApprovalItem(r.id, "${r.userName.ifBlank { r.userEmail }} · ${range(r.fromDay, r.toDay)}", "${r.totalDays} day(s) · ${r.subject}") { d, n -> api.decideLeave(r.id, DecisionRequest(d, n)) }
                }
                1 -> api.manageAsset().requests.map { r ->
                    ApprovalItem(r.id, "${r.userName.ifBlank { r.userEmail }} · ${r.assetName}", listOfNotNull(r.assetType.ifBlank { null }, "${r.fromDay} → ${r.toDay}").joinToString(" · ")) { d, n -> api.decideAsset(r.id, DecisionRequest(d, n)) }
                }
                2 -> api.manageRecon().requests.map { r ->
                    ApprovalItem(r.id, "${r.userName.ifBlank { r.userEmail }} · ${r.day}", r.reason) { d, n -> api.decideRecon(r.id, DecisionRequest(d, n)) }
                }
                else -> api.manageRemote().requests.map { r ->
                    val hrs = r.durationMinutes?.let { val h = it / 60; val m = it % 60; if (h > 0) "${h}h ${m}m" else "${m}m" }
                    ApprovalItem(r.id, "${r.userName.ifBlank { r.userEmail }} · ${r.day}", listOfNotNull(hrs, r.reason.ifBlank { null }).joinToString(" · ")) { d, n -> api.decideRemote(r.id, DecisionRequest(d, n)) }
                }
            }
        }
        items = result.getOrDefault(emptyList())
    }

    LaunchedEffect(tab) { load(tab) }

    fun act(item: ApprovalItem, decision: String, note: String?) {
        scope.launch {
            runCatching { item.decide(decision, note) }
            load(tab)
        }
    }

    Scaffold(
        topBar = { GradientHeader(title = "Approvals", onBack = onBack) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            ScrollableTabRow(
                selectedTabIndex = tab,
                containerColor = MaterialTheme.colorScheme.surface,
                edgePadding = 12.dp,
            ) {
                TABS.forEachIndexed { i, label ->
                    Tab(selected = tab == i, onClick = { tab = i }, text = { Text(label) })
                }
            }
            val list = items
            when {
                list == null -> Box(Modifier.fillMaxSize(), Alignment.Center) { LoadingDots() }
                list.isEmpty() -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    EmptyState(title = "Nothing pending", description = "No ${TABS[tab].lowercase()} requests await your approval.")
                }
                else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(list, key = { it.id }) { item ->
                        SectionCard {
                            Text(item.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                            if (item.subtitle.isNotBlank()) {
                                Text(item.subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Spacer(Modifier.height(10.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(
                                    onClick = { act(item, "approved", null) },
                                    colors = ButtonDefaults.buttonColors(containerColor = SuccessFg, contentColor = Color.White),
                                    modifier = Modifier.weight(1f),
                                ) { Text("Approve") }
                                OutlinedButton(
                                    onClick = { rejecting = item },
                                    colors = ButtonDefaults.outlinedButtonColors(contentColor = DangerFg),
                                    modifier = Modifier.weight(1f),
                                ) { Text("Reject") }
                            }
                        }
                    }
                }
            }
        }
    }

    rejecting?.let { item ->
        var note by remember { mutableStateOf("") }
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { rejecting = null },
            confirmButton = {
                Button(onClick = { act(item, "rejected", note.trim().ifBlank { null }); rejecting = null }) { Text("Reject") }
            },
            dismissButton = { TextButton(onClick = { rejecting = null }) { Text("Cancel") } },
            title = { Text("Reject request") },
            text = {
                OutlinedTextField(value = note, onValueChange = { if (it.length <= 300) note = it }, label = { Text("Reason (optional)") }, modifier = Modifier.fillMaxWidth())
            },
        )
    }
}

private fun range(from: String, to: String): String = if (from == to) from else "$from → $to"
