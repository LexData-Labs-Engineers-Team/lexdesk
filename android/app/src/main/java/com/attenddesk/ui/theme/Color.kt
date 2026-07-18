package com.attenddesk.ui.theme

import androidx.compose.ui.graphics.Color

// Brand ramp — neutralized to grayscale to match the web's monochrome theme
// (black / white / gray). Brand500 is the mid-gray "accent"; every component
// that hard-codes a Brand* color now reads as neutral gray instead of blue.
val Brand50  = Color(0xFFF5F5F5)
val Brand100 = Color(0xFFEDEDED)
val Brand200 = Color(0xFFD4D4D4)
val Brand300 = Color(0xFFB0B0B0)
val Brand400 = Color(0xFF8A8A8A)
val Brand500 = Color(0xFF5A5A5A)
val Brand600 = Color(0xFF3A3A3A)
val Brand700 = Color(0xFF242424)
val Brand800 = Color(0xFF1A1A1A)
val Brand900 = Color(0xFF000000)

// Neutral / slate
val Slate50  = Color(0xFFF8FAFC)
val Slate100 = Color(0xFFF1F5F9)
val Slate200 = Color(0xFFE2E8F0)
val Slate300 = Color(0xFFCBD5E1)
val Slate400 = Color(0xFF94A3B8)
val Slate500 = Color(0xFF64748B)
val Slate600 = Color(0xFF475569)
val Slate700 = Color(0xFF334155)
val Slate800 = Color(0xFF1E293B)
val Slate900 = Color(0xFF0F172A)

// Light surfaces — match web light mode (bg #FFFFFF, card #FFFFFF, border #AFAFAF).
val SurfaceBg       = Color(0xFFFFFFFF)
val SurfaceElevated = Color(0xFFFFFFFF)
val OutlineSubtle   = Color(0xFFE2E2E2)

// Dark surfaces — deep matte black monochrome theme.
val SurfaceBgDark       = Color(0xFF000000)
val SurfaceElevatedDark = Color(0xFF242424)
val OutlineSubtleDark   = Color(0xFF333333)

// Status palette — light (matches web .chip-* / status banner styles)
val SuccessFg     = Color(0xFF047857)
val SuccessBg     = Color(0xFFECFDF5)
val SuccessBorder = Color(0xFFA7F3D0)

val DangerFg     = Color(0xFFB91C1C)
val DangerBg     = Color(0xFFFEF2F2)
val DangerBorder = Color(0xFFFECACA)

val WarnFg     = Color(0xFF92400E)
val WarnBg     = Color(0xFFFFFBEB)
val WarnBorder = Color(0xFFFDE68A)

val InfoFg     = Color(0xFF212121)
val InfoBg     = Color(0xFFECECEC)
val InfoBorder = Color(0xFFD4D4D4)

val MutedFg     = Color(0xFF475569)
val MutedBg     = Color(0xFFF1F5F9)
val MutedBorder = Color(0xFFE2E8F0)

// Status palette — dark (mirrors web dark chip swap: deep bg, light fg, mid border)
val SuccessFgDark     = Color(0xFF6EE7B7) // emerald-300
val SuccessBgDark     = Color(0xFF022C22) // emerald-950
val SuccessBorderDark = Color(0xFF065F46) // emerald-800

val DangerFgDark     = Color(0xFFFCA5A5) // red-300
val DangerBgDark     = Color(0xFF450A0A) // red-950
val DangerBorderDark = Color(0xFF7F1D1D) // red-900

val WarnFgDark     = Color(0xFFFCD34D) // amber-300
val WarnBgDark     = Color(0xFF451A03) // amber-950
val WarnBorderDark = Color(0xFF78350F) // amber-900

val InfoFgDark     = Color(0xFFD4D4D4) // neutral (was brand blue)
val InfoBgDark     = Color(0xFF2A2A2A)
val InfoBorderDark = Color(0xFF404040)

val MutedFgDark     = Color(0xFFCBD5E1) // slate-300
val MutedBgDark     = Color(0xFF1E293B) // slate-800
val MutedBorderDark = Color(0xFF334155) // slate-700

// Calendar dots — bright accent colors that read at 4dp.
val LateDot  = Color(0xFFEAB308) // yellow-500
val EarlyDot = Color(0xFFF97316) // orange-500

// ── Redesign tokens (reference HR app: navy headers, purple icon chips, donut) ──

// Header / hero gradient — deep navy-indigo. Used by GradientHeader; drawn at the
// component level so the Material primary (brand blue) keeps powering buttons.
val Navy700 = Color(0xFF2E2E2E) // top-left, lighter (monochrome header)
val Navy800 = Color(0xFF222222)
val Navy900 = Color(0xFF161616) // bottom-right, deepest

// Icon "chip" behind module/action glyphs — light indigo wash + indigo glyph.
val ChipPurpleBg     = Color(0xFFEDEDED)
val ChipPurpleFg     = Color(0xFF3A3A3A)
val ChipPurpleBgDark = Color(0xFF2A2A2A)
val ChipPurpleFgDark = Color(0xFFE5E5E5)

// Donut / chart accents. The blue slice reuses Brand500.
val DonutGreen = Color(0xFF34C77B) // "remaining" / present (status — kept)
val DonutBlue  = Color(0xFF8A8A8A) // "taken" / late (monochrome)
