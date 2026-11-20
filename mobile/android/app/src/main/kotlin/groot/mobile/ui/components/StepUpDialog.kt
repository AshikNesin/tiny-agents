package groot.mobile.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.input.KeyboardType
import groot.kit.theme.S
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

class StepUpGate internal constructor(private val request: ((String) -> Unit) -> Unit) {
    fun run(action: (token: String) -> Unit) = request(action)
}

@Composable
fun rememberStepUpGate(): StepUpGate {
    val stepUp = LocalContainer.current.stepUp
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf<((String) -> Unit)?>(null) }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    pending?.let { action ->
        AlertDialog(
            onDismissRequest = { pending = null },
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
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !busy && password.isNotEmpty(),
                    onClick = {
                        busy = true
                        scope.launch {
                            try {
                                val token = stepUp.confirm(password)
                                pending = null
                                password = ""
                                error = null
                                action(token)
                            } catch (e: CancellationException) {
                                throw e
                            } catch (e: Exception) {
                                error = e.message ?: "Could not confirm."
                            } finally {
                                busy = false
                            }
                        }
                    },
                ) { Text("Confirm") }
            },
            dismissButton = { TextButton(onClick = { pending = null }) { Text("Cancel", color = MaterialTheme.colorScheme.onSurfaceVariant) } },
            containerColor = MaterialTheme.colorScheme.surfaceContainer,
        )
    }
    return remember(stepUp) {
        StepUpGate { action ->
            val held = stepUp.current()
            if (held != null) action(held) else pending = action
        }
    }
}
