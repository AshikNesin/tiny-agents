package groot.mobile.feature.manage

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.api.UnlinkedVaultItem
import groot.mobile.data.api.VaultBackend
import groot.mobile.data.api.VaultItem
import groot.mobile.data.api.VaultOverview
import groot.mobile.data.vault.VaultKinds
import groot.mobile.data.vault.VaultPolicyDraft
import groot.mobile.data.vault.isValidHandle
import groot.mobile.data.vault.suggestHandle
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.components.AppCard
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.EmptyState
import groot.mobile.ui.components.IconBtn
import groot.mobile.ui.components.Loadable
import groot.mobile.ui.components.LoadableContent
import groot.mobile.ui.components.MenuRow
import groot.mobile.ui.components.PrimaryButton
import groot.mobile.ui.components.ResourceViewModel
import groot.mobile.ui.components.ScreenColumn
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.ui.components.SecondaryButton
import groot.mobile.ui.components.SectionLabel
import groot.mobile.ui.components.Sheet
import groot.mobile.ui.components.relativeTime
import groot.mobile.ui.components.rememberResource
import groot.mobile.ui.components.rememberStepUpGate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private fun kindIcon(kind: String): ImageVector = when (kind) {
    "login" -> AppIcons.Key
    "card" -> AppIcons.Grid
    "identity" -> AppIcons.User
    "api_key" -> AppIcons.Lock
    else -> AppIcons.Lock
}

private fun subtitle(item: VaultItem): String {
    if (item.cardLast4 != null) return "${item.cardBrand.orEmpty()} ••${item.cardLast4}${item.cardExpiry?.let { " · $it" }.orEmpty()}"
    val where = if (item.kind == "api_key") item.hosts else item.origins
    return listOfNotNull(item.username, where.joinToString(", ").ifEmpty { null }).joinToString(" · ").ifEmpty { "No origin yet" }
}

@Composable
fun VaultRoute(container: AppContainer, onOpen: (String) -> Unit, onNew: (String) -> Unit, onBack: () -> Unit) {
    val resource = rememberResource("vault") { container.api.vaultOverview() }
    val state by resource.state.collectAsStateWithLifecycle()
    var picker by remember { mutableStateOf(false) }
    var linking by remember { mutableStateOf<UnlinkedVaultItem?>(null) }
    val overview = (state as? Loadable.Ready<VaultOverview>)?.value

    LaunchedEffect(Unit) { resource.refresh() }

    ScreenScaffold(
        title = "Vault",
        onBack = onBack,
        actions = {
            IconBtn(AppIcons.Refresh, "Refresh", onClick = {
                resource.act("Couldn't refresh the vault.") { container.api.vaultOverview(refresh = true) }
            })
            IconBtn(AppIcons.Plus, "New item", enabled = overview?.canCreate == true, onClick = { picker = true })
        },
    ) {
        LoadableContent(resource) { data ->
            VaultList(container, resource, data, onOpen = onOpen, onLink = { linking = it }, onNew = { picker = true })
        }
    }

    if (picker && overview != null) {
        Sheet(onDismiss = { picker = false }, title = "New item") {
            Text("Saved in ${VaultKinds.backendLabel(overview.primaryBackend)}.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            for (kind in VaultKinds.ORDER) {
                MenuRow(kindIcon(kind), VaultKinds.label(kind), onClick = {
                    picker = false
                    onNew(kind)
                })
            }
        }
    }

    linking?.let { candidate ->
        LinkSheet(container, resource, candidate, overview?.kindDefaults.orEmpty(), onDismiss = { linking = null }, onLinked = {
            linking = null
            onOpen(it)
        })
    }
}

