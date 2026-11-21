package groot.mobile.feature.manage

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import groot.kit.theme.S
import groot.mobile.data.api.BotListEntry
import groot.mobile.data.vault.VaultApprovals
import groot.mobile.data.vault.VaultKinds
import groot.mobile.data.vault.VaultPolicyDraft
import groot.mobile.data.vault.isValidHandle
import groot.mobile.data.vault.splitLines
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.components.Chip
import groot.mobile.ui.components.Field
import groot.mobile.ui.components.IconBtn
import java.security.SecureRandom

@Composable
fun VaultValueInput(field: String, value: String, onChange: (String) -> Unit, label: String? = VaultKinds.fieldLabel(field)) {
    if (VaultKinds.isSecret(field)) {
        var shown by remember { mutableStateOf(false) }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(S.xs)) {
            Field(
                value = value,
                onValueChange = onChange,
                modifier = Modifier.weight(1f),
                label = label,
                placeholder = VaultKinds.placeholder(field),
                password = !shown,
                monospace = true,
                keyboardOptions = KeyboardOptions(keyboardType = if (shown) KeyboardType.Ascii else KeyboardType.Password),
            )
            IconBtn(AppIcons.Eye, if (shown) "Hide ${VaultKinds.fieldLabel(field)}" else "Show ${VaultKinds.fieldLabel(field)}", onClick = { shown = !shown })
            if (field == "password") {
                IconBtn(AppIcons.Refresh, "Generate a password", onClick = {
                    onChange(generatePassword())
                    shown = true
                })
            }
        }
    } else {
        Field(
            value = value,
            onValueChange = onChange,
            label = label,
            placeholder = VaultKinds.placeholder(field),
            singleLine = !VaultKinds.isMultiline(field),
            minLines = if (VaultKinds.isMultiline(field)) 2 else 1,
            keyboardOptions = KeyboardOptions(
                keyboardType = when (field) {
                    "identity_email" -> KeyboardType.Email
                    "identity_phone" -> KeyboardType.Phone
                    else -> KeyboardType.Text
                },
            ),
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun VaultPolicyForm(
    kind: String,
    value: VaultPolicyDraft,
    onChange: (VaultPolicyDraft) -> Unit,
    defaultTools: List<String>,
    bots: List<BotListEntry>,
) {
    var originsText by remember { mutableStateOf(value.origins.joinToString("\n")) }
    var hostsText by remember { mutableStateOf(value.hosts.joinToString("\n")) }
    var toolsText by remember { mutableStateOf(value.tools.joinToString(", ")) }
    val card = kind == "card"

    Column(verticalArrangement = Arrangement.spacedBy(S.md)) {
        Field(
            value = value.handle,
            onValueChange = { onChange(value.copy(handle = it.lowercase())) },
            label = "Handle",
            placeholder = "github",
            monospace = true,
            supporting = "The only name bots see. Lowercase letters, digits and dashes.",
            isError = value.handle.isNotEmpty() && !isValidHandle(value.handle),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
        )
        if (VaultKinds.usesWebsite(kind)) {
            Field(
                value = originsText,
                onValueChange = {
                    originsText = it
                    onChange(value.copy(origins = splitLines(it)))
                },
                label = "Fills only on",
                placeholder = "https://github.com",
                singleLine = false,
                minLines = 2,
                supporting = "Exact origins, one per line. Subdomains don't count. Left empty on a new item, its websites are used.",
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            )
        }
        if (kind == "api_key" || "run_command" in value.tools) {
            Field(
                value = hostsText,
                onValueChange = {
                    hostsText = it
                    onChange(value.copy(hosts = splitLines(it)))
                },
                label = "Sent only to",
                placeholder = "api.example.com",
                singleLine = false,
                minLines = 2,
                supporting = "Hostnames the key may go to, one per line.",
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            )
            if (kind == "api_key") {
                Field(
                    value = value.injectName.orEmpty(),
                    onValueChange = { onChange(value.copy(injectName = it, injectFormat = value.injectFormat ?: "{value}")) },
                    label = "Header",
                    placeholder = "Authorization",
                )
                Field(
                    value = value.injectFormat.orEmpty(),
                    onValueChange = { onChange(value.copy(injectFormat = it, injectName = value.injectName ?: "Authorization")) },
                    label = "Format",
                    placeholder = "Bearer {value}",
                    supporting = "{value} is replaced by the key.",
                )
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(S.xs)) {
            Text("Approval", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
                for (approval in VaultApprovals.ORDER) {
                    Chip(
                        VaultApprovals.label(approval),
                        onClick = { onChange(value.copy(approval = approval)) },
                        selected = (if (card) "every_use" else value.approval) == approval,
                        enabled = !card,
                    )
                }
            }
            Text(
                if (card) "Cards always ask, every time." else "Approvals expire after 10 minutes.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        VaultToggleRow(
            title = "Use in routines",
            summary = if (card) {
                "Cards are never used without you present."
            } else {
                "Allow it in routines and messages from other bots (you're still asked when it needs approval)."
            },
            checked = !card && value.allowUnattended,
            enabled = !card,
            onChange = { onChange(value.copy(allowUnattended = it)) },
        )
        Column(verticalArrangement = Arrangement.spacedBy(S.xs)) {
            Text("Bots", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
                Chip("Every bot", onClick = { onChange(value.copy(bots = if (value.bots == null) emptyList() else null)) }, selected = value.bots == null)
                if (value.bots != null) {
                    for (bot in bots) {
                        val picked = bot.id in value.bots
                        Chip(bot.name, onClick = {
                            onChange(value.copy(bots = if (picked) value.bots - bot.id else value.bots + bot.id))
                        }, selected = picked)
                    }
                }
            }
        }
        Field(
            value = toolsText,
            onValueChange = {
                toolsText = it
                onChange(value.copy(tools = splitLines(it)))
            },
            label = "Tools",
            placeholder = defaultTools.joinToString(", "),
            supporting = "Empty: ${defaultTools.joinToString(", ").ifEmpty { "none" }}. Add run_command to pass it to sandbox commands as an env var.",
            monospace = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
        )
        Field(
            value = value.whenToUse,
            onValueChange = { onChange(value.copy(whenToUse = it)) },
            label = "When to use",
            placeholder = "For the work GitHub account",
            supporting = "A hint for the bot.",
        )
    }
}

@Composable
fun VaultToggleRow(title: String, summary: String, checked: Boolean, onChange: (Boolean) -> Unit, enabled: Boolean = true) {
    Row(
        Modifier.fillMaxWidth().clickable(enabled = enabled, role = Role.Switch) { onChange(!checked) }.padding(vertical = S.sm),
        horizontalArrangement = Arrangement.spacedBy(S.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(summary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled)
    }
}

private val random = SecureRandom()
private const val PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%^*-_=+"
private const val PASSWORD_LENGTH = 24

private fun generatePassword(): String = buildString {
    repeat(PASSWORD_LENGTH) { append(PASSWORD_ALPHABET[random.nextInt(PASSWORD_ALPHABET.length)]) }
}
