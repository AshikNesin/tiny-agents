package groot.mobile.feature.manage

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.api.Guest
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.components.AppCard
import groot.mobile.ui.components.Avatar
import groot.mobile.ui.components.ConfirmDialog
import groot.mobile.ui.components.EmptyState
import groot.mobile.ui.components.Field
import groot.mobile.ui.components.IconBtn
import groot.mobile.ui.components.LoadableContent
import groot.mobile.ui.components.PrimaryButton
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.ui.components.Sheet
import groot.mobile.ui.components.rememberResource

@Composable
fun PeopleRoute(container: AppContainer, onBack: () -> Unit) {
    val resource = rememberResource("people") { container.api.guests() }
    var adding by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<Guest?>(null) }
    ScreenScaffold(title = "People", onBack = onBack, actions = { IconBtn(AppIcons.Plus, "Add a guest", onClick = { adding = true }) }) {
        LoadableContent(resource) { guests ->
            if (guests.isEmpty()) {
                EmptyState(
                    "No guests yet",
                    icon = AppIcons.Users,
                    body = "Add someone, then share a bot with them from the bot's settings. They join its chat and see nothing else.",
                    actionLabel = "Add a guest",
                    onAction = { adding = true },
                )
            } else {
                LazyColumn(contentPadding = PaddingValues(S.lg), verticalArrangement = Arrangement.spacedBy(S.sm), modifier = Modifier.fillMaxSize()) {
                    items(guests, key = { it.id }) { guest ->
                        AppCard {
                            Row(horizontalArrangement = Arrangement.spacedBy(S.md), verticalAlignment = Alignment.CenterVertically) {
                                Avatar(guest.name ?: guest.email)
                                Column(Modifier.weight(1f)) {
                                    Text(guest.name ?: guest.email, style = MaterialTheme.typography.bodyLarge)
                                    Text(
                                        listOfNotNull(guest.email.takeIf { guest.name != null }, "${guest.botIds.size} bot(s) shared").joinToString(" · "),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                IconBtn(AppIcons.Trash, "Remove ${guest.name ?: guest.email}", onClick = { removing = guest })
                            }
                        }
                    }
                }
            }
        }
    }
    if (adding) {
        var name by remember { mutableStateOf("") }
        var email by remember { mutableStateOf("") }
        var password by remember { mutableStateOf("") }
        Sheet(onDismiss = { adding = false }, title = "Add a guest") {
            Field(name, { name = it }, label = "Name", placeholder = "Optional")
            Field(email, { email = it }, label = "Email", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
            Field(password, { password = it }, label = "Password", password = true, supporting = "At least 6 characters. Give it to them yourself.")
            PrimaryButton(
                "Add",
                enabled = email.contains('@') && password.length >= MIN_PASSWORD,
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    adding = false
                    resource.act("Could not add the guest.") { container.api.addGuest(email.trim(), password, name.trim().ifEmpty { null }) }
                },
            )
        }
    }
    removing?.let { guest ->
        ConfirmDialog(
            title = "Remove ${guest.name ?: guest.email}?",
            text = "They are signed out at once and lose the chats shared with them.",
            confirmLabel = "Remove",
            destructive = true,
            onConfirm = {
                removing = null
                resource.act("Could not remove the guest.") { container.api.removeGuest(guest.id) }
            },
            onDismiss = { removing = null },
        )
    }
}

private const val MIN_PASSWORD = 6
