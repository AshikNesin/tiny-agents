package groot.mobile.feature.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import groot.kit.theme.S
import groot.mobile.data.api.ToolCall
import groot.mobile.ui.components.Field
import groot.mobile.ui.components.PrimaryButton
import groot.mobile.ui.components.Sheet

/**
 * The sign-in sheet for a bot's credential request: the owner types what the page needs,
 * the server fills it into the page, and the bot never sees it.
 */
@Composable
fun CredentialSheet(
    call: ToolCall,
    botName: String,
    onSubmit: (values: Map<String, String>, save: Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    val request = call.credentials ?: return
    val values = remember(call.taskId) { mutableStateMapOf<String, String>() }
    var save by remember(call.taskId) { mutableStateOf(false) }
    Sheet(onDismiss = onDismiss, title = request.title) {
        Text(
            "On ${request.origin}. ${request.purpose} What you type goes straight into the page; $botName never sees it.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        for (field in request.fields) {
            val secret = field.type == "password" || field.type == "totp" || field.type == "secret"
            Field(
                value = values[field.key].orEmpty(),
                onValueChange = { values[field.key] = it },
                label = field.label + if (field.required) "" else " (optional)",
                password = secret,
                keyboardOptions = KeyboardOptions(
                    keyboardType = when (field.type) {
                        "password", "secret" -> KeyboardType.Password
                        "email" -> KeyboardType.Email
                        "totp", "number" -> KeyboardType.NumberPassword
                        else -> KeyboardType.Text
                    },
                ),
            )
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(S.md), verticalAlignment = Alignment.CenterVertically) {
            Text("Save to the vault for next time", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Switch(checked = save, onCheckedChange = { save = it })
        }
        val complete = request.fields.all { !it.required || !values[it.key].isNullOrEmpty() }
        PrimaryButton(
            "Fill it in",
            enabled = complete,
            onClick = { onSubmit(values.filterValues { it.isNotEmpty() }, save) },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
