package com.attenddesk.ui.profile

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Badge
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Face
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.WorkOutline
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import coil.compose.AsyncImage
import com.attenddesk.AppContainer
import com.attenddesk.data.ThemeMode
import com.attenddesk.data.api.FeaturesDto
import com.attenddesk.data.api.MeResponse
import com.attenddesk.data.parseFeatureDisabled
import com.attenddesk.ui.components.ChipTone
import com.attenddesk.ui.components.GradientHeader
import com.attenddesk.ui.components.SectionCard
import com.attenddesk.ui.components.SegmentedTabs
import com.attenddesk.ui.components.StatusChip
import com.attenddesk.ui.components.ThemeModeToggle
import com.attenddesk.ui.components.toneColors
import com.attenddesk.ui.theme.Brand500
import com.attenddesk.ui.theme.Brand700
import com.attenddesk.ui.theme.DangerFg
import com.attenddesk.util.ImageCompress
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.text.SimpleDateFormat
import java.time.OffsetDateTime
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(
    container: AppContainer,
    onBack: () -> Unit,
    onOpenFaceEnroll: () -> Unit,
    onChangePassword: () -> Unit,
    onLoggedOut: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var me by remember { mutableStateOf<MeResponse?>(null) }
    var features by remember { mutableStateOf(FeaturesDto()) }
    var refreshing by remember { mutableStateOf(false) }
    var photoBusy by remember { mutableStateOf(false) }
    var photoError by remember { mutableStateOf<String?>(null) }
    var showPhotoSheet by remember { mutableStateOf(false) }
    var tab by remember { mutableIntStateOf(0) }
    var pendingCameraUri by remember { mutableStateOf<Uri?>(null) }
    val role by container.profileStore.roleFlow.collectAsState(initial = null)
    val email by container.profileStore.emailFlow.collectAsState(initial = null)
    val themeMode by container.themePrefs.themeModeFlow.collectAsState(initial = ThemeMode.System)

    suspend fun load() {
        try { me = container.api.me() } catch (_: Throwable) { }
        try { features = container.policyRepo.get(forceRefresh = true).features } catch (_: Throwable) { }
    }

    fun uploadFromUri(uri: Uri) {
        photoBusy = true; photoError = null
        scope.launch {
            try {
                val bytes = withContext(Dispatchers.IO) { ImageCompress.compressForUpload(context, uri) }
                val body = bytes.toRequestBody("image/jpeg".toMediaType())
                container.api.uploadPhoto(MultipartBody.Part.createFormData("file", "photo.jpg", body))
                load()
            } catch (e: Throwable) {
                if (parseFeatureDisabled(e) != null) {
                    container.policyRepo.invalidate(); load()
                    photoError = "Profile photos have been disabled for your organization."
                } else {
                    android.util.Log.w("ProfileScreen", "photo upload failed", e)
                    photoError = "Couldn't upload photo. Try again."
                }
            } finally { photoBusy = false }
        }
    }

    fun removePhoto() {
        photoBusy = true; photoError = null
        scope.launch {
            try { container.api.deletePhoto(); load() }
            catch (e: Throwable) {
                if (parseFeatureDisabled(e) != null) {
                    container.policyRepo.invalidate(); load()
                    photoError = "Profile photos have been disabled for your organization."
                } else {
                    android.util.Log.w("ProfileScreen", "photo delete failed", e)
                    photoError = "Couldn't remove photo. Try again."
                }
            } finally { photoBusy = false }
        }
    }

    val galleryLauncher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) uploadFromUri(uri)
    }
    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val uri = pendingCameraUri; pendingCameraUri = null
        if (success && uri != null) uploadFromUri(uri)
    }

    LaunchedEffect(Unit) { scope.launch { load() } }

    val canEnrollFace = features.verify.face && features.service.faceEnrollment
    val enrolledAt = me?.faceEnrolledAt
    val displayName = me?.name ?: email ?: "—"
    val displayEmail = email ?: me?.email ?: "—"

    Scaffold(
        topBar = { GradientHeader(title = "My Profile", onBack = onBack) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        androidx.compose.material3.pulltorefresh.PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { refreshing = true; scope.launch { load(); refreshing = false } },
            modifier = Modifier.padding(padding).fillMaxSize(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                // Header card
                SectionCard(padding = PaddingValues(20.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        Avatar(
                            name = displayName,
                            photoUrl = me?.photoUrl,
                            busy = photoBusy,
                            editable = features.service.photos,
                            onClick = { if (features.service.photos) showPhotoSheet = true },
                        )
                        Column(modifier = Modifier.weight(1f)) {
                            Text(displayName, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            Text(displayEmail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.height(6.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                // Role is shown in the Work tab; badge Admin/Dev here (not Employee).
                                when (role ?: me?.role) {
                                    "ADMIN" -> StatusChip(text = "Admin", tone = ChipTone.Info)
                                    "DEV" -> StatusChip(text = "Dev", tone = ChipTone.Info)
                                    else -> {}
                                }
                                if (features.verify.face && enrolledAt != null) {
                                    StatusChip(text = "Face enrolled", tone = ChipTone.Success)
                                }
                            }
                        }
                    }
                    if (photoError != null) {
                        Spacer(Modifier.height(10.dp))
                        Text(photoError!!, color = toneColors(ChipTone.Danger).fg, style = MaterialTheme.typography.bodySmall)
                    }
                }

                SegmentedTabs(tabs = listOf("Personal", "Work"), selected = tab, onSelect = { tab = it })

                if (tab == 0) {
                    SectionCard(title = "Personal Information") {
                        InfoRow(Icons.Outlined.Person, "Full name", displayName)
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        InfoRow(
                            icon = Icons.Outlined.Email,
                            label = "Email",
                            value = displayEmail,
                            onAction = if (displayEmail.contains("@")) {
                                {
                                    val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:$displayEmail"))
                                    runCatching { context.startActivity(intent) }
                                }
                            } else null,
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        InfoRow(Icons.Outlined.Badge, "Employee ID", me?.employeeId?.takeIf { it.isNotBlank() } ?: "—")
                    }
                } else {
                    SectionCard(title = "Work") {
                        InfoRow(Icons.Outlined.Badge, "Designation", me?.designation?.takeIf { it.isNotBlank() } ?: "—")
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        InfoRow(Icons.Outlined.WorkOutline, "Role", (role ?: me?.role ?: "—").lowercase().replaceFirstChar { it.titlecase() })
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        InfoRow(Icons.Outlined.Business, "Department", me?.department?.takeIf { it.isNotBlank() } ?: "—")
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        InfoRow(
                            icon = Icons.Outlined.Face,
                            label = "Face",
                            value = when {
                                !features.verify.face -> "Disabled"
                                enrolledAt != null -> "Enrolled ${formatBdDate(enrolledAt)}"
                                else -> "Not enrolled"
                            },
                        )
                    }
                }

                // Account & security
                val faceSubtitle = when {
                    !features.verify.face -> "Disabled for your organization"
                    enrolledAt != null && canEnrollFace -> "Enrolled ${formatBdDate(enrolledAt)} · tap to re-enroll"
                    enrolledAt != null -> "Enrolled ${formatBdDate(enrolledAt)}"
                    canEnrollFace -> "Tap to enroll your face"
                    else -> "Enrollment disabled — already-enrolled employees still check in"
                }
                SectionCard(title = "Account") {
                    AccountRow(Icons.Outlined.Face, "Face", faceSubtitle, onClick = onOpenFaceEnroll, enabled = canEnrollFace)
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    AccountRow(Icons.Outlined.Lock, "Password", "Change your password", onClick = onChangePassword)
                }

                SectionCard(title = "Appearance") {
                    Text("Choose how the app looks. “System” matches your phone.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(12.dp))
                    ThemeModeToggle(selected = themeMode, onSelect = { mode -> scope.launch { container.themePrefs.setThemeMode(mode) } })
                }

                Spacer(Modifier.height(4.dp))
                Button(
                    onClick = {
                        scope.launch {
                            runCatching { container.locationModeManager.teardownAll() }
                            container.authRepo.logout()
                            onLoggedOut()
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = DangerFg, contentColor = Color.White),
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    shape = MaterialTheme.shapes.small,
                ) {
                    Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.size(8.dp))
                    Text("Sign out")
                }
                Spacer(Modifier.height(12.dp))
            }
        }
    }

    if (showPhotoSheet) {
        val sheetState = rememberModalBottomSheetState()
        ModalBottomSheet(onDismissRequest = { showPhotoSheet = false }, sheetState = sheetState) {
            Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp)) {
                Text("Profile photo", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp))
                SheetAction(Icons.Outlined.PhotoCamera, "Take photo", onClick = {
                    showPhotoSheet = false
                    val uri = newCameraTempUri(context); pendingCameraUri = uri; cameraLauncher.launch(uri)
                })
                SheetAction(Icons.Outlined.PhotoLibrary, "Choose from gallery", onClick = {
                    showPhotoSheet = false
                    galleryLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                })
                if (me?.photoUrl != null) {
                    SheetAction(Icons.Outlined.Delete, "Remove photo", tint = toneColors(ChipTone.Danger).fg, onClick = {
                        showPhotoSheet = false; removePhoto()
                    })
                }
                Spacer(Modifier.height(8.dp))
            }
        }
    }
}

