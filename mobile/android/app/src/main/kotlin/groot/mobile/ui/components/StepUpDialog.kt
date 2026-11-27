package groot.mobile.ui.components

import android.content.Context
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import groot.kit.theme.S
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

class StepUpGate internal constructor(private val request: ((String) -> Unit) -> Unit) {
    fun run(action: (token: String) -> Unit) = request(action)
}

private suspend fun passkeyAssertion(context: Context, optionsJson: String): String {
    val request = GetCredentialRequest(listOf(GetPublicKeyCredentialOption(optionsJson)))
    val credential = CredentialManager.create(context).getCredential(context, request).credential
    return (credential as? PublicKeyCredential)?.authenticationResponseJson
        ?: throw IllegalStateException("That was not a passkey.")
}

@Composable
fun rememberStepUpGate(): StepUpGate {
    val stepUp = LocalContainer.current.stepUp
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf<((String) -> Unit)?>(null) }
    var askPassword by remember { mutableStateOf(false) }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    fun close() {
        pending = null
        askPassword = false
        password = ""
        error = null
    }

    fun confirmWith(action: (String) -> Unit, how: suspend () -> String) {
        busy = true
        scope.launch {
            try {
                val token = how()
                close()
                action(token)
            } catch (e: CancellationException) {
                throw e
            } catch (e: GetCredentialCancellationException) {
                askPassword = true
            } catch (e: NoCredentialException) {
                error = "No passkey for this server on this phone. Add one from the server's Settings in this phone's browser."
                askPassword = true
            } catch (e: Exception) {
                error = e.message ?: "Could not confirm."
                askPassword = true
            } finally {
                busy = false
            }
        }
    }

    fun usePasskey(action: (String) -> Unit) = confirmWith(action) {
        stepUp.confirmWithPasskey { options -> passkeyAssertion(context, options) }
    }

    pending?.takeIf { askPassword }?.let { action ->
        AlertDialog(
            onDismissRequest = { close() },
            title = { Text("Confirm it's you") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(S.md)) {
                    Text("Use your fingerprint, face or password to continue. It is asked again after five minutes.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Field(
                        value = password,
                        onValueChange = { password = it },
                        placeholder = "Password",
                        password = true,
                        isError = error != null,
                        supporting = error,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    )
                    TextButton(enabled = !busy, onClick = { usePasskey(action) }) { Text("Use fingerprint or face") }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !busy && password.isNotEmpty(),
                    onClick = { confirmWith(action) { stepUp.confirm(password) } },
                ) { Text("Confirm") }
            },
            dismissButton = { TextButton(onClick = { close() }) { Text("Cancel", color = MaterialTheme.colorScheme.onSurfaceVariant) } },
            containerColor = MaterialTheme.colorScheme.surfaceContainer,
        )
    }
    return remember(stepUp) {
        StepUpGate { action ->
            val held = stepUp.current()
            if (held != null) {
                action(held)
            } else if (!busy) {
                pending = action
                usePasskey(action)
            }
        }
    }
}