@Composable
private fun VaultList(
    container: AppContainer,
    resource: ResourceViewModel<VaultOverview>,
    data: VaultOverview,
    onOpen: (String) -> Unit,
    onLink: (UnlinkedVaultItem) -> Unit,
    onNew: () -> Unit,
) {
    val botItems = data.items.filter { it.audience == "bots" }
    val appItems = data.items.filter { it.audience == "app" }
    ScreenColumn {
        SectionLabel("Backends")
        for (backend in data.backends) {
            BackendCard(container, resource, backend, movable = if (backend.name == "onepassword-connect") data.movableToOnePassword else 0)
        }
        if (data.items.isEmpty()) {
            EmptyState(
                "No vault items yet",
                icon = AppIcons.Key,
                body = "Add a login, card or API key. Bots only ever get its handle.",
                actionLabel = if (data.canCreate) "New item" else null,
                onAction = onNew,
            )
        } else if (!data.canCreate) {
            Text(
                "${data.createBlockedWhy} New items are off until it is ready.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        for (kind in VaultKinds.ORDER) {
            val items = botItems.filter { it.kind == kind }
            if (items.isEmpty()) continue
            SectionLabel("${VaultKinds.section(kind)} · ${items.size}")
            for (item in items) ItemRow(item, onOpen)
        }
        if (appItems.isNotEmpty()) {
            SectionLabel("Used by the app · ${appItems.size}")
            Text(
                "Keys the server uses itself, such as model providers'. Bots never see them; change them in Settings, Models on the web.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            for (item in appItems) ItemRow(item, onOpen)
        }
        if (data.unlinked.isNotEmpty()) {
            SectionLabel("Not linked yet · ${data.unlinked.size}")
            Text(
                "In the vault, but no bot can use them until you give them a handle.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            for (candidate in data.unlinked) UnlinkedRow(candidate, onLink)
        }
    }
}

@Composable
private fun ItemRow(item: VaultItem, onOpen: (String) -> Unit) {
    AppCard(onClick = { onOpen(item.handle) }) {
        Row(horizontalArrangement = Arrangement.spacedBy(S.md), verticalAlignment = Alignment.CenterVertically) {
            AppIcon(kindIcon(item.kind), null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Column(Modifier.weight(1f)) {
                Text(item.label, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    listOfNotNull(subtitle(item), VaultKinds.backendLabel(item.backend), if (item.disabled) "Off" else null).joinToString(" · "),
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

@Composable
private fun UnlinkedRow(item: UnlinkedVaultItem, onLink: (UnlinkedVaultItem) -> Unit) {
    AppCard {
        Row(horizontalArrangement = Arrangement.spacedBy(S.md), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(item.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    listOfNotNull(
                        if (item.kind == "other") "Not usable by bots" else VaultKinds.label(item.kind),
                        item.username,
                        item.cardLast4?.let { "${item.cardBrand.orEmpty()} ••$it" },
                        item.urls.firstOrNull(),
                        VaultKinds.backendLabel(item.backend),
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            SecondaryButton("Link", onClick = { onLink(item) }, enabled = item.kind != "other")
        }
    }
}

@Composable
private fun BackendCard(container: AppContainer, resource: ResourceViewModel<VaultOverview>, backend: VaultBackend, movable: Int) {
    val gate = rememberStepUpGate()
    val problem = backend.problem
    val starting = problem?.code == "starting"
    AppCard {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(VaultKinds.backendLabel(backend.name), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
            Text(
                when {
                    !backend.configured -> "Not set up"
                    starting -> "Starting"
                    problem != null -> "Error"
                    else -> "Ready"
                },
                style = MaterialTheme.typography.labelMedium,
                color = if (backend.configured && problem != null && !starting) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (backend.configured) {
            (problem?.detail ?: backend.read.detail)?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (movable > 0 && problem == null) {
            SecondaryButton(
                "Move $movable local item${if (movable == 1) "" else "s"} here",
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    gate.run { token ->
                        resource.act("Couldn't move the items.") {
                            val result = container.api.moveVaultToOnePassword(token)
                            val moved = "Moved ${result.moved.size} item${if (result.moved.size == 1) "" else "s"} to 1Password"
                            container.notices.show(
                                if (result.failed.isEmpty()) {
                                    moved
                                } else {
                                    "$moved; ${result.failed.size} stayed local: ${result.failed.joinToString(", ") { (handle, reason) -> "$handle ($reason)" }}"
                                },
                            )
                        }
                    }
                },
            )
        }
    }
}

@Composable
private fun LinkSheet(
    container: AppContainer,
    resource: ResourceViewModel<VaultOverview>,
    candidate: UnlinkedVaultItem,
    kindDefaults: Map<String, List<String>>,
    onDismiss: () -> Unit,
    onLinked: (String) -> Unit,
) {
    val kind = candidate.kind.takeIf { it != "other" } ?: "login"
    val gate = rememberStepUpGate()
    val scope = rememberCoroutineScope()
    val bots by container.bots.state.collectAsStateWithLifecycle()
    var policy by remember(candidate) { mutableStateOf(VaultPolicyDraft.defaultFor(kind, suggestHandle(candidate.title))) }
    var busy by remember { mutableStateOf(false) }
    Sheet(onDismiss = onDismiss, title = "Let bots use “${candidate.title}”") {
        Text(
            "Give it a handle and say where it may be used. The value stays in ${VaultKinds.backendLabel(candidate.backend)}.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        VaultPolicyForm(kind, policy, { policy = it }, kindDefaults[kind].orEmpty(), bots.bots)
        PrimaryButton("Link", modifier = Modifier.fillMaxWidth(), loading = busy, enabled = isValidHandle(policy.handle), onClick = {
            gate.run { token ->
                busy = true
                scope.launch {
                    try {
                        val item = container.api.linkVaultItem(candidate.backend, candidate.externalId, policy.toJson(kind), token)
                        resource.refresh()
                        onLinked(item.handle)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        container.notices.showError(e, "Couldn't link the item.")
                    } finally {
                        busy = false
                    }
                }
            }
        })
    }
}