@Composable
private fun InfoRow(icon: ImageVector, label: String, value: String, onAction: (() -> Unit)? = null) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier.size(36.dp).background(Brand500.copy(alpha = 0.10f), CircleShape),
            contentAlignment = Alignment.Center,
        ) { Icon(icon, contentDescription = null, tint = Brand500, modifier = Modifier.size(18.dp)) }
        Column(modifier = Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.bodyLarge)
        }
        if (onAction != null) {
            Icon(
                Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                contentDescription = label,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.clickable(onClick = onAction),
            )
        }
    }
}

@Composable
private fun Avatar(name: String, photoUrl: String?, busy: Boolean, editable: Boolean, onClick: () -> Unit) {
    val initials = name.split(Regex("\\s+")).mapNotNull { it.firstOrNull()?.toString() }.take(2).joinToString("").uppercase().ifBlank { "?" }
    val brush = Brush.linearGradient(listOf(Brand500, Brand700))
    val outerAlpha = if (editable) 1f else 0.78f
    Box(
        modifier = Modifier.size(64.dp).clip(CircleShape).alpha(outerAlpha).clickable(enabled = editable && !busy, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier.size(56.dp).background(brush, CircleShape).border(1.dp, MaterialTheme.colorScheme.outlineVariant, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (photoUrl != null) {
                AsyncImage(model = photoUrl, contentDescription = "Profile photo", contentScale = ContentScale.Crop, modifier = Modifier.size(56.dp).clip(CircleShape))
            } else {
                Text(initials, color = Color.White, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
            }
        }
        if (editable || busy) {
            Box(
                modifier = Modifier.align(Alignment.BottomEnd).size(22.dp).background(MaterialTheme.colorScheme.surface, CircleShape).border(1.dp, MaterialTheme.colorScheme.outlineVariant, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                if (busy) CircularProgressIndicator(modifier = Modifier.size(12.dp), strokeWidth = 1.5.dp, color = MaterialTheme.colorScheme.primary)
                else Icon(Icons.Outlined.Edit, contentDescription = "Edit photo", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(12.dp))
            }
        }
    }
}

@Composable
private fun SheetAction(icon: ImageVector, label: String, onClick: () -> Unit, tint: Color = MaterialTheme.colorScheme.onSurface) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(22.dp))
        Text(label, color = tint, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun AccountRow(icon: ImageVector, title: String, subtitle: String, onClick: () -> Unit, enabled: Boolean = true) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick).padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier.size(36.dp).background(Brand500.copy(alpha = 0.10f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = if (enabled) Brand500 else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (enabled) Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun newCameraTempUri(context: android.content.Context): Uri {
    val dir = File(context.cacheDir, "profile_photos").apply { mkdirs() }
    val file = File(dir, "capture-${System.currentTimeMillis()}.jpg")
    return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
}

private fun formatBdDate(iso: String): String = try {
    val d = OffsetDateTime.parse(iso).toInstant()
    SimpleDateFormat("MMM d, yyyy", Locale.getDefault()).format(Date(d.toEpochMilli()))
} catch (_: Throwable) { iso }
