package com.example.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

private val DarkColorScheme = darkColorScheme(
    primary = VibrantPrimary,
    secondary = VibrantSecondary,
    tertiary = VibrantWarning,
    background = BackgroundDark,
    surface = SurfaceDark,
    onPrimary = SurfaceLight,
    onSecondary = SurfaceLight,
    onBackground = BackgroundLight,
    onSurface = BackgroundLight,
    primaryContainer = VibrantDark,
    onPrimaryContainer = VibrantContainer,
    errorContainer = VibrantWarningContainer,
    onErrorContainer = OnVibrantWarningContainer,
    outline = OutlineDark
)

private val LightColorScheme = lightColorScheme(
    primary = VibrantPrimary,
    secondary = VibrantSecondary,
    tertiary = VibrantWarning,
    background = BackgroundLight,
    surface = SurfaceLight,
    onPrimary = SurfaceLight,
    onSecondary = SurfaceLight,
    onBackground = VibrantDark,
    onSurface = VibrantDark,
    primaryContainer = VibrantContainer,
    onPrimaryContainer = OnVibrantContainer,
    secondaryContainer = VibrantSecondaryContainer,
    onSecondaryContainer = OnVibrantSecondaryContainer,
    errorContainer = VibrantWarningContainer,
    onErrorContainer = OnVibrantWarningContainer,
    outline = OutlineLight
)

@Composable
fun MyApplicationTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false, // Keep false to strictly showcase our custom Mint-Slate identity!
    content: @Composable () -> Unit,
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
