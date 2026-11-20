package groot.mobile.feature.manage

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.api.VaultItem
import groot.mobile.data.api.VaultItemDetail
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.components.AppCard
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.EmptyState
import groot.mobile.ui.components.IconBtn
import groot.mobile.ui.components.Loadable
import groot.mobile.ui.components.LoadableContent
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.ui.components.SecondaryButton
import groot.mobile.ui.components.SectionLabel
import groot.mobile.ui.components.Sheet
import groot.mobile.ui.components.dateTime
import groot.mobile.ui.components.rememberResource
import groot.mobile.ui.components.rememberStepUpGate
import groot.mobile.ui.components.relativeTime

private fun kindIcon(kind: String): ImageVector = when (kind) {
    "login" -> AppIcons.User
    "card" -> AppIcons.Grid
    "api_key" -> AppIcons.Key
    else -> AppIcons.Lock
}

private fun approvalLabel(approval: String): String = when (approval) {
    "allowed" -> "Bots use it without asking"
    "per_conversation" -> "Asks once per chat"
    else -> "Asks every time"
}

@Composable
fun VaultRoute(container: AppContainer, onBack: () -> Unit) {
    val resource = rememberResource("vault") { container.api.vaultItems().filter { it.audience == "bots" } }
    var open by remember { mutableStateOf<VaultItem?>(null) }
    ScreenScaffold(title = "Vault", onBack = onBack) {
        LoadableContent(resource) { items ->
            if (items.isEmpty()) {
                EmptyState("The vault is empty", icon = AppIcons.Key, body = "Save a login, card or API key in the web app, and bots can use it after you approve, without seeing the value.")
            } else {
                LazyColumn(contentPadding = PaddingValues(S.lg), verticalArrangement = Arrangement.spacedBy(S.sm), modifier = Modifier.fillMaxSize()) {
                    items(items, key = { it.handle }) { item ->
                        AppCard(onClick = { open = item }) {
                            Row(horizontalArrangement = Arrangement.spacedBy(S.md), verticalAlignment = Alignment.CenterVertically) {
                                AppIcon(kindIcon(item.kind), null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                Column(Modifier.weight(1f)) {
                                    Text(item.label, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(
                                        listOfNotNull(
                                            item.username ?: item.cardLast4?.let { "${item.cardBrand.orEmpty()} ••$it" },
                                            (item.origins + item.hosts).firstOrNull()?.substringAfter("://"),
                                            if (item.disabled) "Disabled" else null,
                                        ).joinToString(" · ").ifEmpty { item.handle },
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                item.lastUsedAt?.let { Text(relativeTime(it), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                        }
                    }
                }
            }
        }
    }
    open?.let { item ->
        VaultItemSheet(container, item, onDismiss = { open = null }, onChanged = {
            open = null
            resource.refresh()
        })
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun VaultItemSheet(container: AppContainer, item: VaultItem, onDismiss: () -> Unit, onChanged: () -> Unit) {
    val detail = rememberResource("vault-item:${item.handle}") { container.api.vaultItem(item.handle) }
    val gate = rememberStepUpGate()
    val context = LocalContext.current
    val revealed = remember(item.handle) { mutableStateMapOf<String, String>() }
    val state by detail.state.collectAsStateWithLifecycle()
    Sheet(onDismiss = onDismiss, title = item.label) {
        Text("${item.kind.replace('_', ' ').replaceFirstChar { it.uppercase() }} · ${approvalLabel(item.approval)}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (item.origins.isNotEmpty() || item.hosts.isNotEmpty()) {
            Text("Used on ${(item.origins + item.hosts).joinToString(", ")}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        val loaded: VaultItemDetail? = (state as? Loadable.Ready<VaultItemDetail>)?.value
        if (loaded != null) {
            if (loaded.fields.isNotEmpty()) SectionLabel("Values")
            for (field in loaded.fields) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(S.sm)) {
                    Column(Modifier.weight(1f)) {
                        Text(field.replace('_', ' ').replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(
                            revealed[field] ?: "••••••••",
                            style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                        )
                    }
                    if (loaded.canReveal) {
                        IconBtn(AppIcons.Eye, "Reveal $field", onClick = {
                            if (revealed.containsKey(field)) {
                                revealed.remove(field)
                            } else {
                                gate.run { token ->
                                    detail.act("Could not reveal the value.") { revealed[field] = container.api.revealVaultValue(item.handle, field, token) }
                                }
                            }
                        })
                        IconBtn(AppIcons.Copy, "Copy $field", onClick = {
                            gate.run { token ->
                                detail.act("Could not copy the value.") {
                                    val value = container.api.revealVaultValue(item.handle, field, token, purpose = "copy")
                                    context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText(field, value))
                                    container.notices.show("Copied")
                                }
                            }
                        })
                    }
                }
            }
            if (loaded.events.isNotEmpty()) {
                SectionLabel("Recent use")
                for (event in loaded.events.take(MAX_EVENTS)) {
                    Text(
                        "${dateTime(event.at)} · ${event.tool} on ${event.target} · ${event.outcome}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
            SecondaryButton(if (item.disabled) "Enable" else "Disable", onClick = {
                gate.run { token -> detail.act("Could not update the item.", done = onChanged) { container.api.setVaultItemDisabled(item.handle, !item.disabled, token) } }
            })
            SecondaryButton("Delete", destructive = true, onClick = {
                gate.run { token -> detail.act("Could not delete the item.", done = onChanged) { container.api.deleteVaultItem(item.handle, token) } }
            })
        }
    }
}

private const val MAX_EVENTS = 6
