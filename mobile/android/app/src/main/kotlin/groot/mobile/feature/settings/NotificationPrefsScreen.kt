package groot.mobile.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.api.NotificationPrefs
import groot.mobile.data.api.NotificationSettingsView
import groot.mobile.data.api.PushoverStatus
import groot.mobile.feature.manage.VaultToggleRow
import groot.mobile.ui.components.AppCard
import groot.mobile.ui.components.Chip
import groot.mobile.ui.components.Field
import groot.mobile.ui.components.LoadableContent
import groot.mobile.ui.components.PrimaryButton
import groot.mobile.ui.components.ScreenColumn
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.ui.components.SecondaryButton
import groot.mobile.ui.components.SectionLabel
import groot.mobile.ui.components.rememberResource
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope

private val DESTINATIONS = listOf("webpush" to "Phone app", "pushover" to "Pushover", "off" to "Off")

internal val CATEGORY_LABELS = mapOf(
    "needs_input" to "Needs you",
    "notify" to "Updates",
    "security" to "Security",
    "system" to "System",
)

@Composable
fun NotificationPrefsRoute(container: AppContainer, onBack: () -> Unit) {
    val resource = rememberResource("notification-prefs") { container.api.notificationSettings() }
    ScreenScaffold(title = "Notifications", onBack = onBack) {
        LoadableContent(resource) { view ->
            var draft by remember(view) { mutableStateOf(view.settings) }
            ScreenColumn {
                DeliveryCard(
                    selected = view.settings.deliverTo,
                    onChoose = { to ->
                        resource.act("Could not change where notifications go.") {
                            container.api.saveNotificationSettings(view.settings.copy(deliverTo = to))
                        }
                    },
                    pushover = { PushoverDetails(container) },
                )
                if (view.settings.deliverTo != "off") {
                    Preferences(view, draft, onChange = { draft = it })
                    PrimaryButton(
                        "Save",
                        enabled = draft != view.settings,
                        modifier = Modifier.fillMaxWidth(),
                        onClick = {
                            resource.act("Could not save notification settings.") {
                                container.api.saveNotificationSettings(draft.copy(deliverTo = view.settings.deliverTo))
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun DeliveryCard(selected: String, onChoose: (String) -> Unit, pushover: @Composable () -> Unit) {
    AppCard {
        Column(verticalArrangement = Arrangement.spacedBy(S.sm)) {
            Text("Send notifications to", style = MaterialTheme.typography.titleSmall)
            Hint("One place at a time, for when a bot needs you or work finishes.")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
                for ((id, label) in DESTINATIONS) {
                    Chip(label, selected = id == selected, onClick = { if (id != selected) onChoose(id) })
                }
            }
            when (selected) {
                "webpush" -> Hint("This phone and any other signed-in phone get them. Settings shows whether this one is receiving.")
                "pushover" -> pushover()
                "off" -> Hint("Nothing is sent. Bots work the same.")
                else -> Hint("Pick one.")
            }
        }
    }
}

@Composable
private fun PushoverDetails(container: AppContainer) {
    val status = rememberResource("pushover-status") { container.api.pushoverStatus() }
    val scope = rememberCoroutineScope()
    var note by remember { mutableStateOf<String?>(null) }
    LoadableContent(status) { pushover ->
        Column(verticalArrangement = Arrangement.spacedBy(S.sm)) {
            Text(pushoverFacts(pushover), style = MaterialTheme.typography.bodyMedium)
            if (pushover.state == "not_configured") {
                Hint("Set ${pushover.requiredEnv.joinToString(" and ")} in the server environment (a Pushover application token and your user key), then restart.")
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(S.sm)) {
                    SecondaryButton("Send test", onClick = {
                        note = "Sending…"
                        scope.launch {
                            note = runCatching { container.api.testPushover() ?: "Sent." }.getOrElse { it.message ?: "Couldn't send." }
                            status.refresh()
                        }
                    })
                    SecondaryButton("Check again", onClick = {
                        status.act("Could not check the credentials.") { container.api.checkPushover() }
                    })
                }
            }
            pushover.lastError?.let { Hint("Last error: $it") }
            note?.let { Hint(it) }
        }
    }
}

internal fun pushoverFacts(status: PushoverStatus): String {
    val state = when (status.state) {
        "connected" -> "Connected"
        "not_configured" -> "Not configured"
        "invalid_credentials" -> "Invalid credentials"
        "over_quota" -> "Over quota"
        else -> "Not checked yet"
    }
    val quota = if (status.quotaRemaining != null && status.quotaLimit != null) {
        "${status.quotaRemaining} of ${status.quotaLimit} left this month"
    } else {
        null
    }
    return listOfNotNull(state, status.devices.takeIf { it.isNotEmpty() }?.joinToString(", "), quota).joinToString(" · ")
}

@Composable
private fun Preferences(view: NotificationSettingsView, draft: NotificationPrefs, onChange: (NotificationPrefs) -> Unit) {
    AppCard {
        Column(verticalArrangement = Arrangement.spacedBy(S.sm)) {
            Text("What to send", style = MaterialTheme.typography.titleSmall)
            Hint("Messages never include tool arguments, outputs or secrets.")
            for (category in view.events.map { it.category }.distinct()) {
                SectionLabel(CATEGORY_LABELS[category] ?: category)
                for (def in view.events.filter { it.category == category }) {
                    VaultToggleRow(
                        title = def.label,
                        summary = if (def.locked) "${def.description} Always on." else def.description,
                        checked = draft.enabled(def),
                        enabled = !def.locked,
                        onChange = { onChange(draft.withEvent(def.event, it)) },
                    )
                }
            }
        }
    }
    AppCard {
        Column(verticalArrangement = Arrangement.spacedBy(S.sm)) {
            Text("Quiet hours", style = MaterialTheme.typography.titleSmall)
            val quiet = draft.quietHours
            VaultToggleRow(
                title = "Hold updates during quiet hours",
                summary = "Updates arrive as one digest when quiet hours end. Requests for your input still arrive, silently.",
                checked = quiet.enabled,
                onChange = { onChange(draft.copy(quietHours = quiet.copy(enabled = it))) },
            )
            if (quiet.enabled) {
                Row(horizontalArrangement = Arrangement.spacedBy(S.sm)) {
                    Field(quiet.start, { onChange(draft.copy(quietHours = quiet.copy(start = it))) }, Modifier.weight(1f), label = "From", placeholder = "22:00")
                    Field(quiet.end, { onChange(draft.copy(quietHours = quiet.copy(end = it))) }, Modifier.weight(1f), label = "Until", placeholder = "07:00")
                }
                Field(quiet.timezone, { onChange(draft.copy(quietHours = quiet.copy(timezone = it))) }, label = "Time zone", placeholder = "Asia/Kolkata")
                VaultToggleRow(
                    title = "Requests for your input still make a sound",
                    summary = "Only approvals and questions break the silence.",
                    checked = quiet.urgentBypass,
                    onChange = { onChange(draft.copy(quietHours = quiet.copy(urgentBypass = it))) },
                )
            }
        }
    }
    AppCard {
        Column(verticalArrangement = Arrangement.spacedBy(S.sm)) {
            Text("Timing", style = MaterialTheme.typography.titleSmall)
            NumberField("Long reply (minutes)", "Replies this long notify when they finish.", draft.longRunMinutes) { onChange(draft.copy(longRunMinutes = it)) }
            NumberField("Reminder (minutes)", "One reminder for unanswered requests. 0 turns it off.", draft.reminderMinutes) { onChange(draft.copy(reminderMinutes = it)) }
            NumberField("Grouping window (seconds)", "Requests from one chat within it arrive as one.", draft.coalesceSeconds) { onChange(draft.copy(coalesceSeconds = it)) }
            if (view.settings.deliverTo == "pushover") {
                Field(draft.device, { onChange(draft.copy(device = it)) }, label = "Pushover device (optional)", placeholder = "All devices")
            }
        }
    }
}

@Composable
private fun NumberField(label: String, hint: String, value: Int, onChange: (Int) -> Unit) {
    var text by remember(value) { mutableStateOf(value.toString()) }
    Field(
        text,
        { typed ->
            text = typed.filter(Char::isDigit)
            text.toIntOrNull()?.let(onChange)
        },
        label = label,
        supporting = hint,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
    )
}

@Composable
private fun Hint(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
