package com.attenddesk.ui.login

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.attenddesk.AppContainer
import com.attenddesk.ui.components.ChipTone
import com.attenddesk.ui.components.GradientButton
import com.attenddesk.ui.components.toneColors
import com.attenddesk.ui.theme.Brand50
import com.attenddesk.ui.theme.Brand500
import com.attenddesk.ui.theme.LocalIsDark
import com.attenddesk.ui.theme.Slate100
import com.attenddesk.ui.theme.Slate400
import com.attenddesk.ui.theme.Slate500
import com.attenddesk.ui.theme.Slate900
import com.attenddesk.ui.theme.SurfaceBgDark
import kotlinx.coroutines.launch

/**
 * Minimalist, typography-led sign-in.
 *
 * Editorial layout: small brand mark top-left, one oversized left-aligned
 * headline, two flat outlined fields with generous whitespace between them,
 * and one filled brand CTA. No cards, no chrome, no decorative gradients
 * beyond the primary button itself.
 */
@Composable
fun LoginScreen(
    container: AppContainer,
    onLoggedIn: (mustChangePw: Boolean) -> Unit,
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()
    val isDark = LocalIsDark.current
    val focusManager = LocalFocusManager.current

    val backgroundColor = if (isDark) SurfaceBgDark else Brand50
    val headlineColor = if (isDark) Slate100 else Slate900
    val bodyMutedColor = if (isDark) Slate400 else Slate500
    val placeholderColor = bodyMutedColor.copy(alpha = 0.85f)

    // displayLarge is not in the project Typography — build it inline so the
    // headline can be properly oversized without touching Type.kt.
    val displayLargeStyle = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 40.sp,
        lineHeight = 44.sp,
        letterSpacing = (-0.025).em,
        color = headlineColor,
    )

    val canSubmit = !loading && email.isNotBlank() && password.isNotBlank()

    val submit: () -> Unit = submit@{
        if (!canSubmit) return@submit
        error = null
        loading = true
        focusManager.clearFocus()
        scope.launch {
            try {
                val res = container.authRepo.login(email.trim(), password)
                onLoggedIn(res.me.mustChangePassword)
            } catch (e: Throwable) {
                error = when (e) {
                    is com.google.firebase.auth.FirebaseAuthInvalidUserException,
                    is com.google.firebase.auth.FirebaseAuthInvalidCredentialsException ->
                        "Wrong email or password."
                    is com.attenddesk.data.LoginBlockedException ->
                        e.message ?: "Sign-in isn't allowed on this device."
                    is java.net.UnknownHostException,
                    is java.net.SocketTimeoutException,
                    is java.io.IOException ->
                        "Can't reach the server. Check your internet and try again."
                    else -> "Sign in failed. Please try again."
                }
            } finally {
                loading = false
            }
        }
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = backgroundColor,
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .imePadding(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp)
                    .padding(top = 96.dp, bottom = 80.dp),
                horizontalAlignment = Alignment.Start,
            ) {
                // Constrain content width so the layout breathes on tablets.
                Column(modifier = Modifier.widthIn(max = 380.dp)) {
                    Spacer(Modifier.height(40.dp))

                    Text(
                        text = "Welcome back.",
                        style = displayLargeStyle,
                    )
                    Spacer(Modifier.height(10.dp))
                    Text(
                        text = "Sign in to mark today's attendance.",
                        style = MaterialTheme.typography.bodyLarge.copy(
                            color = bodyMutedColor,
                        ),
                    )

                    Spacer(Modifier.height(48.dp))

                    if (error != null) {
                        MinimalErrorRow(message = error!!)
                        Spacer(Modifier.height(20.dp))
                    }

                    // Email
                    Text(
                        text = "Email",
                        style = MaterialTheme.typography.labelMedium.copy(
                            color = bodyMutedColor,
                            letterSpacing = 0.04.em,
                        ),
                        modifier = Modifier.padding(start = 4.dp, bottom = 6.dp),
                    )
                    OutlinedTextField(
                        value = email,
                        onValueChange = { email = it },
                        placeholder = {
                            Text(
                                "you@company.com",
                                style = LocalTextStyle.current.copy(color = placeholderColor),
                            )
                        },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Email,
                            imeAction = ImeAction.Next,
                        ),
                        keyboardActions = KeyboardActions(
                            onNext = { focusManager.moveFocus(FocusDirection.Down) },
                        ),
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                        colors = flatFieldColors(isDark),
                    )

                    Spacer(Modifier.height(20.dp))

                    // Password
                    Text(
                        text = "Password",
                        style = MaterialTheme.typography.labelMedium.copy(
                            color = bodyMutedColor,
                            letterSpacing = 0.04.em,
                        ),
                        modifier = Modifier.padding(start = 4.dp, bottom = 6.dp),
                    )
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        placeholder = {
                            Text(
                                "Your password",
                                style = LocalTextStyle.current.copy(color = placeholderColor),
                            )
                        },
                        singleLine = true,
                        visualTransformation = if (passwordVisible) {
                            VisualTransformation.None
                        } else {
                            PasswordVisualTransformation()
                        },
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Password,
                            imeAction = ImeAction.Done,
                        ),
                        keyboardActions = KeyboardActions(
                            onDone = { submit() },
                        ),
                        trailingIcon = {
                            IconButton(onClick = { passwordVisible = !passwordVisible }) {
                                Icon(
                                    imageVector = if (passwordVisible) {
                                        Icons.Outlined.VisibilityOff
                                    } else {
                                        Icons.Outlined.Visibility
                                    },
                                    contentDescription = if (passwordVisible) {
                                        "Hide password"
                                    } else {
                                        "Show password"
                                    },
                                    tint = bodyMutedColor,
                                )
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                        colors = flatFieldColors(isDark),
                    )

                    Spacer(Modifier.height(36.dp))

                    // Primary CTA — filled brand gradient wins against airy whitespace.
                    GradientButton(
                        onClick = submit,
                        enabled = canSubmit,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        if (loading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                                color = Color.White,
                            )
                        } else {
                            Text(
                                text = "Sign in  →",
                                style = MaterialTheme.typography.labelLarge,
                            )
                        }
                    }

                }
            }

        }
    }
}

/**
 * Inline tinted error row — no card, no border, just a soft Danger-tone wash
 * with the standard error icon. Sits flush above the form.
 */
@Composable
private fun MinimalErrorRow(message: String) {
    val tone = toneColors(ChipTone.Danger)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(tone.bg)
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Icon(
            imageVector = Icons.Outlined.ErrorOutline,
            contentDescription = null,
            tint = tone.fg,
            modifier = Modifier.size(18.dp),
        )
        Text(
            text = message,
            color = tone.fg,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

/**
 * Flat OutlinedTextField palette — hairline neutral border at rest, Brand500
 * outline on focus. Keeps the form feeling like ink on paper.
 */
@Composable
private fun flatFieldColors(isDark: Boolean) = OutlinedTextFieldDefaults.colors(
    focusedContainerColor = Color.Transparent,
    unfocusedContainerColor = Color.Transparent,
    disabledContainerColor = Color.Transparent,
    focusedBorderColor = Brand500,
    unfocusedBorderColor = if (isDark) Slate500 else Slate100,
    cursorColor = Brand500,
    focusedTextColor = if (isDark) Slate100 else Slate900,
    unfocusedTextColor = if (isDark) Slate100 else Slate900,
)
