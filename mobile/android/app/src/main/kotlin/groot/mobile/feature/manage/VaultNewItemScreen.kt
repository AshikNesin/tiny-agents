package groot.mobile.feature.manage

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.input.KeyboardType
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.vault.VaultKinds
import groot.mobile.data.vault.VaultPolicyDraft
import groot.mobile.data.vault.isValidHandle
import groot.mobile.data.vault.suggestHandle
import groot.mobile.data.vault.vaultCreateBody
import groot.mobile.ui.components.AppCard
import groot.mobile.ui.components.Field
import groot.mobile.ui.components.LoadableContent
import groot.mobile.ui.components.PrimaryButton
import groot.mobile.ui.components.ScreenColumn
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.ui.components.SectionLabel
import groot.mobile.ui.components.rememberResource
import groot.mobile.ui.components.rememberStepUpGate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
fun VaultNewItemRoute(container: AppContainer, kind: String, onSaved: (String) -> Unit, onBack: () -> Unit) {
    val overview = rememberResource("vault") { container.api.vaultOverview() }
    val bots by container.bots.state.collectAsStateWithLifecycle()
    val gate = rememberStepUpGate()
    val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf("") }
    var website by remember { mutableStateOf("") }
    val values = remember { mutableStateMapOf<String, String>() }
    var policy by remember { mutableStateOf(VaultPolicyDraft.defaultFor(kind)) }
    var handleTouched by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }

    ScreenScaffold(title = "New ${VaultKinds.label(kind).lowercase()}", onBack = onBack) {
        LoadableContent(overview) { data ->
            ScreenColumn {
                SectionLabel("Details")
                AppCard {
                    Column(verticalArrangement = Arrangement.spacedBy(S.md)) {
                        Field(
                            value = title,
                            onValueChange = {
                                title = it
                                if (!handleTouched) policy = policy.copy(handle = suggestHandle(it))
                            },
                            label = "Name",
                            placeholder = if (kind == "card") "Amex personal" else "GitHub",
                        )
                        if (VaultKinds.usesWebsite(kind)) {
                            Field(
                                value = website,
                                onValueChange = { website = it },
                                label = "Website",
                                placeholder = if (kind == "card") "https://shop.example.com" else "https://github.com/login",
                                supporting = "Its origin is where bots may fill this item.",
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                            )
                        }
                        for (field in VaultKinds.fields(kind)) {
                            VaultValueInput(field, values[field].orEmpty(), { values[field] = it })
                        }
                    }
                }
                SectionLabel("Who may use it")
                AppCard {
                    VaultPolicyForm(
                        kind = kind,
                        value = policy,
                        onChange = {
                            if (it.handle != policy.handle) handleTouched = true
                            policy = it
                        },
                        defaultTools = data.kindDefaults[kind].orEmpty(),
                        bots = bots.bots,
                    )
                }
                PrimaryButton(
                    text = "Save in ${VaultKinds.backendLabel(data.primaryBackend)}",
                    loading = saving,
                    enabled = data.canCreate && title.isNotBlank() && isValidHandle(policy.handle),
                    onClick = {
                        gate.run { token ->
                            saving = true
                            scope.launch {
                                try {
                                    val item = container.api.createVaultItem(vaultCreateBody(kind, title, website, values.toMap(), policy), token)
                                    container.notices.show("Saved")
                                    overview.refresh()
                                    onSaved(item.handle)
                                } catch (e: CancellationException) {
                                    throw e
                                } catch (e: Exception) {
                                    container.notices.showError(e, "Couldn't save the item.")
                                } finally {
                                    saving = false
                                }
                            }
                        }
                    },
                )
                data.createBlockedWhy?.let {
                    Text("$it New items are off until it is ready.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}
