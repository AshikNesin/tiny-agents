package groot.mobile.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import groot.kit.theme.S
import groot.mobile.data.FingerprintCancelled
import groot.mobile.data.api.ApiException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

class StepUpGate internal constructor(private val request: ((String) -> Unit) -> Unit) {
    fun run(action: (token: String) -> Unit) = request(action)
}

@Composable
fun rememberStepUpGate(): StepUpGate {
    val container = LocalContainer.current
    val stepUp = container.stepUp
    val fingerprint = container.fingerprint
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf<((String) -> Unit)?>(null) }
    var askPassword by remember { mutableStateOf(false) }
    var password by remember { mutableStateOf("") }
    var useFingerprint by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    fun close() {
        pending = null
        askPassword = false
        password = ""
        error = null
    }

    fun withFingerprint(action: (String) -> Unit) {
        busy = true
        scope.launch {
            try {
                val token = stepUp.confirm(fingerprint.password(context))
                close()
                action(token)
            } catch (e: CancellationException) {
                throw e
            } catch (e: FingerprintCancelled) {
                askPassword = true
            } catch (e: ApiException) {
                if (e.status == 401) {
                    fingerprint.forget()
                    error = "Your password changed. Enter the new one."
                } else {
                    error = e.message
                }
                askPassword = true
            } catch (e: Exception) {
                error = e.message ?: "Could not confirm."
                askPassword = true
            } finally {
                busy = false
            }
        }
    }

    fun withPassword(action: (String) -> Unit) {
        busy = true
        scope.launch {
            try {
                val typed = password
                val token = stepUp.confirm(typed)
                if (useFingerprint && fingerprint.available() && !fingerprint.saved) {
                    try {
                        fingerprint.save(context, typed)
                    } catch (e: FingerprintCancelled) {
                        useFingerprint = false
                    }
                }
                close()
                action(token)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message ?: "Could not confirm."
            } finally {
                busy = false
            }
        }
    }

    pending?.takeIf { askPassword }?.let { action ->
        AlertDialog(
            onDismissRequest = { close() },
            title = { Text("Confirm it's you") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(S.md)) {
                    Text("Enter your password to continue. It is asked again after five minutes.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Field(
                        value = password,
                        onValueChange = { password = it },
                        placeholder = "Password",
                        password = true,
                        isError = error != null,
                        supporting = error,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    )
                    if (fingerprint.saved) {
                        TextButton(enabled = !busy, onClick = { withFingerprint(action) }) { Text("Use fingerprint") }
                    } else if (fingerprint.available()) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = useFingerprint, onCheckedChange = { useFingerprint = it })
                            Text("Use fingerprint next time")
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !busy && password.isNotEmpty(),
                    onClick = { withPassword(action) },
                ) { Text("Confirm") }
            },
            dismissButton = { TextButton(onClick = { close() }) { Text("Cancel", color = MaterialTheme.colorScheme.onSurfaceVariant) } },
            containerColor = MaterialTheme.colorScheme.surfaceContainer,
        )
    }
    return remember(stepUp) {
        StepUpGate { action ->
            val held = stepUp.current()
            when {
                held != null -> action(held)
                busy -> Unit
                fingerprint.saved -> {
                    pending = action
                    withFingerprint(action)
                }
                else -> {
                    pending = action
                    askPassword = true
                }
            }
        }
    }
}
