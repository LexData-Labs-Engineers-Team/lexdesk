package com.attenddesk.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.attenddesk.data.ThemeMode

private val LightColors = lightColorScheme(
    primary = Color(0xFF000000),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE5E5E5),
    onPrimaryContainer = Color(0xFF000000),
    secondary = Color(0xFF404040),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFF0F0F0),
    onSecondaryContainer = Color(0xFF000000),
    background = SurfaceBg,
    onBackground = Color(0xFF0A0A0A),
    surface = SurfaceElevated,
    onSurface = Color(0xFF0A0A0A),
    surfaceVariant = Color(0xFFF0F0F0),
    onSurfaceVariant = Color(0xFF414141),
    outline = Color(0xFFAFAFAF),
    outlineVariant = OutlineSubtle,
    error = DangerFg,
    onError = Color.White,
    errorContainer = DangerBg,
    onErrorContainer = DangerFg,
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFF5F5F5),
    onPrimary = Color(0xFF000000),
    primaryContainer = Color(0xFF2A2A2A),
    onPrimaryContainer = Color(0xFFF5F5F5),
    secondary = Color(0xFFD4D4D4),
    onSecondary = Color(0xFF000000),
    secondaryContainer = Color(0xFF2A2A2A),
    onSecondaryContainer = Color(0xFFF5F5F5),
    background = SurfaceBgDark,
    onBackground = Color(0xFFF5F5F5),
    surface = SurfaceElevatedDark,
    onSurface = Color(0xFFF5F5F5),
    surfaceVariant = Color(0xFF2A2A2A),
    onSurfaceVariant = Color(0xFF9B9B9B),
    outline = Color(0xFF414141),
    outlineVariant = OutlineSubtleDark,
    error = DangerFgDark,
    onError = Slate900,
    errorContainer = DangerBgDark,
    onErrorContainer = DangerFgDark,
)

private val AttendDeskShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(20.dp),
)

/**
 * True when the active scheme is dark. Components that need to swap palettes
 * (e.g. status chip tones, soft surfaces) should read this rather than calling
 * [isSystemInDarkTheme] directly so they respect the user's manual override.
 */
val LocalIsDark = staticCompositionLocalOf { false }

@Composable
fun AttendDeskTheme(
    themeMode: ThemeMode = ThemeMode.System,
    content: @Composable () -> Unit,
) {
    val systemDark = isSystemInDarkTheme()
    val isDark = when (themeMode) {
        ThemeMode.System -> systemDark
        ThemeMode.Light  -> false
        ThemeMode.Dark   -> true
    }
    val scheme = if (isDark) DarkColors else LightColors
    CompositionLocalProvider(LocalIsDark provides isDark) {
        MaterialTheme(
            colorScheme = scheme,
            typography = AttendDeskTypography,
            shapes = AttendDeskShapes,
            content = content,
        )
    }
}
