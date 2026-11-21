package groot.mobile.feature.manage

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.api.VaultItemDetail
import groot.mobile.data.vault.VaultKinds
import groot.mobile.data.vault.VaultPolicyDraft
import groot.mobile.data.vault.isValidHandle
import groot.mobile.data.vault.vaultPolicyBody
import groot.mobile.data.vault.vaultValueBody
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.components.AppCard
import groot.mobile.ui.components.Chip
import groot.mobile.ui.components.IconBtn
import groot.mobile.ui.components.LoadableContent
import groot.mobile.ui.components.PrimaryButton
import groot.mobile.ui.components.ResourceViewModel
import groot.mobile.ui.components.ScreenColumn
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.ui.components.SecondaryButton
import groot.mobile.ui.components.SectionLabel
import groot.mobile.ui.components.Sheet
import groot.mobile.ui.components.StepUpGate
import groot.mobile.ui.components.relativeTime
import groot.mobile.ui.components.rememberResource
import groot.mobile.ui.components.rememberStepUpGate
import kotlinx.coroutines.delay

@Composable
fun VaultItemRoute(container: AppContainer, handle: String, onRenamed: (String) -> Unit, onGone: () -> Unit, onBack: () -> Unit) {
    val detail = rememberResource("vault-item:$handle") { container.api.vaultItem(handle) }
    ScreenScaffold(title = "Vault item", onBack = onBack) {
        LoadableContent(detail) { data ->
            key(data.item.updatedAt) {
                VaultItemContent(container, detail, data, onRenamed, onGone)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun VaultItemContent(
    container: AppContainer,
    resource: ResourceViewModel<VaultItemDetail>,
    data: VaultItemDetail,
    onRenamed: (String) -> Unit,
    onGone: () -> Unit,
) {
    val item = data.item
    val gate = rememberStepUpGate()
    val bots by container.bots.state.collectAsStateWithLifecycle()
    var policy by remember { mutableStateOf(VaultPolicyDraft.of(item)) }
    var editing by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    val forApp = item.audience == "app"
    val canEdit = data.canUpdate && !forApp
    val missing = VaultKinds.fields(item.kind).filter { it !in data.fields }

    fun savePolicy(next: VaultPolicyDraft) {
        gate.run { token ->
            resource.act("Couldn't save.") {
                val saved = container.api.updateVaultItem(item.handle, vaultPolicyBody(item.kind, next), token)
                container.notices.show("Saved")
                if (saved.handle != item.handle) onRenamed(saved.handle)
            }
        }
    }

    ScreenColumn {
        Column {
            Text(item.label, style = MaterialTheme.typography.titleLarge)
            Text(
                listOfNotNull(
                    VaultKinds.label(item.kind),
                    item.handle,
                    VaultKinds.backendLabel(item.backend),
                    item.lastUsedAt?.let { "used ${relativeTime(it)}${item.lastUsedBy?.let { by -> " by $by" }.orEmpty()}" },
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (data.stale || data.backendError != null) {
            AppCard {
                Text(
                    if (data.stale) "This item is gone from the backend (deleted or moved). Bots can't use it; delete the link." else data.backendError.orEmpty(),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }

        SectionLabel("Values")
        Text(
            when {
                forApp -> "Used by the app itself. Change it in Settings, Models on the web."
                !data.canUpdate -> "Read-only here: edit it in ${if (item.backend == "local") "the source app" else VaultKinds.backendLabel(item.backend)}."
                else -> "Values never leave the vault except to you, here, or into the page or request a bot is approved for."
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        AppCard {
            Column(verticalArrangement = Arrangement.spacedBy(S.md)) {
                if (data.fields.isEmpty()) {
                    Text("No values yet.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                for (field in data.fields) {
                    ValueRow(
                        container = container,
                        resource = resource,
                        handle = item.handle,
                        field = field,
                        plain = when (field) {
                            "username" -> item.username
                            "card_expiry" -> item.cardExpiry
                            else -> null
                        },
                        canReveal = data.canReveal,
                        onEdit = if (canEdit) ({ editing = field }) else null,
                    )
                }
            }
        }
        if (canEdit && missing.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
                for (field in missing) Chip(VaultKinds.fieldLabel(field), onClick = { editing = field }, icon = AppIcons.Plus)
            }
        }

        if (!forApp) {
            SectionLabel("Who may use it")
            AppCard {
                Column(verticalArrangement = Arrangement.spacedBy(S.md)) {
                    VaultToggleRow(
                        title = "Let bots use this item",
                        summary = if (policy.disabled) "Off" else "On",
                        checked = !policy.disabled,
                        onChange = { on ->
                            policy = policy.copy(disabled = !on)
                            savePolicy(VaultPolicyDraft.of(item).copy(disabled = !on))
                        },
                    )
                    VaultPolicyForm(
                        kind = item.kind,
                        value = policy,
                        onChange = { policy = it },
                        defaultTools = item.effectiveTools,
                        bots = bots.bots,
                    )
                    PrimaryButton("Save", onClick = { savePolicy(policy) }, enabled = isValidHandle(policy.handle))
                }
            }
        }

        SectionLabel("Activity")
        if (data.events.isEmpty()) {
            Text("Not used yet.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            AppCard {
                Column(verticalArrangement = Arrangement.spacedBy(S.sm)) {
                    for (event in data.events) {
                        Column {
                            Text(
                                listOfNotNull(outcomeLabel(event.outcome), event.tool, if (event.unattended) "unattended" else null).joinToString(" · "),
                                style = MaterialTheme.typography.bodyMedium,
                            )
                            Text(
                                "${relativeTime(event.at)} · ${event.target}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            event.reason?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                    }
                }
            }
        }

        if (!forApp) {
            SecondaryButton("Delete", icon = AppIcons.Trash, destructive = true, onClick = { confirmDelete = true }, modifier = Modifier.fillMaxWidth())
        }
    }

    editing?.let { field ->
        var draft by remember(field) { mutableStateOf("") }
        Sheet(onDismiss = { editing = null }, title = VaultKinds.fieldLabel(field)) {
            Text("Saved straight to the backend; tiny-agents keeps no copy.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            VaultValueInput(field, draft, { draft = it }, label = "New value")
            PrimaryButton("Save", modifier = Modifier.fillMaxWidth(), onClick = {
                gate.run { token ->
                    resource.act("Couldn't save.", done = {
                        editing = null
                        container.notices.show("${VaultKinds.fieldLabel(field)} saved")
                    }) {
                        container.api.updateVaultItem(item.handle, vaultValueBody(field, draft), token)
                    }
                }
            })
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete “${item.label}”?") },
            text = {
                Text(
                    "Bots lose the handle ${item.handle} either way. Unlink keeps the value in ${VaultKinds.backendLabel(item.backend)}" +
                        if (data.canDelete) "; delete everywhere removes it there too." else ".",
                )
            },
            confirmButton = {
                Row {
                    TextButton(onClick = {
                        confirmDelete = false
                        delete(container, resource, gate, item.handle, purge = false, onGone)
                    }) { Text("Unlink only") }
                    if (data.canDelete) {
                        TextButton(onClick = {
                            confirmDelete = false
                            delete(container, resource, gate, item.handle, purge = true, onGone)
                        }) { Text("Delete everywhere", color = MaterialTheme.colorScheme.error) }
                    }
                }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel", color = MaterialTheme.colorScheme.onSurfaceVariant) } },
            containerColor = MaterialTheme.colorScheme.surfaceContainer,
        )
    }
}

private fun delete(
    container: AppContainer,
    resource: ResourceViewModel<VaultItemDetail>,
    gate: StepUpGate,
    handle: String,
    purge: Boolean,
    onGone: () -> Unit,
) {
    gate.run { token ->
        resource.act("Couldn't delete.", done = {
            container.notices.show(if (purge) "Deleted" else "Unlinked")
            onGone()
        }) {
            container.api.deleteVaultItem(handle, purge, token)
        }
    }
}

@Composable
private fun ValueRow(
    container: AppContainer,
    resource: ResourceViewModel<VaultItemDetail>,
    handle: String,
    field: String,
    plain: String?,
    canReveal: Boolean,
    onEdit: (() -> Unit)?,
) {
    val gate = rememberStepUpGate()
    val context = LocalContext.current
    val revealed = remember { mutableStateMapOf<String, String>() }
    val shown = revealed[field]
    LaunchedEffect(shown) {
        if (shown != null) {
            delay(SHOW_MS)
            revealed.remove(field)
        }
    }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(S.xs)) {
        Column(Modifier.weight(1f)) {
            Text(VaultKinds.fieldLabel(field), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                shown ?: plain ?: if (VaultKinds.isSecret(field)) "••••••••" else "hidden",
                style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (canReveal) {
            IconBtn(AppIcons.Eye, if (shown != null) "Hide ${VaultKinds.fieldLabel(field)}" else "Reveal ${VaultKinds.fieldLabel(field)}", onClick = {
                if (shown != null) {
                    revealed.remove(field)
                } else {
                    gate.run { token ->
                        resource.act("Couldn't reveal it.") { revealed[field] = container.api.revealVaultValue(handle, field, token) }
                    }
                }
            })
            IconBtn(AppIcons.Copy, "Copy ${VaultKinds.fieldLabel(field)}", onClick = {
                gate.run { token ->
                    resource.act("Couldn't copy it.") {
                        val value = container.api.revealVaultValue(handle, field, token, purpose = "copy")
                        context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText(VaultKinds.fieldLabel(field), value))
                        container.notices.show("Copied")
                    }
                }
            })
        }
        if (onEdit != null) IconBtn(AppIcons.Pencil, "Edit ${VaultKinds.fieldLabel(field)}", onClick = onEdit)
    }
}

private fun outcomeLabel(outcome: String): String = when (outcome) {
    "used" -> "used"
    "approved_used" -> "used (approved)"
    "denied" -> "denied by you"
    "expired" -> "approval expired"
    "refused_origin" -> "refused: wrong origin"
    "refused_policy" -> "refused: not allowed"
    "refused_unattended" -> "refused: unattended"
    "unknown_handle" -> "refused: not visible to the bot"
    "disabled" -> "refused: disabled"
    "vault_locked" -> "refused: vault locked"
    "backend_error" -> "backend error"
    "sink_error" -> "failed before use"
    else -> outcome.replace('_', ' ')
}

private const val SHOW_MS = 30_000L
