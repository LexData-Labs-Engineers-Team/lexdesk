package com.attenddesk.ui.main

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.EventAvailable
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.QrCode2
import androidx.compose.material.icons.outlined.RuleFolder
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.attenddesk.AppContainer
import com.attenddesk.BuildConfig
import com.attenddesk.data.TimeFormat
import com.attenddesk.data.api.MeResponse
import com.attenddesk.ui.Routes
import com.attenddesk.ui.attendance.AttendanceTab
import com.attenddesk.ui.components.AppDrawer
import com.attenddesk.ui.components.DrawerItem
import com.attenddesk.ui.home.HomeTab
import com.attenddesk.ui.leaves.LeaveTab
import kotlinx.coroutines.launch

private enum class Tab(val label: String, val icon: ImageVector) {
    Home("Home", Icons.Outlined.Home),
    Attendance("Attendance", Icons.Outlined.CalendarMonth),
    Leave("Leave", Icons.Outlined.EventAvailable),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(
    container: AppContainer,
    onNavigate: (String) -> Unit,
    onLoggedOut: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    var selected by rememberSaveable { mutableIntStateOf(0) }
    var leavesEnabled by remember { mutableStateOf(true) }
    var me by remember { mutableStateOf<MeResponse?>(null) }
    var isLeader by remember { mutableStateOf(false) }
    val role by container.profileStore.roleFlow.collectAsState(initial = null)
    val email by container.profileStore.emailFlow.collectAsState(initial = null)
    val timeFormat by container.themePrefs.timeFormatFlow.collectAsState(initial = TimeFormat.H12)

    val roleUpper = (role ?: me?.role ?: "").uppercase()
    val isManager = roleUpper == "ADMIN" || roleUpper == "SUPER_ADMIN" || roleUpper == "SUPERADMIN" || isLeader

    LaunchedEffect(Unit) {
        scope.launch {
            try {
                val policy = container.policyRepo.get(forceRefresh = true)
                leavesEnabled = policy.features.service.leaveRequests
                runCatching { container.locationModeManager.applyMode(policy) }
            } catch (_: Throwable) { }
        }
        scope.launch { runCatching { me = container.api.me() } }
        scope.launch { runCatching { isLeader = container.api.teamSummary().isLeader } }
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        var lastResumeMs = 0L
        val observer = LifecycleEventObserver { _, event ->
            if (event != Lifecycle.Event.ON_RESUME) return@LifecycleEventObserver
            val now = System.currentTimeMillis()
            if (now - lastResumeMs < 60_000L) return@LifecycleEventObserver
            lastResumeMs = now
            scope.launch {
                try {
                    val policy = container.policyRepo.get(forceRefresh = true)
                    leavesEnabled = policy.features.service.leaveRequests
                    runCatching { container.locationModeManager.applyMode(policy) }
                } catch (_: Throwable) { }
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val visibleTabs = remember(leavesEnabled) { Tab.entries.filter { it != Tab.Leave || leavesEnabled } }
    if (selected >= visibleTabs.size) selected = 0
    val tab = visibleTabs[selected]

    fun closeThen(route: String) {
        scope.launch { drawerState.close() }
        onNavigate(route)
    }

    val drawerItems = buildList {
        add(DrawerItem("Home", Icons.Outlined.Home) {
            val idx = visibleTabs.indexOf(Tab.Home); if (idx >= 0) selected = idx
            scope.launch { drawerState.close() }
        })
        add(DrawerItem("Attendance Reminder", Icons.Outlined.NotificationsActive) { closeThen(Routes.ATT_REMINDER) })
        if (isManager) add(DrawerItem("Approvals", Icons.Outlined.RuleFolder) { closeThen(Routes.approvals(0)) })
        add(DrawerItem("My QR Code", Icons.Outlined.QrCode2) { closeThen(Routes.MY_QR) })
        add(DrawerItem("My Profile", Icons.Outlined.Person) { closeThen(Routes.PROFILE) })
        add(DrawerItem("My Notice Board", Icons.Outlined.Campaign) { closeThen(Routes.NOTICES) })
        add(DrawerItem("Change Password", Icons.Outlined.Lock) { closeThen(Routes.SET_PW) })
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            AppDrawer(
                name = me?.name ?: email ?: "—",
                role = roleUpper.lowercase().replaceFirstChar { it.titlecase() },
                photoUrl = me?.photoUrl,
                items = drawerItems,
                is24h = timeFormat == TimeFormat.H24,
                onToggleTime = { is24 -> scope.launch { container.themePrefs.setTimeFormat(if (is24) TimeFormat.H24 else TimeFormat.H12) } },
                onLogout = {
                    scope.launch {
                        drawerState.close()
                        runCatching { container.locationModeManager.teardownAll() }
                        container.authRepo.logout()
                        onLoggedOut()
                    }
                },
                version = BuildConfig.VERSION_NAME,
            )
        },
    ) {
        Scaffold(
            bottomBar = {
                NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                    visibleTabs.forEachIndexed { index, t ->
                        NavigationBarItem(
                            selected = selected == index,
                            onClick = { selected = index },
                            icon = { Icon(t.icon, contentDescription = t.label) },
                            label = { Text(t.label) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = MaterialTheme.colorScheme.primary,
                                selectedTextColor = MaterialTheme.colorScheme.primary,
                                indicatorColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.10f),
                            ),
                        )
                    }
                }
            },
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            containerColor = MaterialTheme.colorScheme.background,
        ) { padding ->
            val onMenu = { scope.launch { drawerState.open() }; Unit }
            val onBell = { onNavigate(Routes.NOTIFICATIONS) }
            Box(
                modifier = Modifier.padding(padding).fillMaxSize().background(MaterialTheme.colorScheme.background),
            ) {
                when (tab) {
                    Tab.Home -> HomeTab(container = container, onMenu = onMenu, onBell = onBell, onNavigate = onNavigate)
                    Tab.Attendance -> AttendanceTab(container = container, onMenu = onMenu, onBell = onBell, onNavigate = onNavigate, isManager = isManager)
                    Tab.Leave -> LeaveTab(
                        container = container,
                        onMenu = onMenu,
                        onBell = onBell,
                        onNavigate = onNavigate,
                        onFeatureDisabled = { leavesEnabled = false; selected = 0 },
                    )
                }
            }
        }
    }
}
